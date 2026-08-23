/**
 * Хранилище: SQLite поверх сырого архива.
 *
 * Сырые атрибуты пишутся в колонку props ДОСЛОВНО, канонические колонки
 * строятся поверх. Канонические колонки могут оказаться заполнены неверно,
 * props — нет. Поэтому любая ошибка унификации чинится пересчётом из
 * локального архива, без повторного обращения к серверу.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Нативный модуль подгружается лениво, при первом обращении к базе.
 *
 * Загрузка на старте, до инициализации Electron, роняла собранное приложение:
 * модули успевали загрузиться, а событие готовности так и не наступало.
 */
const require = createRequire(import.meta.url);
let Database = null;
const sqlite = () => {
  if (!Database) Database = require('better-sqlite3');
  return Database;
};

import { resolveRoles, classifyLayer, asInt, asFloat, forestryKey } from './fields.js';
import { bbox, countVertices } from './geometry.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS layer(
  key TEXT PRIMARY KEY,
  kind TEXT, oblast TEXT, service_url TEXT, layer_id INTEGER,
  path TEXT, layer_name TEXT, geometry_type TEXT,
  uchrezhdenie TEXT, lesnichestvo TEXT,
  fields TEXT, roles TEXT,
  server_count INTEGER, loaded_count INTEGER, sha256 TEXT
);

-- Атрибуты и тяжёлые данные разнесены намеренно.
--
-- Геометрия занимает 6.8 ГБ из 11, сырые атрибуты — ещё почти гигабайт. Пока
-- всё лежало в одной таблице, любой фильтр по породе тащил с диска гигабайты
-- геометрии, которая ему не нужна: выборка занимала 22 секунды. Разделение
-- оставляет в рабочей таблице только то, по чему ищут.
CREATE TABLE IF NOT EXISTS feature(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layer_key TEXT NOT NULL,
  kind TEXT,
  oblast TEXT, uchrezhdenie TEXT, lesnichestvo TEXT, les_key TEXT, company TEXT,
  kvartal INTEGER, vydel INTEGER,
  ploshad REAL, poroda TEXT, bonitet TEXT, tip_lesa TEXT,
  kat_zem TEXT, kat_zasch TEXT,
  objectid INTEGER,
  nvert INTEGER,
  minx REAL, miny REAL, maxx REAL, maxy REAL
);

-- Сырые атрибуты дословно и геометрия. Читается только при показе объекта
-- и при экспорте.
CREATE TABLE IF NOT EXISTS feature_data(
  feature_id INTEGER PRIMARY KEY,
  props TEXT NOT NULL,
  geom TEXT
);

-- Материализованное дерево: без него UI сканирует 1.4 млн строк на каждый
-- клик. Строится один раз при загрузке.
CREATE TABLE IF NOT EXISTS forestry(
  layer_key TEXT PRIMARY KEY,
  oblast TEXT, uchrezhdenie TEXT, lesnichestvo TEXT, les_key TEXT,
  n_vydel INTEGER, n_kvartal INTEGER, vertices INTEGER,
  -- вес кварталов держим здесь же: без него оценка экспорта каждый раз
  -- сшивала таблицу связей с миллионом строк и занимала до 30 секунд
  kv_vertices INTEGER DEFAULT 0,
  minx REAL, miny REAL, maxx REAL, maxy REAL
);

-- Справочники для фильтров. Тоже материализованы: группировка по 1.4 млн
-- строк занимала 62 секунды на каждое открытие вкладки.
CREATE TABLE IF NOT EXISTS facet(
  col TEXT, value TEXT, n INTEGER,
  PRIMARY KEY (col, value)
);

CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS ix_f_layer ON feature(layer_key, kvartal, vydel);
CREATE INDEX IF NOT EXISTS ix_f_leskey ON feature(les_key);
CREATE INDEX IF NOT EXISTS ix_f_kv    ON feature(kind, oblast, les_key, kvartal);
CREATE INDEX IF NOT EXISTS ix_f_bbox  ON feature(minx, maxx, miny, maxy);
CREATE INDEX IF NOT EXISTS ix_fo_obl  ON forestry(oblast, uchrezhdenie, lesnichestvo);
`;

/** Пересобрать дерево лесничеств из feature. */
const REBUILD_TREE = `
DELETE FROM forestry;
INSERT INTO forestry(layer_key, oblast, uchrezhdenie, lesnichestvo, les_key,
                     n_vydel, n_kvartal, vertices, minx, miny, maxx, maxy)
