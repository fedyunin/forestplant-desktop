#!/usr/bin/env node
/**
 * Starting the application.
 *
 * A separate script is needed because of ELECTRON_RUN_AS_NODE: when that
 * variable is set in the environment (Electron-based editors such as VSCode
 * leave it behind), electron starts as plain node, require('electron')
 * returns the path to the binary instead of the API, and the application
 * dies with an obscure «Cannot read properties of undefined».
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
