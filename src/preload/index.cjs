/**
 * Мост между главным процессом и окном.
 *
 * В окно уходит только этот объект — ни require, ни ipcRenderer напрямую.
 * Список каналов закрытый: новый можно добавить только правкой здесь.
 */

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (cb) => {
  const h = (_e, p) => cb(p);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('api', {
  db: {
    open: () => call('db:open'),
    summary: () => call('db:summary'),
    tree: () => call('db:tree'),
    forestries: () => call('db:forestries'),
    facets: () => call('db:facets'),
    columns: () => call('db:columns'),
    browse: (filters, page) => call('db:browse', filters, page),
    feature: (id) => call('db:feature', id),
    query: (sql) => call('db:query', sql),
    tables: () => call('db:tables'),
    filtersAsSql: (filters) => call('db:filtersAsSql', filters),
    schemas: () => call('db:schemas'),
    problems: () => call('db:problems'),
    stats: () => call('db:stats'),
    rebuild: (reset) => call('db:rebuild', reset),
  },

  exportData: {
    list: () => call('export:list'),
    preview: (filters, options) => call('export:preview', filters, options),
    pickDir: () => call('export:pickDir'),
    run: (id, filters, options, outDir) => call('export:run', id, filters, options, outDir),
    onProgress: on('export:progress'),
  },

  settings: {
    status: () => call('settings:status'),
    pickDataDir: () => call('settings:pickDataDir'),
    reveal: (what) => call('settings:reveal', what),
    credsSave: (u, p) => call('creds:save', u, p),
    credsClear: () => call('creds:clear'),
  },

  sync: {
    manifest: () => call('sync:manifest'),
    check: () => call('sync:check'),
    pull: (keys) => call('sync:pull', keys),
    onProgress: on('sync:progress'),
    onLog: on('sync:log'),
  },

  reveal: (p) => call('shell:reveal', p),
});
