#!/usr/bin/env node
/**
 * Синхронизация с сервером и сборка базы одной командой.
 *
 *   npm run sync                    -- докачать изменения и обновить базу
 *   npm run sync -- --check         -- только показать, что изменилось
 *   npm run sync -- --retry-failed  -- повторить упавшие слои
 *   npm run sync -- --full          -- перекачать всё заново
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

// Учётные данные только из окружения или аргументов: в коде им не место.
// В приложении они лежат в системной связке ключей (см. src/main/creds.js).
const username = process.env.FP_USER || opt('user', null);
const password = process.env.FP_PASS || opt('pass', null);
if (!username || !password) {
  console.error('Нужны учётные данные к ГИС. Задайте переменные окружения:');
  console.error('  FP_USER=логин FP_PASS=пароль npm run sync');
  console.error('либо аргументами: npm run sync -- --user логин --pass пароль');
  process.exit(1);
}

const gis = new ArcGis({ username, password, onLog: (m) => console.log(` ${m}`) });

const manifest = readManifest(rawDir);
const first = Object.keys(manifest).length === 0;

let refreshKeys = null;

if (flag('retry-failed')) {
  refreshKeys = Object.values(manifest).filter((r) => !r.ok).map((r) => r.key);
  console.log(`Повторяю ${refreshKeys.length} слоёв, упавших в прошлый раз`);
  if (refreshKeys.length === 0) process.exit(0);
} else if (!first && !flag('full')) {
  console.log('Проверяю, что изменилось на сервере...');
  const ch = await findChanges(gis, { rawDir, jobs: 8, onProgress: ({ i, total }) => {
    if (i % 50 === 0 || i === total) process.stdout.write(`\r  опрошено ${i}/${total}`);
  } });
  process.stdout.write('\n');
  console.log(`  изменилось ${ch.changed.length}, новых ${ch.added.length}, исчезло ${ch.removed.length}`);
  for (const c of ch.changed.slice(0, 25)) console.log(`     ${c.key} — ${c.why}`);
  if (ch.changed.length > 25) console.log(`     ... ещё ${ch.changed.length - 25}`);
  for (const k of ch.removed) console.log(`     ${k} — пропал с сервера, в базе остаётся`);

  if (flag('check')) process.exit(0);
  refreshKeys = [...ch.changed.map((c) => c.key), ...ch.added];
  if (refreshKeys.length === 0) console.log('  изменений нет');
} else if (first) {
  console.log('Первый запуск: качаю всё');
}

if (refreshKeys === null || refreshKeys.length > 0) {
  console.log(`\nВыгрузка (потоков: ${jobs})`);
  const t0 = Date.now();
  const r = await dump(gis, {
    rawDir, jobs, skipExisting: !flag('full'), refreshKeys,
    onProgress: ({ i, total, oblast, path: p, status, count, expected, skipped, error }) => {
      if (status === 'уже есть') return;
      const where = `${oblast} / ${p.slice(1).join(' / ')}`.slice(0, 60);
      const tail = error ? `— ${error}`
        : (status === 'качаю' ? `— ${count}/${expected}`
          : (count != null ? `— ${count} об.${skipped ? `, недоступно ${skipped}` : ''}` : ''));
      console.log(`  [${i}/${total}] ${status.padEnd(9)} ${where} ${tail}`);
    },
  });
  console.log(`\nСлоёв ${r.done}, пропущено ${r.skipped}, ошибок ${r.failed}`);
  console.log(`Объектов ${r.features.toLocaleString('ru')}, ${(r.bytes / 1073741824).toFixed(2)} ГБ, `
    + `${((Date.now() - t0) / 60000).toFixed(1)} мин`);
}

console.log('\nЗагрузка в базу...');
const s = loadFromRaw(dbFile, rawDir);
console.log(`  загружено ${s.loaded}, обновлено ${s.updated}, без изменений ${s.skipped}`);

console.log('Связываю кварталы...');
const links = buildLinks(dbFile);
console.log(`  по названию ${links.byName}, по географии ${links.byGeo}`);
console.log(`  лесничеств с кварталами: ${links.forestriesWithKvartaly} из ${links.forestriesTotal}`);

const st = stats(dbFile);
console.log(`\nВ базе: ${st.features.toLocaleString('ru')} объектов, расхождений ${st.mismatched.length}`);

const bad = Object.values(readManifest(rawDir)).filter((r) => !r.ok);
if (bad.length) {
  const noRights = bad.filter((r) => /403/.test(r.error || '')).length;
  console.log(`\nНедоступно слоёв: ${bad.length} (из них нет прав: ${noRights})`);
  console.log('Повторить только упавшие: npm run sync -- --retry-failed');
}
