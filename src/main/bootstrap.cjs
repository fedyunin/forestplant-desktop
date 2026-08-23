/**
 * Entry point of the main process.
 *
 * A CommonJS wrapper is needed for the packaged application: an ESM entry
 * point works when running from sources, but once packaged the process dies
 * as module loading finishes. The wrapper imports the ESM itself — all the
 * rest of the code stays on modules.
 */

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

function fatal(e) {
  const line = `${new Date().toISOString()} STARTUP FAILURE: ${e?.stack || e}\n`;
  try {
    const f = path.join(app.getPath('userData'), 'app.log');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, line);
  } catch { /* the log must not get in the way */ }
  process.stderr.write(line);
}

import(require('node:url').pathToFileURL(path.join(__dirname, 'index.js')).href)
  .catch(fatal);
