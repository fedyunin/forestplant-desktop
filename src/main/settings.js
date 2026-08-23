/**
 * Application settings.
 *
 * The data lives in one folder holding both the database and the raw archive.
 * One setting instead of two paths — fewer ways to configure it halfway.
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
  // 'system' resolves against the OS locale; 'ru' or 'en' pin it
  language: 'system',
};

let cache = null;

/** Does this folder look like a data folder. */
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
  } catch { /* there has been no first run yet */ }

  cache = { ...DEFAULTS, ...saved };
  if (process.env.FP_DATA) cache.dataDir = process.env.FP_DATA;

  // When started from the project folder, pick up whatever sits next to it
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

/** State for the interface: paths, presence, sizes. */
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
  } catch { /* the archive may not exist */ }

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
    language: s.language,
    effectiveLanguage: language(),
    systemLocale: app.getLocale(),
  };
}

/**
 * Effective interface language.
 *
 * 'system' asks the OS. Electron reports locales like 'ru-RU' or 'en-GB',
 * so only the primary subtag matters; anything we do not translate falls
 * back to English.
 */
export function language() {
  const chosen = load().language;
  if (chosen === 'ru' || chosen === 'en') return chosen;
  const sys = String(app.getLocale() || '').toLowerCase();
  return sys.startsWith('ru') ? 'ru' : 'en';
}

/** Where to suggest putting the data when no folder has been chosen yet. */
export function defaultDataDir() {
  return path.join(app.getPath('documents'), 'ForestFund');
}
