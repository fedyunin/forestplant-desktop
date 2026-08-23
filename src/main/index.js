/**
 * Главный процесс Electron.
 *
 * Окно рендерера изолировано: nodeIntegration выключен, contextIsolation и
 * sandbox включены, весь доступ к данным идёт через типизированный IPC.
 * Ничего из node в рендерер не пробрасывается.
 */

// electron — нативный CommonJS-модуль: ни именованный, ни default импорт из
// ESM его не отдают. createRequire решает это, не заставляя переводить весь
// остальной код на CommonJS.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');

/**
 * Журнал запуска.
 *
 * В собранном приложении вывод в консоль никто не видит, и падение при старте
 * выглядит как «просто не открывается». Пишем в файл рядом с настройками.
 */
const logFile = path.join(app.getPath('userData'), 'app.log');
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch { /* журнал не должен мешать работе */ }
  process.stdout.write(line);
}

process.on('uncaughtException', (e) => {
  log(`НЕПЕРЕХВАЧЕННАЯ ОШИБКА: ${e?.stack || e}`);
  app.exit(1);
});
process.on('unhandledRejection', (e) => {
  log(`НЕОБРАБОТАННЫЙ ОТКАЗ: ${e?.stack || e}`);
});

log(`запуск, версия ${app.getVersion()}, упаковано=${app.isPackaged}`);

