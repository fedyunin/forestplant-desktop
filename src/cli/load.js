#!/usr/bin/env node
/** Build the database from the raw archive. `npm run load -- --reset` */

import { loadFromRaw, stats } from '../core/db.js';
import { buildLinks } from '../core/link.js';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

const raw = opt('raw', 'raw');
const db = opt('db', 'forest.sqlite');
const reset = flag('reset');

console.log(`Loading ${raw} -> ${db}${reset ? ' (from scratch)' : ''}`);
const t0 = Date.now();
let lastLog = 0;

const s = loadFromRaw(db, raw, {
  reset,
  onProgress: ({ i, total, key, rows, action }) => {
    const now = Date.now();
    if (rows > 20000 || now - lastLog > 2000 || i === total) {
      lastLog = now;
      console.log(`  [${i}/${total}] ${key} — ${action}, ${rows} obj.`);
    }
  },
});

const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`\nLayers loaded ${s.loaded}, updated ${s.updated}, skipped ${s.skipped}`);
console.log(`Objects: ${s.features.toLocaleString('en')} in ${mins} min`);
console.log('By kind:', s.byKind);

console.log('\nLinking blocks to forestries...');
const links = buildLinks(db);
console.log(`  by name ${links.byName}, by geography ${links.byGeo}`);
console.log(`  forestries with blocks: ${links.forestriesWithKvartaly} of ${links.forestriesTotal}`);

const st = stats(db);
console.log('\nStands by region:');
for (const r of st.byOblast) {
  console.log(`  ${String(r.oblast).padEnd(34)} ${String(r.features).padStart(8)} stands in ${String(r.layers).padStart(3)} layers`);
}
console.log(`\nObjects in the database: ${st.features.toLocaleString('en')}`);
console.log(`Stands without a number: ${st.noVydelNumber}`);
console.log(`Objects without geometry: ${st.noGeom}`);
console.log(`Mismatches «server/database»: ${st.mismatched.length}`);
for (const m of st.mismatched) {
  console.log(`   ${m.key}: server ${m.server_count}, database ${m.loaded_count}`);
}
