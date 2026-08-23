/**
 * IPC главного процесса.
 *
 * Главный процесс держит окно и ничего тяжёлого не делает: база, разбор
 * архива и сборка файлов живут в отдельном рабочем процессе. Здесь только
 * проверка входа, пересылка вызова и единый ответ {ok, data} / {ok:false, error}.
 */

import fs from 'node:fs';

import * as creds from './creds.js';
import * as settings from './settings.js';
import { startEngine, callEngine } from './engine-client.js';

const str = (v) => (typeof v === 'string' ? v : null);
const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null);
const num = (v) => (v !== '' && v !== null && Number.isFinite(Number(v)) ? Number(v) : null);

const needData = () => {
  const p = settings.rawPath();
  if (!p) throw new Error('Не выбран каталог данных — задайте его в настройках');
  return p;
};
const needDb = () => {
  const p = settings.dbPath();
  if (!p) throw new Error('Не выбран каталог данных — задайте его в настройках');
  return p;
};

/** Фильтры приходят из окна: принимаем только известные поля известных типов. */
function sanitizeFilters(f = {}) {
  return {
    keys: arr(f.keys),
    oblast: str(f.oblast),
    uchrezhdenie: str(f.uchrezhdenie),
    kvartal: str(f.kvartal),
    vydel: str(f.vydel),
    poroda: arr(f.poroda),
    bonitet: arr(f.bonitet),
    kat_zem: arr(f.kat_zem),
    tip_lesa: arr(f.tip_lesa),
    sql: str(f.sql),
    ploshadMin: num(f.ploshadMin),
    ploshadMax: num(f.ploshadMax),
  };
}

export function registerHandlers(ipcMain, { getWindow, dialog, shell, log }) {
  // Окно может быть уже закрыто, когда движок досылает последние события
  const send = (channel, payload) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  startEngine({
    onEvent: (channel, payload) => { if (channel !== 'ready') send(channel, payload); },
    onLog: (text) => { log?.(text); send('sync:log', { text }); },
  });

  const ok = (fn) => async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  };

  /* ---------------------------------------------------- база */

  ipcMain.handle('db:open', ok(() => {
    const p = needDb();
    if (!fs.existsSync(p)) throw new Error(`База не найдена: ${p}`);
    return callEngine('open', { dbFile: p });
  }));

  const plain = (name) => ok(() => callEngine(name));
  ipcMain.handle('db:summary', plain('summary'));
  ipcMain.handle('db:tree', plain('tree'));
  ipcMain.handle('db:forestries', plain('forestries'));
  ipcMain.handle('db:facets', plain('facets'));
  ipcMain.handle('db:columns', plain('columns'));
  ipcMain.handle('db:schemas', plain('schemas'));
  ipcMain.handle('db:problems', plain('problems'));
  ipcMain.handle('db:tables', plain('tables'));
  ipcMain.handle('db:filtersAsSql', ok((filters) => callEngine('filtersAsSql', { filters: sanitizeFilters(filters) })));

  ipcMain.handle('db:browse', ok((filters, page) => callEngine('browse', {
    filters: sanitizeFilters(filters),
    page: {
      offset: Math.max(0, num(page?.offset) || 0),
      limit: Math.min(1000, Math.max(1, num(page?.limit) || 200)),
      sort: str(page?.sort),
      desc: Boolean(page?.desc),
    },
  })));

  ipcMain.handle('db:feature', ok((id) => callEngine('feature', { id: num(id) })));
  ipcMain.handle('db:query', ok((sql) => callEngine('query', { sql: str(sql) })));
  ipcMain.handle('db:stats', ok(() => callEngine('stats', { dbFile: needDb() })));

  ipcMain.handle('db:rebuild', ok((reset) => callEngine('rebuild', {
    dbFile: needDb(), rawDir: needData(), reset: Boolean(reset),
  })));

  /* ---------------------------------------------------- экспорт */

  ipcMain.handle('export:list', plain('exporters'));

  ipcMain.handle('export:preview', ok((filters, options) => callEngine('preview', {
    filters: sanitizeFilters(filters), options: options || {},
  })));

  ipcMain.handle('export:pickDir', ok(async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      title: 'Куда сохранить',
      defaultPath: settings.load().exportDir || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.save({ exportDir: r.filePaths[0] });
    return r.filePaths[0];
  }));

  ipcMain.handle('export:run', ok((id, filters, options, outDir) => {
    const dir = str(outDir) || settings.load().exportDir;
    if (!dir) throw new Error('Не выбран каталог для сохранения');
    return callEngine('runExport', {
      id: str(id) || 'kml',
      filters: sanitizeFilters(filters),
      options: options || {},
      outDir: dir,
    });
  }));

  /* ---------------------------------------------------- настройки */

  ipcMain.handle('settings:status', ok(() => ({
    ...settings.status(),
    creds: creds.status(),
  })));

  ipcMain.handle('settings:pickDataDir', ok(async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      title: 'Каталог данных (внутри forest.sqlite и raw)',
      defaultPath: settings.load().dataDir || settings.defaultDataDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.save({ dataDir: r.filePaths[0] });
    const s = settings.status();
    if (s.dbExists) await callEngine('open', { dbFile: s.dbPath });
    return { ...s, creds: creds.status() };
  }));

  ipcMain.handle('settings:reveal', ok((what) => {
    const s = settings.status();
    const target = str(what) === 'raw' ? s.rawPath : s.dbPath;
    if (target && fs.existsSync(target)) shell.showItemInFolder(target);
    else if (s.dataDir && fs.existsSync(s.dataDir)) shell.openPath(s.dataDir);
    return true;
  }));

  ipcMain.handle('creds:save', ok((u, p) => creds.save(str(u), str(p))));
  ipcMain.handle('creds:clear', ok(() => creds.clear()));

  /* ---------------------------------------------------- синхронизация */

  // Пароль расшифровывается в главном процессе (там системная связка ключей)
  // и передаётся движку на время вызова.
  const withCreds = () => {
    const c = creds.load();
    if (!c) throw new Error('Не заданы учётные данные');
    return { username: c.username, password: c.password };
  };

  ipcMain.handle('sync:manifest', ok(() => callEngine('manifest', { rawDir: needData() })));

  ipcMain.handle('sync:check', ok(() => callEngine('checkUpdates', {
    rawDir: needData(), creds: withCreds(),
  })));

  ipcMain.handle('sync:pull', ok((keys) => {
    const list = arr(keys);
    if (!list?.length) throw new Error('Нечего качать');
    return callEngine('pull', {
      rawDir: needData(), dbFile: needDb(), creds: withCreds(), keys: list,
    });
  }));

  ipcMain.handle('shell:reveal', ok((p) => {
    const target = str(p);
    if (target && fs.existsSync(target)) shell.showItemInFolder(target);
    return true;
  }));
}
