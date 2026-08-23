/**
 * Настройки приложения.
 *
 * Данные лежат одним каталогом: внутри база и сырой архив. Одна настройка
 * вместо двух путей — так меньше способов настроить наполовину.
 *
 *   db/
 *     forest.sqlite
 *     raw/
 *       _manifest.json
 *       layers/
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { app } = require('electron');

export const DB_NAME = 'forest.sqlite';
export const RAW_NAME = 'raw';

const file = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  dataDir: null,
  exportDir: null,
};

let cache = null;

/** Похож ли каталог на каталог данных. */
export function looksLikeDataDir(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return fs.existsSync(path.join(dir, DB_NAME))
    || fs.existsSync(path.join(dir, RAW_NAME, '_manifest.json'));
}

export function load() {
  if (cache) return cache;
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch { /* первого запуска ещё не было */ }

  cache = { ...DEFAULTS, ...saved };
  if (process.env.FP_DATA) cache.dataDir = process.env.FP_DATA;

  // При запуске из каталога проекта подхватываем то, что рядом
  if (!cache.dataDir) {
    for (const c of [path.resolve(process.cwd(), 'db'), process.cwd()]) {
      if (looksLikeDataDir(c)) { cache.dataDir = c; break; }
    }
  }
  return cache;
}

export function save(patch) {
  const next = { ...load(), ...patch };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  cache = next;
  return next;
}

export const dbPath = () => {
  const d = load().dataDir;
  return d ? path.join(d, DB_NAME) : null;
};

export const rawPath = () => {
  const d = load().dataDir;
  return d ? path.join(d, RAW_NAME) : null;
};

/** Состояние для интерфейса: пути, наличие, размеры. */
export function status() {
  const s = load();
  const db = dbPath();
  const raw = rawPath();
  const size = (p) => {
    try { return fs.statSync(p).size; } catch { return 0; }
  };
  let rawBytes = 0;
  let rawLayers = 0;
  try {
    const dir = path.join(raw, 'layers');
    const files = fs.readdirSync(dir);
    rawLayers = files.length;
    for (const f of files) rawBytes += size(path.join(dir, f));
  } catch { /* архива может не быть */ }

  return {
    dataDir: s.dataDir,
    exportDir: s.exportDir,
    dbPath: db,
    rawPath: raw,
    dbExists: Boolean(db && fs.existsSync(db)),
    dbSize: db ? size(db) : 0,
    rawExists: Boolean(raw && fs.existsSync(path.join(raw, '_manifest.json'))),
    rawSize: rawBytes,
    rawLayers,
    settingsFile: file(),
  };
}

/** Куда предложить положить данные, если каталог ещё не выбран. */
export function defaultDataDir() {
  return path.join(app.getPath('documents'), 'ЛесФонд');
}
