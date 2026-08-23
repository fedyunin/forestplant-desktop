/**
 * Запросы к базе.
 *
 * Три правила, за которыми стоят замеры, а не вкусы:
 *
 * 1. Дерево и справочники читаются из материализованных таблиц. Пересчёт по
 *    миллиону строк занимал 22 и 62 секунды соответственно.
 * 2. Оценка выборки по дереву берёт готовые суммы из forestry: сканирование
 *    объектов стоило 30 секунд на каждый клик.
 * 3. Большой список выбранных лесничеств уходит во временную таблицу: разбор
 *    запроса с сотнями подстановок дороже, чем его выполнение.
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
  if (!db) throw new Error('База не открыта');
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

/* ---------------------------------------------------------------- сводка */

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

/* ---------------------------------------------------------------- дерево */

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

/** Плоский список лесничеств — для поиска вместо дерева с флажками. */
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

/* ---------------------------------------------------------------- фильтры */

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
 * Проверка произвольного запроса.
 *
 * Соединение открыто только на чтение, но полагаться на одно это нельзя:
 * отклоняем всё, что не начинается с SELECT или WITH, и не даём выполнить
 * несколько инструкций разом.
 */
export function checkSql(text) {
  const sql = String(text || '').trim().replace(/;\s*$/, '');
  if (!sql) throw new Error('Пустой запрос');
  if (!/^(select|with)\b/i.test(sql)) throw new Error('Разрешены только SELECT и WITH');
  if (/;/.test(sql)) throw new Error('Только один запрос за раз');
  return sql;
}

function buildWhere(f = {}) {
  const where = ["kind='vydel'"];
  const params = [];
  let join = '';

  // Запрос пользователя сужает выборку наравне с фильтрами: он должен
  // возвращать колонку id объектов. Так один и тот же путь ведёт и к
  // просмотру, и к экспорту.
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
 * Фильтры, требующие заглянуть в объекты, а не в сводку по лесничествам.
 *
 * Собственный запрос сюда обязан входить: без него оценка шла быстрым путём и
 * показывала всю базу — 1 629 975 выделов вместо 1 351, то есть 928 файлов
 * вместо 86.
 */
function needsScan(f = {}) {
  return Boolean(
    f.sql || f.kvartal || f.vydel
    || f.poroda?.length || f.bonitet?.length || f.kat_zem?.length || f.tip_lesa?.length
    || (f.ploshadMin != null && f.ploshadMin !== '')
    || (f.ploshadMax != null && f.ploshadMax !== ''),
  );
}

/* ---------------------------------------------------------------- просмотр */

const BROWSE_COLUMNS = [
  { key: 'oblast', label: 'Область' },
  { key: 'lesnichestvo', label: 'Лесничество' },
  { key: 'kvartal', label: 'Квартал', num: true },
  { key: 'vydel', label: 'Выдел', num: true },
  { key: 'ploshad', label: 'Площадь, га', num: true },
  { key: 'poroda', label: 'Порода' },
  { key: 'bonitet', label: 'Бонитет' },
  { key: 'tip_lesa', label: 'Тип леса' },
  { key: 'kat_zem', label: 'Категория земель' },
];

export const browseColumns = () => BROWSE_COLUMNS;

/** Страница таблицы объектов под текущим фильтром. */
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

/** Один объект целиком: канонические поля и сырые атрибуты как есть. */
export function feature(id) {
  const d = need();
  const row = d.prepare('SELECT * FROM feature WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Объект не найден');
  const data = d.prepare('SELECT props, geom FROM feature_data WHERE feature_id = ?').get(Number(id));
  return {
    row,
    props: data ? JSON.parse(data.props) : {},
    hasGeom: Boolean(data?.geom),
    bbox: { minx: row.minx, miny: row.miny, maxx: row.maxx, maxy: row.maxy },
  };
}

/**
 * Произвольный запрос — только чтение.
 *
 * Соединение открыто в режиме чтения, но полагаться на это одно нельзя:
 * отклоняем всё, что не начинается с SELECT или WITH, и запрещаем несколько
 * инструкций в одной строке.
 */
/**
 * Выполнить запрос.
 *
 * Если он вернул колонку id — это выборка объектов, её можно смотреть и
 * выгружать. Если нет — это отчёт: показываем как есть, но выгрузить нечего,
 * и об этом надо сказать прямо, а не оставлять человека гадать.
 */
export function query(sql, { limit = 500 } = {}) {
  const d = need();
  const text = checkSql(sql);

  const t0 = Date.now();
  const stmt = d.prepare(text);
  if (!stmt.reader) throw new Error('Запрос ничего не возвращает');
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

/** Список таблиц с числом строк — чтобы было с чего начать запрос. */
/**
 * Текущие фильтры в виде SQL — чтобы было с чего начать свой запрос.
 * Значения подставляются прямо в текст: это текст для человека, а не для
 * выполнения (выполняется он всё равно через checkSql и параметры).
 */
export function filtersAsSql(f = {}) {
  const q = (v) => (typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`);
  const where = ["kind = 'vydel'"];

  if (f.keys?.length) {
    where.push(f.keys.length <= 5
      ? `layer_key IN (${f.keys.map(q).join(', ')})`
      : `layer_key IN (${f.keys.slice(0, 3).map(q).join(', ')}, … ещё ${f.keys.length - 3})`);
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

/* ---------------------------------------------------------------- выборка */

export function preview(filters, { budget = VERTEX_BUDGET, labels = true, split = 'lesnichestvo', kvartaly = true } = {}) {
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

  let vydels = 0, vertices = 0, files = 0;
  for (const g of groups) {
    const v = g.v + (labels ? g.n : 0);
    vydels += g.n;
    vertices += v;
    if (split !== 'lesnichestvo') continue;
    const fixed = kvartaly ? (g.kvv || 0) + (labels ? (g.kvn || 0) : 0) : 0;
    const first = Math.max(budget - fixed, Math.floor(budget / 2));
    files += v <= first ? 1 : 1 + Math.ceil((v - first) / budget);
  }
  if (split !== 'lesnichestvo') files = vydels === 0 ? 0 : Math.ceil(vertices / budget);

  return { vydels, vertices, groups: groups.length, estimatedFiles: vydels === 0 ? 0 : files };
}

/* ---------------------------------------------------------------- источник для экспорта */

const rowToFeature = (r) => ({
  properties: JSON.parse(r.props),
  geometry: r.geom ? JSON.parse(r.geom) : null,
  kvartal: r.kvartal,
  vydel: r.vydel,
});

/**
 * Выборка в виде, пригодном для любого экспортёра: список групп и чтение
 * объектов по группе. Экспортёр не знает ни про SQL, ни про схему.
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
        `SELECT fd.props, fd.geom, feature.kvartal, feature.vydel
         FROM feature${gJoin} JOIN feature_data fd ON fd.feature_id = feature.id
         WHERE ${gSql}`,
      ).all(...gParams).map(rowToFeature);

      if (!kvartaly) return { vydels, kvartaly: [] };

      const kv = d.prepare(`
        SELECT k.id, fd.props, fd.geom, k.kvartal, k.vydel
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

/* ---------------------------------------------------------------- служебное */

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
