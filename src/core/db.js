/**
 * Storage: SQLite on top of the raw archive.
 *
 * Raw attributes are written to the props column VERBATIM, and the canonical
 * columns are built on top of them. The canonical columns can turn out wrong;
 * props cannot. So any mistake in unification is fixed by recomputing from the
 * local archive, without going back to the server.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * The native module is loaded lazily, on the first use of the database.
 *
 * Loading it at startup, before Electron was initialised, killed the packaged
 * app: the modules loaded but the ready event never arrived.
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

-- Attributes and heavy data are kept apart on purpose.
--
-- Geometry takes 6.8 GB out of 11, raw attributes almost another gigabyte.
-- While everything lived in one table, any filter by species dragged gigabytes
-- of geometry it did not need off the disk: a query took 22 seconds. Splitting
-- leaves only what is searched on in the working table.
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

-- Raw attributes verbatim, plus geometry. Read only when showing an object
-- and when exporting.
CREATE TABLE IF NOT EXISTS feature_data(
  feature_id INTEGER PRIMARY KEY,
  props TEXT NOT NULL,
  geom TEXT
);

-- Materialised tree: without it the UI scans 1.4 million rows on every click.
-- Built once at load time.
CREATE TABLE IF NOT EXISTS forestry(
  layer_key TEXT PRIMARY KEY,
  oblast TEXT, uchrezhdenie TEXT, lesnichestvo TEXT, les_key TEXT,
  n_vydel INTEGER, n_kvartal INTEGER, vertices INTEGER,
  -- the weight of the blocks is kept right here: without it the export
  -- estimate joined a link table of a million rows and took up to 30 seconds
  kv_vertices INTEGER DEFAULT 0,
  minx REAL, miny REAL, maxx REAL, maxy REAL
);

-- Lookups for the filters. Materialised as well: grouping over 1.4 million
-- rows took 62 seconds every time the tab was opened.
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

/** Rebuild the forestry tree from feature. */
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
 * Schema migrations.
 *
 * CREATE TABLE IF NOT EXISTS does not change tables that already exist, so new
 * columns have to be added explicitly and exactly once. The version number
 * lives in the database (PRAGMA user_version); new steps go at the end.
 */
const MIGRATIONS = [
  // 1 — the base schema, created from SCHEMA
  () => {},
  // 2 — block weight next to the forestry, so the estimate scans no objects
  (db) => {
    const cols = db.prepare('PRAGMA table_info(forestry)').all().map((c) => c.name);
    if (!cols.includes('kv_vertices')) {
      db.exec('ALTER TABLE forestry ADD COLUMN kv_vertices INTEGER DEFAULT 0');
    }
  },
  // 3 — indexes for the attribute filters: without them a query by species
  // walked 1.6 million rows and took 22 seconds
  (db) => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS ix_f_poroda   ON feature(poroda, layer_key, nvert);
      CREATE INDEX IF NOT EXISTS ix_f_katzem   ON feature(kat_zem, layer_key, nvert);
      CREATE INDEX IF NOT EXISTS ix_f_bonitet  ON feature(bonitet, layer_key, nvert);
      CREATE INDEX IF NOT EXISTS ix_f_tiplesa  ON feature(tip_lesa, layer_key, nvert);
      CREATE INDEX IF NOT EXISTS ix_f_ploshad  ON feature(ploshad);
    `);
  },
  // 4 — the same indexes, but covering: with kind first the query needs no
  // look into the table itself
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

/** Schema version in the database file — so the app can warn about an old one. */
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
 * Load the archive into the database.
 *
 * Incrementally: a layer is reloaded only when its sha256 changed.
 * onProgress receives {i, total, key, rows, action}.
 */
export function loadFromRaw(dbFile, rawDir, { reset = false, onProgress = null } = {}) {
  const manifest = readManifest(rawDir);
  const keys = Object.keys(manifest).sort();
  if (keys.length === 0) throw new Error(`Empty manifest in ${rawDir}`);

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
    // Load everything that has a file, even when the layer was not fetched in
    // full: the data on disk is usable, and a shortfall shows up in the
    // server_count against loaded_count check. Such layers used to be skipped.
    if (!fs.existsSync(file)) {
      stats.skipped += 1;
      onProgress?.({ i, total: keys.length, key, action: 'no data', rows: 0 });
      continue;
    }

    if (!reset) {
      const prev = getLayer.get(key);
      if (prev && prev.sha256 === rec.sha256) {
        stats.skipped += 1;
        onProgress?.({ i, total: keys.length, key, action: 'unchanged', rows: 0 });
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

    // path = [Group, Agency, Forestry, "Границы выделов"]
    const p = rec.path || [];
    const layLes = p.length >= 2 ? p[p.length - 2] : null;
    const layUch = p.length >= 4 ? p[p.length - 3] : null;

    const rows = feats.map((f) => {
      const pr = f.properties || {};
      const g = f.geometry || null;
      const bb = bbox(g) || {};
      const val = (role) => (roles[role] ? pr[roles[role]] : null);

      // For stands the forestry name comes from the layer tree: it is uniform
      // there. The attributes contain typos — «Каскеленско» instead of
      // «Каскеленское» on one stand from 2024 — and grouping by the attribute
      // lost it. For blocks the layer is region-wide, so only the attribute is left.
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

    // The heavy part is stored separately, in the same order
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

/** Summary and the «the server said N — the database holds N» check. */
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
