/**
 * Database queries.
 *
 * Three rules, each backed by measurement rather than taste:
 *
 * 1. The tree and the lookups are read from materialised tables. Recomputing
 *    them over a million rows took 22 and 62 seconds respectively.
 * 2. The estimate of a selection made from the tree reads ready sums out of
 *    forestry: scanning the objects cost 30 seconds per click.
 * 3. A long list of picked forestries goes into a temp table: parsing a query
 *    with hundreds of placeholders costs more than running it.
 */

import { open } from '../core/db.js';
import { VERTEX_BUDGET } from '../core/kml.js';

let db = null;
let dbPath = null;

export function openDb(file) {
  if (db) db.close();
  db = open(file);
  dbPath = file;
  db.exec('CREATE TEMP TABLE IF NOT EXISTS sel(k TEXT PRIMARY KEY)');
  return { path: file, ...summary() };
}

export function close() {
  if (db) db.close();
  db = null;
  dbPath = null;
}

export const currentDb = () => dbPath;
export const isOpen = () => Boolean(db);

function need() {
  if (!db) throw new Error('No database open');
  return db;
}

function setSelection(keys) {
  const d = need();
  const ins = d.prepare('INSERT OR IGNORE INTO sel(k) VALUES (?)');
  d.transaction((ks) => {
    d.exec('DELETE FROM sel');
    for (const k of ks) ins.run(k);
  })(keys);
}

/* ---------------------------------------------------------------- summary */

export function summary() {
  const d = need();
  return {
    features: d.prepare('SELECT COUNT(*) n FROM feature').get().n,
    forestries: d.prepare('SELECT COUNT(*) n FROM forestry').get().n,
    vydels: d.prepare('SELECT IFNULL(SUM(n_vydel),0) n FROM forestry').get().n,
    kvartaly: d.prepare("SELECT COUNT(*) n FROM feature WHERE kind='kvartal'").get().n,
    oblasts: d.prepare('SELECT COUNT(DISTINCT oblast) n FROM forestry').get().n,
    layers: d.prepare('SELECT COUNT(*) n FROM layer').get().n,
    problems: d.prepare('SELECT COUNT(*) n FROM layer WHERE server_count IS NOT NULL AND server_count <> loaded_count').get().n,
    schema: d.pragma('user_version', { simple: true }),
  };
}

/* ---------------------------------------------------------------- tree */

export function tree() {
  const rows = need().prepare(`
    SELECT layer_key, oblast, uchrezhdenie, lesnichestvo, n_vydel, n_kvartal, vertices
    FROM forestry ORDER BY oblast, uchrezhdenie, lesnichestvo
  `).all();

  const byOblast = new Map();
  for (const r of rows) {
    const o = r.oblast || '—';
    const u = r.uchrezhdenie || '—';
    if (!byOblast.has(o)) byOblast.set(o, { name: o, vydels: 0, children: new Map() });
    const ob = byOblast.get(o);
    if (!ob.children.has(u)) ob.children.set(u, { name: u, vydels: 0, children: [] });
    const uc = ob.children.get(u);
    uc.children.push({
      key: r.layer_key,
      name: r.lesnichestvo || '—',
      vydels: r.n_vydel,
      kvartaly: r.n_kvartal,
      vertices: r.vertices,
    });
    uc.vydels += r.n_vydel;
    ob.vydels += r.n_vydel;
  }
  return [...byOblast.values()].map((o) => ({ ...o, children: [...o.children.values()] }));
}

/** Flat list of forestries — for search instead of a tree of checkboxes. */
export function forestries() {
  return need().prepare(`
    SELECT layer_key key, oblast, uchrezhdenie, lesnichestvo name,
           n_vydel vydels, n_kvartal kvartaly, vertices
    FROM forestry ORDER BY oblast, uchrezhdenie, lesnichestvo
  `).all();
}

