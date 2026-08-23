/**
 * Привязка кварталов к лесничествам.
 *
 * Слой кварталов в системе общий на область, и связать его с лесничеством
 * можно только по названию. Но названия расходятся: у выделов «Байнкольское»,
 * у кварталов «Байынкольское»; «Аксуское» против «Аксуйское». Подгонять
 * написания вручную — путь в бесконечный список исключений.
 *
 * Поэтому: сначала точное совпадение нормализованных ключей, а для оставшихся
 * — по географии. Квартал принадлежит лесничеству, если его центр попадает в
 * рамку лесничества и номер квартала есть среди его выделов. Это опирается на
 * сами данные, а не на написание.
 */

import { open } from './db.js';

const LINK_SCHEMA = `
CREATE TABLE IF NOT EXISTS kvartal_link(
  layer_key TEXT NOT NULL,     -- лесничество (forestry.layer_key)
  feature_id INTEGER NOT NULL, -- квартал (feature.id)
  how TEXT,                    -- 'name' | 'geo'
  PRIMARY KEY (layer_key, feature_id)
);
CREATE INDEX IF NOT EXISTS ix_kl_layer ON kvartal_link(layer_key);
`;

export function buildLinks(dbFile, { onProgress = null } = {}) {
  const db = open(dbFile, { write: true });
  db.exec(LINK_SCHEMA);
  db.exec('DELETE FROM kvartal_link');

  const ins = db.prepare('INSERT OR IGNORE INTO kvartal_link(layer_key, feature_id, how) VALUES (?,?,?)');
  const insAll = db.transaction((rows) => { for (const r of rows) ins.run(r); });

  // 1) точное совпадение нормализованных названий
  const byName = db.prepare(`
    SELECT f.layer_key, k.id
    FROM forestry f
    JOIN feature k ON k.kind = 'kvartal' AND k.oblast = f.oblast AND k.les_key = f.les_key
    WHERE f.les_key <> ''
  `).all();
  insAll(byName.map((r) => [r.layer_key, r.id, 'name']));
  onProgress?.({ stage: 'по названию', linked: byName.length });

  // 2) осиротевшие кварталы — по географии.
  //
  // Идём именно от кварталов, а не от лесничеств без связей: иначе квартал с
  // опечаткой в названии остаётся ничьим, даже когда его лесничество в целом
  // сопоставилось по имени. Ровно так терялся один квартал Каскеленского.
  const orphans = db.prepare(`
    SELECT id, oblast, kvartal, minx, miny, maxx, maxy FROM feature
    WHERE kind='kvartal' AND minx IS NOT NULL
      AND id NOT IN (SELECT feature_id FROM kvartal_link)
  `).all();

  const fByOblast = new Map();
  for (const f of db.prepare(
    'SELECT layer_key, oblast, minx, miny, maxx, maxy FROM forestry WHERE minx IS NOT NULL',
  ).all()) {
    if (!fByOblast.has(f.oblast)) fByOblast.set(f.oblast, []);
    fByOblast.get(f.oblast).push(f);
  }

  // номера кварталов каждого лесничества — по ним отсекаем ложные попадания
  const numsByLayer = new Map();
  for (const r of db.prepare(
    "SELECT layer_key, kvartal FROM feature WHERE kind='vydel' AND kvartal IS NOT NULL GROUP BY layer_key, kvartal",
  ).all()) {
    if (!numsByLayer.has(r.layer_key)) numsByLayer.set(r.layer_key, new Set());
    numsByLayer.get(r.layer_key).add(r.kvartal);
  }

  const geoRows = [];
  let done = 0;
  for (const k of orphans) {
    done += 1;
    const pool = fByOblast.get(k.oblast);
    if (!pool) continue;
    const cx = (k.minx + k.maxx) / 2;
    const cy = (k.miny + k.maxy) / 2;

    // из подходящих берём лесничество с наименьшей рамкой — самое тесное
    let best = null, bestArea = Infinity;
    for (const f of pool) {
      if (cx < f.minx || cx > f.maxx || cy < f.miny || cy > f.maxy) continue;
      if (!numsByLayer.get(f.layer_key)?.has(k.kvartal)) continue;
      const area = (f.maxx - f.minx) * (f.maxy - f.miny);
      if (area < bestArea) { bestArea = area; best = f; }
    }
    if (best) geoRows.push([best.layer_key, k.id, 'geo']);
    if (done % 2000 === 0) onProgress?.({ stage: 'по географии', done, total: orphans.length });
  }
  insAll(geoRows);
  onProgress?.({ stage: 'по географии', linked: geoRows.length, orphans: orphans.length });

  // счётчики в дереве — из фактических связей. Вес кварталов сохраняем тоже:
  // оценка экспорта берёт его отсюда вместо сшивки таблиц на каждый клик.
  db.exec(`
    UPDATE forestry SET
      n_kvartal = (SELECT COUNT(*) FROM kvartal_link l WHERE l.layer_key = forestry.layer_key),
      kv_vertices = IFNULL((
        SELECT SUM(IFNULL(f.nvert, 0)) FROM kvartal_link l
        JOIN feature f ON f.id = l.feature_id
        WHERE l.layer_key = forestry.layer_key
      ), 0);
  `);

  const stats = {
    byName: byName.length,
    byGeo: geoRows.length,
    forestriesWithKvartaly: db.prepare('SELECT COUNT(*) n FROM forestry WHERE n_kvartal > 0').get().n,
    forestriesTotal: db.prepare('SELECT COUNT(*) n FROM forestry').get().n,
  };
  db.close();
  return stats;
}
