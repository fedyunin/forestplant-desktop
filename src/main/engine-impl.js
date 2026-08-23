/**
 * Рабочий процесс базы.
 *
 * Здесь живёт всё, что надолго занимает поток: SQLite (better-sqlite3
 * синхронный по устройству), разбор архива, склейка геометрии, сборка KML.
 * В главном процессе этого быть не должно — там окно, и любой такой вызов
 * замораживает интерфейс. Запрос на три секунды в SQL-консоли делал именно это.
 *
 * Общение — сообщениями: {id, method, args} в ответ {id, ok, data|error}.
 * События хода работы уходят отдельными сообщениями с полем event.
 */

import * as q from './queries.js';
import { loadFromRaw, stats as dbStats } from '../core/db.js';
import { buildLinks } from '../core/link.js';
import { ArcGis } from '../core/arcgis.js';
import { dump, findChanges, readManifest } from '../core/sync.js';
import { getExporter, exporters, sanitizeOptions } from '../exporters/index.js';

const port = process.parentPort;
const emit = (channel, payload) => port.postMessage({ event: channel, payload });

/** Клиент к ГИС собирается на каждый вызов: пароль приходит из главного процесса. */
const client = (creds) => {
  if (!creds?.username) throw new Error('Не заданы учётные данные');
  return new ArcGis({
    username: creds.username,
    password: creds.password,
    onLog: (text) => emit('sync:log', { text }),
  });
};

/** Загрузка архива в базу и пересвязка. Общий шаг для докачки и пересборки. */
function rebuild({ dbFile, rawDir, reset }) {
  q.close();
  emit('sync:progress', { type: 'stage', text: 'Загружаю в базу…' });
  const s = loadFromRaw(dbFile, rawDir, {
    reset,
    onProgress: ({ i, total }) => {
      if (i % 25 === 0 || i === total) emit('sync:progress', { type: 'load', i, total });
    },
  });
  emit('sync:progress', { type: 'stage', text: 'Связываю кварталы…' });
  const links = buildLinks(dbFile);
  q.openDb(dbFile);
  return { loaded: s.loaded, updated: s.updated, skipped: s.skipped, links };
}

const METHODS = {
  /* ---- база ---- */
  open: ({ dbFile }) => q.openDb(dbFile),
  close: () => { q.close(); return true; },
  summary: () => q.summary(),
  tree: () => q.tree(),
  forestries: () => q.forestries(),
  facets: () => q.facets(),
  columns: () => q.browseColumns(),
  browse: ({ filters, page }) => q.browse(filters, page),
  feature: ({ id }) => q.feature(id),
  query: ({ sql }) => q.query(sql),
  tables: () => q.tables(),
  filtersAsSql: ({ filters }) => q.filtersAsSql(filters),
  schemas: () => q.schemas(),
  problems: () => q.problems(),
  stats: ({ dbFile }) => dbStats(dbFile),
  rebuild,

  /* ---- экспорт ---- */
  exporters: () => exporters(),
  preview: ({ filters, options }) => {
    const o = sanitizeOptions('kml', options || {});
    return q.preview(filters, {
      budget: o.budget, labels: o.labels, split: o.split, kvartaly: o.kvartaly,
    });
  },
  runExport: ({ id, filters, options, outDir }) => {
    const exporter = getExporter(id || 'kml');
    const res = exporter.run({
      data: q.selection(filters),
      options: sanitizeOptions(exporter.id, options || {}),
      outDir,
      onProgress: (p) => emit('export:progress', p),
    });
    return {
      files: res.files.map(({ name, href, vydels, kvartaly }) => ({ name, href, vydels, kvartaly })),
      vydels: res.vydels,
      skippedGeom: res.skippedGeom || 0,
      indexFile: res.indexFile,
      outDir,
    };
  },

  /* ---- синхронизация ---- */
  manifest: ({ rawDir }) => {
    const m = readManifest(rawDir);
    const all = Object.values(m);
    const bad = all.filter((r) => !r.ok);
    return {
      layers: all.length,
      ok: all.length - bad.length,
      bad: bad.map((r) => ({
        key: r.key,
        oblast: r.oblast,
        path: (r.path || []).join(' / '),
        error: r.error || (r.server_count != null ? `недобор: ${r.server_count} против ${r.fetched_count}` : ''),
        noRights: /403/.test(r.error || ''),
      })),
    };
  },

  checkUpdates: ({ rawDir, creds }) => findChanges(client(creds), {
    rawDir,
    jobs: 8,
    onProgress: ({ i, total }) => emit('sync:progress', { type: 'probe', i, total }),
  }),

  pull: async ({ rawDir, dbFile, creds, keys }) => {
    const r = await dump(client(creds), {
      rawDir,
      jobs: 3,
      refreshKeys: keys,
      onProgress: (p) => emit('sync:progress', {
        type: 'layer', i: p.i, total: p.total, key: p.key,
        text: `${p.oblast} / ${(p.path || []).slice(1).join(' / ')}`.slice(0, 80),
        status: p.status, count: p.count, error: p.error,
      }),
    });
    return { ...r, ...rebuild({ dbFile, rawDir, reset: false }) };
  },
};

port.on('message', async (e) => {
  const { id, method, args } = e.data || {};
  try {
    const fn = METHODS[method];
    if (!fn) throw new Error(`Неизвестный вызов: ${method}`);
    port.postMessage({ id, ok: true, data: await fn(args || {}) });
  } catch (err) {
    port.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
});

port.postMessage({ event: 'ready' });
