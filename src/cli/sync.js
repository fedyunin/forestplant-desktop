#!/usr/bin/env node
/**
 * Sync with the server and build the database in one command.
 *
 *   npm run sync                    -- fetch the changes and update the database
 *   npm run sync -- --check         -- only show what changed
 *   npm run sync -- --retry-failed  -- retry the layers that failed
 *   npm run sync -- --full          -- refetch everything from scratch
 */

import { ArcGis } from '../core/arcgis.js';
import { dump, findChanges, readManifest } from '../core/sync.js';
import { loadFromRaw, stats } from '../core/db.js';
import { buildLinks } from '../core/link.js';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const flag = (n) => argv.includes(`--${n}`);

const rawDir = opt('raw', 'raw');
const dbFile = opt('db', 'forest.sqlite');
const jobs = Number(opt('jobs', 4));

// Credentials come only from the environment or the arguments: they have no
// place in the code. In the app they live in the system keychain (see
// src/main/creds.js).
const username = process.env.FP_USER || opt('user', null);
const password = process.env.FP_PASS || opt('pass', null);
if (!username || !password) {
  console.error('GIS credentials are required. Set the environment variables:');
  console.error('  FP_USER=login FP_PASS=password npm run sync');
  console.error('or pass arguments: npm run sync -- --user login --pass password');
  process.exit(1);
}

const gis = new ArcGis({ username, password, onLog: (m) => console.log(` ${m}`) });

const manifest = readManifest(rawDir);
const first = Object.keys(manifest).length === 0;

let refreshKeys = null;

if (flag('retry-failed')) {
  refreshKeys = Object.values(manifest).filter((r) => !r.ok).map((r) => r.key);
  console.log(`Retrying ${refreshKeys.length} layers that failed last time`);
  if (refreshKeys.length === 0) process.exit(0);
} else if (!first && !flag('full')) {
  console.log('Checking what changed on the server...');
  const ch = await findChanges(gis, { rawDir, jobs: 8, onProgress: ({ i, total }) => {
    if (i % 50 === 0 || i === total) process.stdout.write(`\r  probed ${i}/${total}`);
  } });
  process.stdout.write('\n');
  console.log(`  changed ${ch.changed.length}, new ${ch.added.length}, gone ${ch.removed.length}`);
  for (const c of ch.changed.slice(0, 25)) console.log(`     ${c.key} — ${c.why}`);
  if (ch.changed.length > 25) console.log(`     ... ${ch.changed.length - 25} more`);
  for (const k of ch.removed) console.log(`     ${k} — gone from the server, kept in the database`);

  if (flag('check')) process.exit(0);
  refreshKeys = [...ch.changed.map((c) => c.key), ...ch.added];
  if (refreshKeys.length === 0) console.log('  nothing changed');
} else if (first) {
  console.log('First run: fetching everything');
}

if (refreshKeys === null || refreshKeys.length > 0) {
  console.log(`\nDump (threads: ${jobs})`);
  const t0 = Date.now();
  const r = await dump(gis, {
    rawDir, jobs, skipExisting: !flag('full'), refreshKeys,
    onProgress: ({ i, total, oblast, path: p, status, count, expected, skipped, error }) => {
      if (status === 'skipped') return;
      const where = `${oblast} / ${p.slice(1).join(' / ')}`.slice(0, 60);
      const tail = error ? `— ${error}`
        : (status === 'fetching' ? `— ${count}/${expected}`
          : (count != null ? `— ${count} obj.${skipped ? `, unavailable ${skipped}` : ''}` : ''));
      console.log(`  [${i}/${total}] ${status.padEnd(9)} ${where} ${tail}`);
    },
  });
  console.log(`\nLayers ${r.done}, skipped ${r.skipped}, failed ${r.failed}`);
  console.log(`Objects ${r.features.toLocaleString('en')}, ${(r.bytes / 1073741824).toFixed(2)} GB, `
    + `${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

console.log('\nLoading into the database...');
const s = loadFromRaw(dbFile, rawDir);
console.log(`  loaded ${s.loaded}, updated ${s.updated}, unchanged ${s.skipped}`);

console.log('Linking blocks...');
const links = buildLinks(dbFile);
console.log(`  by name ${links.byName}, by geography ${links.byGeo}`);
console.log(`  forestries with blocks: ${links.forestriesWithKvartaly} of ${links.forestriesTotal}`);

const st = stats(dbFile);
console.log(`\nIn the database: ${st.features.toLocaleString('en')} objects, ${st.mismatched.length} mismatches`);

const bad = Object.values(readManifest(rawDir)).filter((r) => !r.ok);
if (bad.length) {
  const noRights = bad.filter((r) => /403/.test(r.error || '')).length;
  console.log(`\nUnavailable layers: ${bad.length} (of them no access: ${noRights})`);
  console.log('Retry the failed ones only: npm run sync -- --retry-failed');
}
