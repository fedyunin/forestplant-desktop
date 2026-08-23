/**
 * Linking blocks to forestries.
 *
 * The block layer in the system is region-wide, and the only way to tie it to
 * a forestry is by name. But the names disagree: the stands say «Байнкольское»
 * while the blocks say «Байынкольское»; «Аксуское» against «Аксуйское».
 * Reconciling spellings by hand leads to an endless list of exceptions.
 *
 * So: first an exact match of normalised keys, then geography for whatever is
 * left. A block belongs to a forestry when its centre falls inside the
 * forestry bbox and its number appears among that forestry's stands. That
 * leans on the data itself instead of on spelling.
 */

import { open } from './db.js';

const LINK_SCHEMA = `
CREATE TABLE IF NOT EXISTS kvartal_link(
  layer_key TEXT NOT NULL,     -- forestry (forestry.layer_key)
  feature_id INTEGER NOT NULL, -- block (feature.id)
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

  // 1) exact match of normalised names
  const byName = db.prepare(`
    SELECT f.layer_key, k.id
    FROM forestry f
    JOIN feature k ON k.kind = 'kvartal' AND k.oblast = f.oblast AND k.les_key = f.les_key
    WHERE f.les_key <> ''
  `).all();
  insAll(byName.map((r) => [r.layer_key, r.id, 'name']));
  onProgress?.({ stage: 'by name', linked: byName.length });

  // 2) orphaned blocks — by geography.
  //
  // We start from the blocks rather than from forestries without links: a
  // block whose name is misspelled would otherwise stay unclaimed even when
  // its forestry matched by name. Exactly one Kaskelenskoe block was lost so.
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

  // block numbers of each forestry — they rule out false hits
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

  // among the candidates take the forestry with the smallest bbox — the tightest
    let best = null, bestArea = Infinity;
    for (const f of pool) {
      if (cx < f.minx || cx > f.maxx || cy < f.miny || cy > f.maxy) continue;
      if (!numsByLayer.get(f.layer_key)?.has(k.kvartal)) continue;
      const area = (f.maxx - f.minx) * (f.maxy - f.miny);
      if (area < bestArea) { bestArea = area; best = f; }
    }
    if (best) geoRows.push([best.layer_key, k.id, 'geo']);
    if (done % 2000 === 0) onProgress?.({ stage: 'by geography', done, total: orphans.length });
  }
  insAll(geoRows);
  onProgress?.({ stage: 'by geography', linked: geoRows.length, orphans: orphans.length });

  // the counters in the tree come from the actual links. The block weight is
  // kept too: the export estimate reads it here instead of joining tables.
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
