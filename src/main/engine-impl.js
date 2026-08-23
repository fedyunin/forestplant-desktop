/**
 * Database worker process.
 *
 * Everything that occupies a thread for long lives here: SQLite (better-
 * sqlite3 is synchronous by design), parsing the archive, merging geometry,
 * building KML. None of it belongs in the main process — the window is there,
 * and any such call freezes the interface. A three-second query in the SQL
 * console did exactly that.
 *
 * Communication is by messages: {id, method, args} answered by
 * {id, ok, data|error}. Progress events arrive as separate messages with an
 * event field.
 */

import * as q from './queries.js';
import { loadFromRaw, stats as dbStats } from '../core/db.js';
import { buildLinks } from '../core/link.js';
import { ArcGis } from '../core/arcgis.js';
import { dump, findChanges, readManifest } from '../core/sync.js';
import { getExporter, exporters, sanitizeOptions } from '../exporters/index.js';

const port = process.parentPort;
const emit = (channel, payload) => port.postMessage({ event: channel, payload });

/** The GIS client is built per call: the password comes from the main process. */
const client = (creds) => {
  if (!creds?.username) throw new Error('No credentials set');
  return new ArcGis({
    username: creds.username,
    password: creds.password,
    onLog: (text) => emit('sync:log', { text }),
  });
};

/** Load the archive into the database and relink. Shared by pull and rebuild. */
function rebuild({ dbFile, rawDir, reset }) {
  q.close();
  emit('sync:progress', { type: 'stage', text: 'Loading into the database…' });
  const s = loadFromRaw(dbFile, rawDir, {
    reset,
    onProgress: ({ i, total }) => {
      if (i % 25 === 0 || i === total) emit('sync:progress', { type: 'load', i, total });
    },
  });
  emit('sync:progress', { type: 'stage', text: 'Linking blocks…' });
  const links = buildLinks(dbFile);
  q.openDb(dbFile);
  return { loaded: s.loaded, updated: s.updated, skipped: s.skipped, links };
}

const METHODS = {
  /* ---- database ---- */
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

  /* ---- export ---- */
  exporters: () => exporters(),
  preview: ({ filters, options }) => {
    const o = sanitizeOptions('kml', options || {});
    return q.preview(filters, {
      budget: o.budget, labels: o.labels, split: o.split, kvartaly: o.kvartaly,
    });
  },
  runExport: ({ id, filters, options, outDir, lang }) => {
    const exporter = getExporter(id || 'kml');
    const res = exporter.run({
      data: q.selection(filters),
      options: sanitizeOptions(exporter.id, options || {}),
      outDir,
      lang,
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

  /* ---- syncing ---- */
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
        error: r.error || (r.server_count != null ? `incomplete: ${r.server_count} against ${r.fetched_count}` : ''),
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
    if (!fn) throw new Error(`Unknown call: ${method}`);
    port.postMessage({ id, ok: true, data: await fn(args || {}) });
  } catch (err) {
    port.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
});

port.postMessage({ event: 'ready' });
