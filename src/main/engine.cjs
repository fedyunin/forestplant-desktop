/**
 * Entry point of the database worker process.
 *
 * A CommonJS wrapper for the same reason as the main process: an ESM entry
 * point works from sources but crashes in the packaged application.
 */

const path = require('node:path');

const url = require('node:url').pathToFileURL(path.join(__dirname, 'engine-impl.js')).href;

import(url).catch((e) => {
  process.parentPort?.postMessage({ fatal: String(e?.stack || e) });
});
