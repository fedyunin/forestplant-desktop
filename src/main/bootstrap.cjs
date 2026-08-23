/**
 * Точка входа главного процесса.
 *
 * Обёртка на CommonJS нужна для собранного приложения: ESM-точка входа
 * работает при запуске из исходников, но в упакованном виде процесс падает
 * при завершении загрузки модулей. Обёртка сама подгружает ESM динамически —
 * весь остальной код остаётся на модулях.
 */

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

function fatal(e) {
  const line = `${new Date().toISOString()} СБОЙ ЗАГРУЗКИ: ${e?.stack || e}\n`;
  try {
    const f = path.join(app.getPath('userData'), 'app.log');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, line);
  } catch { /* журнал не должен мешать */ }
  process.stderr.write(line);
}

import(require('node:url').pathToFileURL(path.join(__dirname, 'index.js')).href)
  .catch(fatal);
