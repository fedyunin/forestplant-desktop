#!/usr/bin/env node
/** Сборка базы из сырого архива. `npm run load -- --reset` */

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

console.log(`Загрузка ${raw} -> ${db}${reset ? ' (с нуля)' : ''}`);
const t0 = Date.now();
let lastLog = 0;

const s = loadFromRaw(db, raw, {
  reset,
  onProgress: ({ i, total, key, rows, action }) => {
    const now = Date.now();
    if (rows > 20000 || now - lastLog > 2000 || i === total) {
      lastLog = now;
      console.log(`  [${i}/${total}] ${key} — ${action}, ${rows} об.`);
    }
  },
});

const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`\nЗагружено слоёв ${s.loaded}, обновлено ${s.updated}, пропущено ${s.skipped}`);
console.log(`Объектов: ${s.features.toLocaleString('ru')} за ${mins} мин`);
console.log('По типам:', s.byKind);

console.log('\nСвязываю кварталы с лесничествами...');
const links = buildLinks(db);
console.log(`  по названию ${links.byName}, по географии ${links.byGeo}`);
console.log(`  лесничеств с кварталами: ${links.forestriesWithKvartaly} из ${links.forestriesTotal}`);

const st = stats(db);
console.log('\nВыделы по областям:');
for (const r of st.byOblast) {
  console.log(`  ${String(r.oblast).padEnd(34)} ${String(r.features).padStart(8)} выд. в ${String(r.layers).padStart(3)} слоях`);
}
console.log(`\nВсего объектов в базе: ${st.features.toLocaleString('ru')}`);
console.log(`Выделов без номера: ${st.noVydelNumber}`);
console.log(`Объектов без геометрии: ${st.noGeom}`);
console.log(`Расхождений «сервер/база»: ${st.mismatched.length}`);
for (const m of st.mismatched) {
  console.log(`   ${m.key}: сервер ${m.server_count}, в базе ${m.loaded_count}`);
}