export function facets() {
  const d = need();
  const stmt = d.prepare('SELECT value, n FROM facet WHERE col = ? ORDER BY n DESC LIMIT 300');
  const list = (col) => stmt.all(col).map((r) => ({ value: String(r.value), count: r.n }));
  return {
    poroda: list('poroda'),
    bonitet: list('bonitet'),
    kat_zem: list('kat_zem'),
    tip_lesa: list('tip_lesa'),
  };
}

/* ---------------------------------------------------------------- filters */

export function parseNumbers(text) {
  if (!text) return null;
  const out = new Set();
  for (const part of String(text).split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
    } else if (/^\d+$/.test(part)) {
      out.add(Number(part));
    }
  }
  return out.size ? [...out] : null;
}

/**
 * Checking an arbitrary query.
 *
 * The connection is read-only, but that alone cannot be relied on: we reject
 * anything that does not start with SELECT or WITH, and refuse to run several
 * statements at once.
 */
export function checkSql(text) {
  const sql = String(text || '').trim().replace(/;\s*$/, '');
  if (!sql) throw new Error('Empty query');
  if (!/^(select|with)\b/i.test(sql)) throw new Error('Only SELECT and WITH are allowed');
  if (/;/.test(sql)) throw new Error('One query at a time');
  return sql;
}

function buildWhere(f = {}) {
  const where = ["kind='vydel'"];
  const params = [];
  let join = '';

  // The user query narrows the selection just like the filters do: it has to
  // return a column of object ids. That way one and the same path leads both
  // to browsing and to export.
  if (f.sql) where.push(`feature.id IN (SELECT id FROM (${checkSql(f.sql)}))`);

  if (f.keys?.length) {
    if (f.keys.length > 30) {
      setSelection(f.keys);
      join = ' JOIN sel ON sel.k = feature.layer_key';
    } else {
      where.push(`feature.layer_key IN (${f.keys.map(() => '?').join(',')})`);
      params.push(...f.keys);
    }
  }
  if (f.oblast) { where.push('oblast = ?'); params.push(f.oblast); }
  if (f.uchrezhdenie) { where.push('uchrezhdenie = ?'); params.push(f.uchrezhdenie); }

  const kv = parseNumbers(f.kvartal);
  if (kv) { where.push(`kvartal IN (${kv.map(() => '?').join(',')})`); params.push(...kv); }
  const vd = parseNumbers(f.vydel);
  if (vd) { where.push(`vydel IN (${vd.map(() => '?').join(',')})`); params.push(...vd); }

  for (const col of ['poroda', 'bonitet', 'kat_zem', 'tip_lesa']) {
    if (f[col]?.length) {
      where.push(`${col} IN (${f[col].map(() => '?').join(',')})`);
      params.push(...f[col]);
    }
  }
  if (f.ploshadMin != null && f.ploshadMin !== '') { where.push('ploshad >= ?'); params.push(Number(f.ploshadMin)); }
  if (f.ploshadMax != null && f.ploshadMax !== '') { where.push('ploshad <= ?'); params.push(Number(f.ploshadMax)); }

  return { sql: where.join(' AND '), params, join };
}

/**
 * Filters that need a look at the objects rather than at the forestry summary.
 *
 * A custom query must be listed here: without it the estimate took the fast
 * path and showed the whole database — 1 629 975 stands instead of 1 351,
 * that is 928 files instead of 86.
 */
function needsScan(f = {}) {
  return Boolean(
    f.sql || f.kvartal || f.vydel
    || f.poroda?.length || f.bonitet?.length || f.kat_zem?.length || f.tip_lesa?.length
    || (f.ploshadMin != null && f.ploshadMin !== '')
    || (f.ploshadMax != null && f.ploshadMax !== ''),
  );
}

/* ---------------------------------------------------------------- browsing */