SELECT layer_key,
       MAX(oblast), MAX(uchrezhdenie), MAX(lesnichestvo), MAX(les_key),
       COUNT(*), 0, SUM(IFNULL(nvert,0)),
       MIN(minx), MIN(miny), MAX(maxx), MAX(maxy)
FROM feature WHERE kind='vydel'
GROUP BY layer_key;

UPDATE forestry SET n_kvartal = (
  SELECT COUNT(*) FROM feature k
  WHERE k.kind='kvartal' AND k.oblast = forestry.oblast
    AND k.les_key = forestry.les_key
);

DELETE FROM facet;
INSERT INTO facet(col, value, n)
  SELECT 'poroda', poroda, COUNT(*) FROM feature
  WHERE kind='vydel' AND poroda IS NOT NULL AND TRIM(poroda) <> '' GROUP BY poroda;
INSERT INTO facet(col, value, n)
  SELECT 'bonitet', bonitet, COUNT(*) FROM feature
  WHERE kind='vydel' AND bonitet IS NOT NULL AND TRIM(bonitet) <> '' GROUP BY bonitet;
INSERT INTO facet(col, value, n)
  SELECT 'kat_zem', kat_zem, COUNT(*) FROM feature
  WHERE kind='vydel' AND kat_zem IS NOT NULL AND TRIM(kat_zem) <> '' GROUP BY kat_zem;
INSERT INTO facet(col, value, n)
  SELECT 'tip_lesa', tip_lesa, COUNT(*) FROM feature
  WHERE kind='vydel' AND tip_lesa IS NOT NULL AND TRIM(tip_lesa) <> '' GROUP BY tip_lesa;
`;

/**
 * Миграции схемы.
 *
 * CREATE TABLE IF NOT EXISTS не меняет уже созданные таблицы, поэтому новые
 * колонки нужно добавлять явно и по одному разу. Номер версии хранится в самой
 * базе (PRAGMA user_version), новые шаги дописываются в конец списка.
 */
const MIGRATIONS = [
  // 1 — базовая схема, создаётся из SCHEMA
  () => {},
  // 2 — вес кварталов рядом с лесничеством, чтобы оценка не сканировала объекты
  (db) => {
    const cols = db.prepare('PRAGMA table_info(forestry)').all().map((c) => c.name);
    if (!cols.includes('kv_vertices')) {
      db.exec('ALTER TABLE forestry ADD COLUMN kv_vertices INTEGER DEFAULT 0');
    }
  },
  // 3 — индексы под фильтры по атрибутам: без них выборка по породе
  // перебирала 1.6 млн строк и занимала 22 секунды
  (db) => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS ix_f_poroda   ON feature(poroda, layer_key, nvert);
      CREATE INDEX IF NOT EXISTS ix_f_katzem   ON feature(kat_zem, layer_key, nvert);
      CREATE INDEX IF NOT EXISTS ix_f_bonitet  ON feature(bonitet, layer_key, nvert);
      CREATE INDEX IF NOT EXISTS ix_f_tiplesa  ON feature(tip_lesa, layer_key, nvert);
      CREATE INDEX IF NOT EXISTS ix_f_ploshad  ON feature(ploshad);
    `);
  },
  // 4 — те же индексы, но покрывающие: с kind в начале запросу не нужно
  // заглядывать в саму таблицу
  (db) => {
    db.exec(`
      DROP INDEX IF EXISTS ix_f_poroda;
      DROP INDEX IF EXISTS ix_f_katzem;
      DROP INDEX IF EXISTS ix_f_bonitet;
      DROP INDEX IF EXISTS ix_f_tiplesa;
      DROP INDEX IF EXISTS ix_f_ploshad;
      CREATE INDEX IF NOT EXISTS ix_f_poroda  ON feature(kind, poroda, layer_key, nvert, kat_zem, bonitet, ploshad);
      CREATE INDEX IF NOT EXISTS ix_f_katzem  ON feature(kind, kat_zem, layer_key, nvert, poroda, bonitet, ploshad);
      CREATE INDEX IF NOT EXISTS ix_f_bonitet ON feature(kind, bonitet, layer_key, nvert);
      CREATE INDEX IF NOT EXISTS ix_f_tiplesa ON feature(kind, tip_lesa, layer_key, nvert);
      CREATE INDEX IF NOT EXISTS ix_f_ploshad ON feature(kind, ploshad, layer_key, nvert);
    `);
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  if (current >= SCHEMA_VERSION) return current;
  for (let v = current; v < SCHEMA_VERSION; v++) {
    MIGRATIONS[v](db);
  }
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return SCHEMA_VERSION;
}

