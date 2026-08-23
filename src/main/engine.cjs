/**
 * Точка входа рабочего процесса базы.
 *
 * Обёртка на CommonJS по той же причине, что и у главного процесса: ESM-точка
 * входа работает из исходников, но в собранном приложении падает.
 */

const path = require('node:path');

const url = require('node:url').pathToFileURL(path.join(__dirname, 'engine-impl.js')).href;

import(url).catch((e) => {
  process.parentPort?.postMessage({ fatal: String(e?.stack || e) });
});