const BROWSE_COLUMNS = [
  { key: 'oblast' },
  { key: 'lesnichestvo' },
  { key: 'kvartal', num: true },
  { key: 'vydel', num: true },
  { key: 'ploshad', num: true },
  { key: 'poroda' },
  { key: 'bonitet' },
  { key: 'tip_lesa' },
  { key: 'kat_zem' },
];

export const browseColumns = () => BROWSE_COLUMNS;

/** One page of the object table under the current filter. */
export function browse(filters, { offset = 0, limit = 200, sort = null, desc = false } = {}) {
  const d = need();
  const { sql, params, join } = buildWhere(filters);
  const col = BROWSE_COLUMNS.find((c) => c.key === sort);
  const order = col ? `${col.key} ${desc ? 'DESC' : 'ASC'}, feature.id` : 'feature.id';

  const total = d.prepare(`SELECT COUNT(*) n FROM feature${join} WHERE ${sql}`).get(...params).n;
  const cols = BROWSE_COLUMNS.map((c) => `feature.${c.key}`).join(', ');
  const rows = d.prepare(
    `SELECT feature.id, ${cols} FROM feature${join} WHERE ${sql}
     ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);

  return { total, rows, offset, limit };
}

/** One object in full: canonical fields and the raw attributes as they are. */
export function feature(id) {
  const d = need();
  const row = d.prepare('SELECT * FROM feature WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Object not found');
  const data = d.prepare('SELECT props, geom FROM feature_data WHERE feature_id = ?').get(Number(id));
  return {
    row,
    props: data ? JSON.parse(data.props) : {},
    hasGeom: Boolean(data?.geom),
    bbox: { minx: row.minx, miny: row.miny, maxx: row.maxx, maxy: row.maxy },
  };
}

/**
 * An arbitrary query — read only.
 *
 * The connection is opened read-only, but that alone cannot be relied on: we
 * reject anything that does not start with SELECT or WITH, and forbid several
 * statements on one line.
 */
/**
 * Run a query.
 *
 * When it returns an id column it is a selection of objects, which can be
 * browsed and exported. When it does not, it is a report: shown as it is, but
 * with nothing to export — and that has to be said plainly, not left to guess.
 */
export function query(sql, { limit = 500 } = {}) {
  const d = need();
  const text = checkSql(sql);

  const t0 = Date.now();
  const stmt = d.prepare(text);
  if (!stmt.reader) throw new Error('The query returns nothing');
  const rows = stmt.all();
  const truncated = rows.length > limit;
  if (truncated) rows.length = limit;

  const columns = rows.length ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
  const isSelection = columns.includes('id');

  let total = rows.length;
  if (isSelection) {
    total = d.prepare(`SELECT COUNT(*) n FROM (${text})`).get().n;
  }

  return { columns, rows, ms: Date.now() - t0, truncated, isSelection, total };
}

/** List of tables with row counts — something to start a query from. */
/**
 * The current filters as SQL — something to start your own query from.
 * Values are pasted straight into the text: this is text for a human, not for
 * execution (it still runs through checkSql and parameters).
 */
export function filtersAsSql(f = {}) {
  const q = (v) => (typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`);
  const where = ["kind = 'vydel'"];

  if (f.keys?.length) {
    where.push(f.keys.length <= 5
      ? `layer_key IN (${f.keys.map(q).join(', ')})`
      : `layer_key IN (${f.keys.slice(0, 3).map(q).join(', ')}, … ${f.keys.length - 3} more)`);
  }
  const kv = parseNumbers(f.kvartal);
  if (kv) where.push(`kvartal IN (${kv.join(', ')})`);
  const vd = parseNumbers(f.vydel);
  if (vd) where.push(`vydel IN (${vd.join(', ')})`);
  for (const col of ['poroda', 'bonitet', 'kat_zem', 'tip_lesa']) {
    if (f[col]?.length) where.push(`${col} IN (${f[col].map(q).join(', ')})`);
  }
  if (f.ploshadMin != null && f.ploshadMin !== '') where.push(`ploshad >= ${Number(f.ploshadMin)}`);
  if (f.ploshadMax != null && f.ploshadMax !== '') where.push(`ploshad <= ${Number(f.ploshadMax)}`);

  return `SELECT id, lesnichestvo, kvartal, vydel, ploshad, poroda\nFROM feature\nWHERE ${where.join('\n  AND ')}`;
}