export function open(file, { write = false } = {}) {
  const db = new (sqlite())(file, { readonly: !write });
  if (write) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = OFF');
    db.exec(SCHEMA);
    migrate(db);
  }
  return db;
}

/** Версия схемы в файле базы — чтобы приложение могло предупредить о старой. */
export function schemaVersion(file) {
  const db = new (sqlite())(file, { readonly: true });
  const v = db.pragma('user_version', { simple: true });
  db.close();
  return v;
}

export function readManifest(rawDir) {
  const p = path.join(rawDir, '_manifest.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Залить архив в базу.
 *
 * Инкрементально: слой перезаливается, только если у него изменился sha256.
 * onProgress получает {i, total, key, rows, action}.
 */
export function loadFromRaw(dbFile, rawDir, { reset = false, onProgress = null } = {}) {
  const manifest = readManifest(rawDir);
  const keys = Object.keys(manifest).sort();
  if (keys.length === 0) throw new Error(`Пустой манифест в ${rawDir}`);

  if (reset) for (const s of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + s)) fs.unlinkSync(dbFile + s);
  }

  const db = open(dbFile, { write: true });
  const stats = { loaded: 0, updated: 0, skipped: 0, features: 0, byKind: {} };

  const getLayer = db.prepare('SELECT sha256 FROM layer WHERE key = ?');
  const delFeatures = db.prepare('DELETE FROM feature WHERE layer_key = ?');
  const insFeature = db.prepare(`INSERT INTO feature(
    layer_key, kind, oblast, uchrezhdenie, lesnichestvo, les_key, company,
    kvartal, vydel, ploshad, poroda, bonitet, tip_lesa, kat_zem, kat_zasch,
    objectid, nvert, minx, miny, maxx, maxy
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insData = db.prepare('INSERT INTO feature_data(feature_id, props, geom) VALUES (?,?,?)');
  const delData = db.prepare('DELETE FROM feature_data WHERE feature_id IN (SELECT id FROM feature WHERE layer_key = ?)');
  const insLayer = db.prepare(`INSERT OR REPLACE INTO layer(
    key, kind, oblast, service_url, layer_id, path, layer_name, geometry_type,
    uchrezhdenie, lesnichestvo, fields, roles, server_count, loaded_count, sha256
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const insertAll = db.transaction((rows, blobs) => {
    for (let n = 0; n < rows.length; n++) {
      const id = insFeature.run(rows[n]).lastInsertRowid;
      insData.run(id, blobs[n][0], blobs[n][1]);
    }
  });

  let i = 0;
  for (const key of keys) {
    i += 1;
    const rec = manifest[key];
    const file = path.join(rawDir, 'layers', `${key}.geojson.gz`);
    // Грузим всё, для чего есть файл, даже если слой забран не полностью:
    // данные на диске пригодны, а недобор виден по сверке server_count против
    // loaded_count. Раньше такие слои молча не попадали в базу вовсе.
    if (!fs.existsSync(file)) {
      stats.skipped += 1;
      onProgress?.({ i, total: keys.length, key, action: 'нет данных', rows: 0 });
      continue;
    }

    if (!reset) {
      const prev = getLayer.get(key);
      if (prev && prev.sha256 === rec.sha256) {
        stats.skipped += 1;
        onProgress?.({ i, total: keys.length, key, action: 'без изменений', rows: 0 });
        continue;
      }
      if (prev) { delData.run(key); delFeatures.run(key); stats.updated += 1; }
    }

    const fc = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    const feats = fc.features || [];
    const roles = resolveRoles(rec.fields || []);
    const kind = classifyLayer(
      { layerName: rec.layer_name, geometryType: rec.geometry_type, kind: rec.kind },
      roles,
    );

    // path = [Группа, Учреждение, Лесничество, "Границы выделов"]
    const p = rec.path || [];
    const layLes = p.length >= 2 ? p[p.length - 2] : null;
    const layUch = p.length >= 4 ? p[p.length - 3] : null;

    const rows = feats.map((f) => {
      const pr = f.properties || {};
      const g = f.geometry || null;
      const bb = bbox(g) || {};
      const val = (role) => (roles[role] ? pr[roles[role]] : null);

      // Для выделов имя лесничества берём из дерева слоёв: оно единообразно.
      // В атрибутах встречаются опечатки — «Каскеленско» вместо «Каскеленское»
      // у одного выдела из 2024, и группировка по атрибуту его теряла.
      // Для кварталов слой общий на область, там источник только атрибут.
      const les = kind === 'vydel' ? (layLes || val('les')) : (val('les') || layLes);

      return [
        key, kind, rec.oblast, layUch,
        les ?? null, forestryKey(les), val('comp') ?? null,
        asInt(val('kv')), asInt(val('vd')),
        asFloat(val('ploshad')),
        val('poroda') ?? null, val('bonitet') ?? null, val('tip_lesa') ?? null,
        val('kat_zem') ?? null, val('kat_zasch') ?? null,
        pr.OBJECTID ?? null,
        countVertices(g),
        bb.minx ?? null, bb.miny ?? null, bb.maxx ?? null, bb.maxy ?? null,
      ];
    });

    // Тяжёлая часть кладётся отдельно, в том же порядке
    const blobs = feats.map((f) => [
      JSON.stringify(f.properties || {}),
      f.geometry ? JSON.stringify(f.geometry) : null,
    ]);

    insertAll(rows, blobs);
    insLayer.run(
      key, kind, rec.oblast, rec.service_url, rec.layer_id,
      JSON.stringify(p), rec.layer_name, rec.geometry_type,
      layUch, layLes, JSON.stringify(rec.fields || []), JSON.stringify(roles),
      rec.server_count ?? null, rows.length, rec.sha256 ?? null,
    );

    stats.loaded += 1;
    stats.features += rows.length;
    stats.byKind[kind] = (stats.byKind[kind] || 0) + rows.length;
    onProgress?.({ i, total: keys.length, key, action: kind, rows: rows.length });
  }

  db.exec(INDEXES);
  db.exec(REBUILD_TREE);
  db.exec('ANALYZE');
  db.close();
  return stats;
}

/** Сводка и сверка «сервер сказал N — в базе N». */
export function stats(dbFile) {
  const db = open(dbFile);
  const out = {
    layers: db.prepare('SELECT COUNT(*) n FROM layer').get().n,
    features: db.prepare('SELECT COUNT(*) n FROM feature').get().n,
    byKind: db.prepare('SELECT kind, COUNT(*) layers, SUM(loaded_count) features FROM layer GROUP BY kind ORDER BY features DESC').all(),
    byOblast: db.prepare("SELECT oblast, COUNT(*) layers, SUM(loaded_count) features FROM layer WHERE kind='vydel' GROUP BY oblast ORDER BY features DESC").all(),
    mismatched: db.prepare('SELECT key, oblast, server_count, loaded_count FROM layer WHERE server_count IS NOT NULL AND server_count <> loaded_count').all(),
    noVydelNumber: db.prepare("SELECT COUNT(*) n FROM feature WHERE kind='vydel' AND vydel IS NULL").get().n,
    noGeom: db.prepare('SELECT COUNT(*) n FROM feature_data WHERE geom IS NULL').get().n,
  };
  db.close();
  return out;
}
