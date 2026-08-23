#!/usr/bin/env node
/**
 * Запуск приложения.
 *
 * Отдельный скрипт нужен из-за ELECTRON_RUN_AS_NODE: если эта переменная
 * выставлена в окружении (её оставляют после себя редакторы на Electron —
 * VSCode и подобные), electron стартует как обычная нода, require('electron')
 * возвращает путь к бинарнику вместо API, и приложение падает с невнятным
 * «Cannot read properties of undefined».
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = { ...process.env };
for (const k of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE']) delete env[k];

const child = spawn(require('electron'), [root, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => process.exit(code ?? 0));