export function tables() {
  const d = need();
  return d.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }) => ({
    name,
    columns: d.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name),
  }));
}

/* ---------------------------------------------------------------- selection */

export function preview(filters, {
  budget = VERTEX_BUDGET, split = 'lesnichestvo',
  vdPoly = true, vdLabels = true, kvPoly = true, kvLabels = true, outline = true,
} = {}) {
  const d = need();
  let groups;

  if (!needsScan(filters)) {
    const where = ['1=1'];
    const params = [];
    if (filters.keys?.length) {
      where.push(`layer_key IN (${filters.keys.map(() => '?').join(',')})`);
      params.push(...filters.keys);
    }
    if (filters.oblast) { where.push('oblast = ?'); params.push(filters.oblast); }
    if (filters.uchrezhdenie) { where.push('uchrezhdenie = ?'); params.push(filters.uchrezhdenie); }
    groups = d.prepare(
      `SELECT layer_key, n_vydel n, vertices v, kv_vertices kvv, n_kvartal kvn
       FROM forestry WHERE ${where.join(' AND ')}`,
    ).all(...params);
  } else {
    const { sql, params, join } = buildWhere(filters);
    groups = d.prepare(
      `SELECT feature.layer_key, COUNT(*) n, IFNULL(SUM(nvert),0) v
       FROM feature${join} WHERE ${sql} GROUP BY feature.layer_key`,
    ).all(...params);
    const kv = new Map(d.prepare('SELECT layer_key k, kv_vertices v, n_kvartal n FROM forestry')
      .all().map((r) => [r.k, r]));
    for (const g of groups) {
      g.kvv = kv.get(g.layer_key)?.v || 0;
      g.kvn = kv.get(g.layer_key)?.n || 0;
    }
  }

  // A switched-off layer costs nothing, so the estimate has to follow the
  // switches: with the stand polygons off, a whole region fits one file.
  // The blocks count too — with only the blocks left on, the estimate used to
  // read «0 vertices» while the export still wrote every block polygon.
  let vydels = 0, vertices = 0, files = 0;
  for (const g of groups) {
    const v = (vdPoly ? g.v : 0) + (vdLabels ? g.n : 0);
    const fixed = (kvPoly ? (g.kvv || 0) : 0) + (kvLabels ? (g.kvn || 0) : 0);
    vydels += g.n;
    vertices += v + fixed;
    if (split !== 'lesnichestvo') continue;
    const first = Math.max(budget - fixed, Math.floor(budget / 2));
    files += v <= first ? 1 : 1 + Math.ceil((v - first) / budget);
  }
  // One file still gets written when only the outline is on: it is computed at
  // export time, so its weight is unknown here, but promising zero files and
  // then writing one is worse than rounding up to one.
  if (split !== 'lesnichestvo') {
    const draws = vdPoly || vdLabels || kvPoly || kvLabels || outline;
    files = groups.length === 0 || !draws ? 0 : Math.max(1, Math.ceil(vertices / budget));
  }

  return { vydels, vertices, groups: groups.length, estimatedFiles: vydels === 0 ? 0 : files };
}

/* ---------------------------------------------------------------- export source */

/**
 * A row as an exporter sees it.
 *
 * `canon` carries the resolved columns so a label template can say {poroda}
 * without knowing that the field is called Порода here and ПородаПП there.
 */