import { registerHandlers } from './ipc.js';
import { stopEngine } from './engine-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Лесной фонд — выгрузка',
    backgroundColor: '#14161a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium душит таймеры в фоновом окне: прогресс синхронизации и
      // экспорта замирал бы, стоит переключиться на другое приложение.
      backgroundThrottling: false,
    },
  });

  // Без этого ошибки в окне не видны нигде: рендерер падает молча.
  // Сигнатура события менялась между версиями Electron — поддерживаем обе,
  // иначе обработчик молча ничего не ловит.
  win.webContents.on('console-message', (e, level, message, line, source) => {
    const lvl = typeof e === 'object' && e?.level !== undefined ? e.level : level;
    const msg = typeof e === 'object' && e?.message !== undefined ? e.message : message;
    const src = typeof e === 'object' && e?.sourceId !== undefined ? e.sourceId : source;
    const ln = typeof e === 'object' && e?.lineNumber !== undefined ? e.lineNumber : line;
    const bad = lvl === 'error' || lvl === 'warning' || Number(lvl) >= 2;
    if (bad) log(`[окно] ${String(src).split('/').pop()}:${ln} ${msg}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[окно] процесс упал:', details.reason);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    log(`окно НЕ загрузилось: ${desc} (${code})`);
  });
  win.webContents.on('did-finish-load', () => {
    log('окно загрузилось');
    if (process.argv.includes('--smoke')) runSmoke(win);
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Внешние ссылки — в системный браузер, не в окно приложения
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * Самопроверка окна: `npm start -- --smoke`.
 *
 * Проверяет то, что иначе видно только глазами — что дерево отрисовалось,
 * справочники подтянулись, выбор работает и оценка считается. Без неё ошибка
 * в рендерере обнаруживается только когда её увидит человек.
 */
async function runSmoke(w) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let failed = 0;
  const check = (name, cond, detail = '') => {
    console.log(`  ${cond ? 'OK  ' : 'СБОЙ'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!cond) failed += 1;
  };
  const js = (code) => w.webContents.executeJavaScript(code);

  try {
    await wait(3000);
    console.log('\nСамопроверка окна:');

    const d = await js(`(() => ({
      info: document.getElementById('dbinfo').textContent,
      rows: document.querySelectorAll('#dBody tr').length,
      cols: document.querySelectorAll('#dHead th').length,
      list: document.querySelectorAll('#dList .row:not(.head)').length,
      count: document.getElementById('dCount').textContent,
    }))()`);
    check('база открыта', !d.info.includes('не открыта'), d.info);
    check('таблица объектов', d.rows > 0 && d.cols > 0, `${d.rows} строк, ${d.cols} колонок`);
    check('список лесничеств', d.list > 0, `${d.list}`);
    check('счётчик выборки', /объектов/.test(d.count), d.count);

    const det = await js(`(async () => {
      document.querySelector('#dBody tr').click();
      await new Promise(r => setTimeout(r, 600));
      return { open: !document.getElementById('dDetail').hidden,
               fields: document.querySelectorAll('#dDetailBody .kv dt').length };
    })()`);
    check('карточка объекта', det.open && det.fields > 10, `полей ${det.fields}`);

    const srch = await js(`(async () => {
      const i = document.getElementById('dSearch');
      i.value = 'Каскелен'; i.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 500));
      const n = document.querySelectorAll('#dList .row:not(.head)').length;
      i.value = ''; i.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 400));
      return n;
    })()`);
    check('поиск по списку', srch > 0 && srch < 20, `найдено ${srch}`);

    // SQL как второй способ собрать выборку: запрос с колонкой id должен
    // стать выборкой, пригодной к экспорту, а без неё — остаться отчётом.
    const sqlSel = await js(`(async () => {
      document.querySelector('#dModes .mode[data-mode="sql"]').click();
      await new Promise(r => setTimeout(r, 300));
      document.getElementById('dSqlText').value =
        "SELECT id, lesnichestvo, kvartal, vydel FROM feature WHERE kind='vydel' AND poroda='Сосна' AND ploshad > 50";
      document.getElementById('dSqlRun').click();
      await new Promise(r => setTimeout(r, 4000));
      return { info: document.getElementById('dSqlInfo').textContent,
               rows: document.querySelectorAll('#dBody tr').length,
               count: document.getElementById('dCount').textContent };
    })()`);
    check('SQL даёт выборку', /выборка/.test(sqlSel.info) && sqlSel.rows > 0,
      `${sqlSel.info} · в таблице ${sqlSel.rows}`);

    // Оценка обязана считать по тому же условию: быстрый путь однажды
    // проигнорировал SQL и показал всю базу вместо выборки.
    const sqlPrev = await js(`(async () => {
      const shown = Number((document.getElementById('dSqlInfo').textContent.match(/([\\d\\s ]+) объектов/) || [])[1]
        ?.replace(/\\D/g, '') || 0);
      const r = await window.api.exportData.preview(
        { sql: document.getElementById('dSqlText').value }, {});
      return { shown, est: r.ok ? r.data.vydels : -1 };
    })()`);
    check('оценка совпадает с выборкой SQL', sqlPrev.shown > 0 && sqlPrev.shown === sqlPrev.est,
      `в выборке ${sqlPrev.shown}, в оценке ${sqlPrev.est}`);

    const sqlRep = await js(`(async () => {
      document.getElementById('dSqlText').value =
        "SELECT poroda, COUNT(*) n FROM feature WHERE kind='vydel' GROUP BY poroda ORDER BY n DESC LIMIT 10";
      document.getElementById('dSqlRun').click();
      await new Promise(r => setTimeout(r, 4000));
      return { info: document.getElementById('dSqlInfo').textContent,
               rows: document.querySelectorAll('#dBody tr').length };
    })()`);
    check('SQL без id — отчёт', /отчёт/.test(sqlRep.info) && sqlRep.rows > 0,
      `${sqlRep.info.slice(0, 70)}`);

    const fromFilters = await js(`(async () => {
      document.getElementById('dSqlFromFilters').click();
      await new Promise(r => setTimeout(r, 800));
      return document.getElementById('dSqlText').value;
    })()`);
    check('фильтры переводятся в SQL', /SELECT id/.test(fromFilters), fromFilters.split('\n')[0]);

    // вернуться к фильтрам, чтобы дальнейшие проверки шли по обычному пути
    await js(`(async () => {
      document.querySelector('#dModes .mode[data-mode="filters"]').click();
      await new Promise(r => setTimeout(r, 600));
    })()`);

    // Ради этого база и вынесена в отдельный процесс: пока идёт тяжёлый
    // запрос, окно обязано оставаться живым. Раньше оно замирало.
    const alive = await js(`(async () => {
      const t0 = Date.now();
      const slow = window.api.db.query(
        "SELECT poroda, kat_zem, COUNT(*) n FROM feature WHERE kind='vydel' GROUP BY poroda, kat_zem");
      let ticks = 0;
      const timer = setInterval(() => { ticks++; }, 50);
      const quick = [];
      for (let i = 0; i < 5; i++) {
        const t = Date.now();
        await window.api.db.summary();
        quick.push(Date.now() - t);
        await new Promise(r => setTimeout(r, 100));
      }
      const r = await slow;
      clearInterval(timer);
      return { total: Date.now() - t0, ticks, worst: Math.max(...quick), rows: r.ok ? r.data.rows.length : -1 };
    })()`);
    check('окно живо во время запроса', alive.ticks > 10,
      `таймер сработал ${alive.ticks} раз за ${alive.total} мс`);
    check('короткие вызовы не встают в очередь', alive.worst < 1500,
      `худший ответ ${alive.worst} мс`);

    const ex = await js(`(async () => {
      document.querySelector('.tab[data-tab="export"]').click();
      await new Promise(r => setTimeout(r, 400));
      document.querySelector('#eList .row:not(.head)').click();
      await new Promise(r => setTimeout(r, 900));
      return { tags: document.querySelectorAll('#ePicked .tag').length,
               line: document.getElementById('eLine').textContent,
               opts: document.querySelectorAll('#eOpts [data-k]').length,
               btn: !document.getElementById('eRun').disabled };
    })()`);
    check('выбор для экспорта', ex.tags === 1, `фишек ${ex.tags}`);
    check('настройки формата', ex.opts > 8, `полей ${ex.opts}`);
    check('оценка выборки', /выделов/.test(ex.line), ex.line.slice(0, 60));
    check('кнопка выгрузки', ex.btn);

    // Ждём не по таймеру, а по факту: в собранном приложении первые вызовы
    // холоднее, и фиксированная пауза то хватала, то нет.
    const st = await js(`(async () => {
      document.querySelector('.tab[data-tab="settings"]').click();
      for (let i = 0; i < 60; i++) {
        if (!document.getElementById('sDataDir').textContent.includes('не выбран')
            && document.querySelectorAll('#sSchemas .schema').length > 0) break;
        await new Promise(r => setTimeout(r, 500));
      }
      return { dir: document.getElementById('sDataDir').textContent,
               stats: document.querySelectorAll('#sStore .stat').length,
               bad: document.querySelectorAll('#sBad tr').length,
               schemas: document.querySelectorAll('#sSchemas .schema').length };
    })()`);
    if (st.dir.includes('не выбран')) {
      const probe = await js(`(async () => {
        const active = document.getElementById('page-settings').classList.contains('active');
        const tabOn = document.querySelector('.tab[data-tab="settings"]').classList.contains('active');
        let direct = 'не вызывался';
        try { await loadSettings(); direct = document.getElementById('sDataDir').textContent; }
        catch (e) { direct = 'ОШИБКА ' + (e && e.message ? e.message : e); }
        return { active, tabOn, direct };
      })()`);
      log(`[проба] страница активна=${probe.active}, вкладка активна=${probe.tabOn}, прямой вызов -> ${probe.direct}`);
    }
    check('каталог данных', !st.dir.includes('не выбран'), st.dir);
    check('сводка хранилища', st.stats >= 6, `${st.stats} показателей`);
    check('состояние архива', st.bad > 1, `${st.bad - 1} проблемных слоёв`);
    check('схемы полей', st.schemas > 0, `${st.schemas}`);
  } catch (e) {
    console.error('  СБОЙ самопроверки:', e.message);
    failed += 1;
  }

  console.log(failed === 0 ? '\nВсё в порядке' : `\nПроблем: ${failed}`);
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() => {
  log('приложение готово');
  registerHandlers(ipcMain, { getWindow: () => win, dialog, shell, log });
  log('обработчики IPC зарегистрированы');
  createWindow();
  log(`окно создано: ${Boolean(win)}`);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((e) => log(`СБОЙ ПРИ ЗАПУСКЕ: ${e?.stack || e}`));

app.on('window-all-closed', () => {
  log('все окна закрыты');
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => { log('завершение работы'); stopEngine(); });