const rowToFeature = (r) => ({
  properties: JSON.parse(r.props),
  geometry: r.geom ? JSON.parse(r.geom) : null,
  kvartal: r.kvartal,
  vydel: r.vydel,
  canon: {
    ploshad: r.ploshad,
    poroda: r.poroda,
    bonitet: r.bonitet,
    tip_lesa: r.tip_lesa,
    kat_zem: r.kat_zem,
    lesnichestvo: r.lesnichestvo,
    oblast: r.oblast,
  },
});

const FEATURE_COLUMNS = `feature.kvartal, feature.vydel, feature.ploshad, feature.poroda,
  feature.bonitet, feature.tip_lesa, feature.kat_zem, feature.lesnichestvo, feature.oblast`;

/**
 * The selection in a shape any exporter can use: a list of groups and a read
 * of objects by group. An exporter knows neither the SQL nor the schema.
 */
export function selection(filters) {
  const d = need();
  const { sql, params, join } = buildWhere(filters);

  return {
    groups(split = 'lesnichestvo') {
      if (split === 'none') {
        return [{ layer_key: null, oblast: null, uchrezhdenie: null, lesnichestvo: null }];
      }
      return d.prepare(
        `SELECT DISTINCT feature.layer_key, feature.oblast, feature.uchrezhdenie, feature.lesnichestvo
         FROM feature${join} WHERE ${sql}
         ORDER BY feature.oblast, feature.uchrezhdenie, feature.lesnichestvo`,
      ).all(...params);
    },

    rows(group, { kvartaly = true } = {}) {
      const gSql = group.layer_key ? `${sql} AND feature.layer_key = ?` : sql;
      const gParams = group.layer_key ? [...params, group.layer_key] : params;
      const gJoin = group.layer_key ? '' : join;

      const vydels = d.prepare(
        `SELECT fd.props, fd.geom, ${FEATURE_COLUMNS}
         FROM feature${gJoin} JOIN feature_data fd ON fd.feature_id = feature.id
         WHERE ${gSql}`,
      ).all(...gParams).map(rowToFeature);

      if (!kvartaly) return { vydels, kvartaly: [] };

      const kv = d.prepare(`
        SELECT k.id, fd.props, fd.geom, k.kvartal, k.vydel, k.ploshad, k.poroda,
               k.bonitet, k.tip_lesa, k.kat_zem, k.lesnichestvo, k.oblast
        FROM kvartal_link l
        JOIN feature k ON k.id = l.feature_id
        JOIN feature_data fd ON fd.feature_id = k.id
        WHERE l.layer_key IN (SELECT DISTINCT feature.layer_key FROM feature${gJoin} WHERE ${gSql})
          AND k.kvartal IN (SELECT DISTINCT feature.kvartal FROM feature${gJoin} WHERE ${gSql} AND feature.kvartal IS NOT NULL)
        GROUP BY k.id
      `).all(...gParams, ...gParams).map(rowToFeature);

      return { vydels, kvartaly: kv };
    },
  };
}

/* ---------------------------------------------------------------- service */

export function schemas() {
  const rows = need().prepare('SELECT key, oblast, kind, layer_name, fields, roles, loaded_count FROM layer').all();
  const byShape = new Map();
  for (const r of rows) {
    const roles = JSON.parse(r.roles || '{}');
    const sig = JSON.stringify(roles);
    if (!byShape.has(sig)) {
      byShape.set(sig, { roles, layers: 0, features: 0, oblasts: new Set(), sample: JSON.parse(r.fields || '[]') });
    }
    const s = byShape.get(sig);
    s.layers += 1;
    s.features += r.loaded_count || 0;
    if (r.oblast) s.oblasts.add(r.oblast);
  }
  return [...byShape.values()]
    .map((s) => ({ ...s, oblasts: [...s.oblasts].sort() }))
    .sort((a, b) => b.features - a.features);
}

export function problems() {
  return need().prepare(`
    SELECT key, oblast, layer_name, server_count, loaded_count
    FROM layer WHERE server_count IS NOT NULL AND server_count <> loaded_count
    ORDER BY (server_count - loaded_count) DESC
  `).all();
}
