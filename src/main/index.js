/**
 * Electron main process.
 *
 * The renderer window is isolated: nodeIntegration off, contextIsolation and
 * sandbox on, every data access goes through typed IPC. Nothing from node is
 * exposed to the renderer.
 */

// electron is a native CommonJS module: neither a named nor a default import
// from ESM yields it. createRequire solves that without forcing the rest of
// the code back onto CommonJS.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');

/**
 * Startup log.
 *
 * In a packaged application nobody sees console output, and a crash at startup
 * looks like «it just does not open». So we write to a file next to the settings.
 */
const logFile = path.join(app.getPath('userData'), 'app.log');
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch { /* the log must not get in the way */ }
  process.stdout.write(line);
}

process.on('uncaughtException', (e) => {
  log(`UNCAUGHT EXCEPTION: ${e?.stack || e}`);
  app.exit(1);
});
process.on('unhandledRejection', (e) => {
  log(`UNHANDLED REJECTION: ${e?.stack || e}`);
});

log(`start, version ${app.getVersion()}, packaged=${app.isPackaged}`);

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
    title: 'Forest Fund',
    backgroundColor: '#14161a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium throttles timers in a background window: the progress of a
      // sync or an export would freeze as soon as you switch to another app.
      backgroundThrottling: false,
    },
  });

  // Without this, errors in the window are visible nowhere: the renderer dies
  // silently. The signature of the event changed between Electron versions —
  // we support both, otherwise the handler quietly catches nothing.
  win.webContents.on('console-message', (e, level, message, line, source) => {
    const lvl = typeof e === 'object' && e?.level !== undefined ? e.level : level;
    const msg = typeof e === 'object' && e?.message !== undefined ? e.message : message;
    const src = typeof e === 'object' && e?.sourceId !== undefined ? e.sourceId : source;
    const ln = typeof e === 'object' && e?.lineNumber !== undefined ? e.lineNumber : line;
    const bad = lvl === 'error' || lvl === 'warning' || Number(lvl) >= 2;
    if (bad) log(`[window] ${String(src).split('/').pop()}:${ln} ${msg}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[window] the process died:', details.reason);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    log(`the window did NOT load: ${desc} (${code})`);
  });
  win.webContents.on('did-finish-load', () => {
    log('the window loaded');
    if (process.argv.includes('--smoke')) runSmoke(win);
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  // External links go to the system browser, not into the application window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * Self-check of the window: `npm start -- --smoke`.
 *
 * It checks what is otherwise only visible by eye — that the tree rendered,
 * the lookups arrived, picking works and the estimate is computed. Without it
 * a bug in the renderer is found only when a person runs into it.
 *
 * The assertions read data attributes and numbers rather than the visible
 * text, so switching the interface language cannot break them.
 */
async function runSmoke(w) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let failed = 0;
  const check = (name, cond, detail = '') => {
    console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!cond) failed += 1;
  };
  const js = (code) => w.webContents.executeJavaScript(code);

  try {
    await wait(3000);
    console.log('\nWindow self-check:');

    const d = await js(`(() => ({
      info: document.getElementById('dbinfo').textContent,
      rows: document.querySelectorAll('#dBody tr').length,
      cols: document.querySelectorAll('#dHead th').length,
      list: document.querySelectorAll('#dList .row:not(.head)').length,
      count: document.getElementById('dCount').textContent,
      lang: document.documentElement.lang,
    }))()`);
    check('database open', /\d/.test(d.info), d.info);
    check('object table', d.rows > 0 && d.cols > 0, `${d.rows} rows, ${d.cols} columns`);
    check('forestry list', d.list > 0, `${d.list}`);
    check('selection counter', /\d/.test(d.count), d.count);
    check('interface translated', d.lang === 'ru' || d.lang === 'en', d.lang);

    const det = await js(`(async () => {
      document.querySelector('#dBody tr').click();
      await new Promise(r => setTimeout(r, 600));
      return { open: !document.getElementById('dDetail').hidden,
               fields: document.querySelectorAll('#dDetailBody .kv dt').length };
    })()`);
    check('object card', det.open && det.fields > 10, `${det.fields} fields`);

    const srch = await js(`(async () => {
      const i = document.getElementById('dSearch');
      i.value = 'Каскелен'; i.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 500));
      const n = document.querySelectorAll('#dList .row:not(.head)').length;
      i.value = ''; i.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 400));
      return n;
    })()`);
    check('search in the list', srch > 0 && srch < 20, `${srch} found`);

    // Every language must render: a missing key or a broken re-render shows up
    // as a label that stayed in another language.
    const lang = await js(`(async () => {
      const sel = document.getElementById('sLang');
      const was = sel.value;
      const label = () => document.querySelector('.tab[data-tab="data"]').textContent;
      const seen = {};
      for (const code of ['en', 'ru', 'kk']) {
        sel.value = code; sel.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 900));
        seen[code] = label();
      }
      sel.value = was; sel.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 900));
      return { ...seen, back: label() };
    })()`);
    check('language switch', lang.en === 'Data' && lang.ru === 'Данные' && lang.kk === 'Деректер',
      `en=${lang.en} ru=${lang.ru} kk=${lang.kk} restored=${lang.back}`);

    // SQL as the second way of building a selection: a query with an id column
    // must become a selection fit for export, and one without it stays a report.
    const sqlSel = await js(`(async () => {
      document.querySelector('.tab[data-tab="data"]').click();
      document.querySelector('#dModes .mode[data-mode="sql"]').click();
      await new Promise(r => setTimeout(r, 300));
      document.getElementById('dSqlText').value =
        "SELECT id, lesnichestvo, kvartal, vydel FROM feature WHERE kind='vydel' AND poroda='Сосна' AND ploshad > 50";
      document.getElementById('dSqlRun').click();
      await new Promise(r => setTimeout(r, 4000));
      const info = document.getElementById('dSqlInfo');
      return { kind: info.dataset.kind, total: Number(info.dataset.total || 0),
               text: info.textContent,
               rows: document.querySelectorAll('#dBody tr').length };
    })()`);
    check('SQL yields a selection', sqlSel.kind === 'selection' && sqlSel.rows > 0,
      `${sqlSel.text} · ${sqlSel.rows} in the table`);

    // The estimate must count by the same condition: the fast path once
    // ignored the SQL and showed the whole database instead of the selection.
    const sqlPrev = await js(`(async () => {
      const shown = Number(document.getElementById('dSqlInfo').dataset.total || 0);
      const r = await window.api.exportData.preview(
        { sql: document.getElementById('dSqlText').value }, {});
      return { shown, est: r.ok ? r.data.vydels : -1 };
    })()`);
    check('estimate matches the SQL selection', sqlPrev.shown > 0 && sqlPrev.shown === sqlPrev.est,
      `${sqlPrev.shown} selected, ${sqlPrev.est} estimated`);

    const sqlRep = await js(`(async () => {
      document.getElementById('dSqlText').value =
        "SELECT poroda, COUNT(*) n FROM feature WHERE kind='vydel' GROUP BY poroda ORDER BY n DESC LIMIT 10";
      document.getElementById('dSqlRun').click();
      await new Promise(r => setTimeout(r, 4000));
      const info = document.getElementById('dSqlInfo');
      return { kind: info.dataset.kind, text: info.textContent,
               rows: document.querySelectorAll('#dBody tr').length };
    })()`);
    check('SQL without id is a report', sqlRep.kind === 'report' && sqlRep.rows > 0,
      `${sqlRep.text.slice(0, 70)}`);

    const fromFilters = await js(`(async () => {
      document.getElementById('dSqlFromFilters').click();
      await new Promise(r => setTimeout(r, 800));
      return document.getElementById('dSqlText').value;
    })()`);
    check('filters translate into SQL', /SELECT id/.test(fromFilters), fromFilters.split('\n')[0]);

    // back to the filters, so the rest of the checks take the ordinary path
    await js(`(async () => {
      document.querySelector('#dModes .mode[data-mode="filters"]').click();
      await new Promise(r => setTimeout(r, 600));
    })()`);

    // This is what the separate database process is for: while a heavy query
    // runs, the window has to stay alive. It used to freeze.
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
    check('window alive during a query', alive.ticks > 10,
      `the timer fired ${alive.ticks} times over ${alive.total} ms`);
    check('short calls do not queue up', alive.worst < 1500,
      `worst answer ${alive.worst} ms`);

    const ex = await js(`(async () => {
      document.querySelector('.tab[data-tab="export"]').click();
      await new Promise(r => setTimeout(r, 400));
      document.querySelector('#eList .row:not(.head)').click();
      await new Promise(r => setTimeout(r, 900));
      const line = document.getElementById('eLine');
      return { tags: document.querySelectorAll('#ePicked .tag').length,
               line: line.textContent, vydels: Number(line.dataset.vydels || 0),
               opts: document.querySelectorAll('#eOpts [data-k]').length,
               btn: !document.getElementById('eRun').disabled };
    })()`);
    check('export selection', ex.tags === 1, `${ex.tags} tags`);
    check('format settings', ex.opts > 8, `${ex.opts} fields`);
    check('selection estimate', ex.vydels > 0, ex.line.slice(0, 60));
    check('export button', ex.btn);

    // We wait on the fact rather than on a timer: in the packaged application
    // the first calls are colder, and a fixed pause was sometimes too short.
    const st = await js(`(async () => {
      document.querySelector('.tab[data-tab="settings"]').click();
      let dir = null;
      for (let i = 0; i < 60; i++) {
        const s = await window.api.settings.status();
        dir = s.ok ? s.data.dataDir : null;
        if (dir && document.querySelectorAll('#sSchemas .schema').length > 0) break;
        await new Promise(r => setTimeout(r, 500));
      }
      return { dir,
               stats: document.querySelectorAll('#sStore .stat').length,
               bad: document.querySelectorAll('#sBad tr').length,
               schemas: document.querySelectorAll('#sSchemas .schema').length };
    })()`);
    check('data folder', Boolean(st.dir), st.dir || '—');
    check('storage summary', st.stats >= 6, `${st.stats} figures`);
    check('archive state', st.bad > 1, `${st.bad - 1} problem layers`);
    check('field schemas', st.schemas > 0, `${st.schemas}`);
  } catch (e) {
    console.error('  self-check FAILED:', e.message);
    failed += 1;
  }

  console.log(failed === 0 ? '\nAll good' : `\nProblems: ${failed}`);
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() => {
  log('application ready');
  registerHandlers(ipcMain, { getWindow: () => win, dialog, shell, log });
  log('IPC handlers registered');
  createWindow();
  log(`window created: ${Boolean(win)}`);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((e) => log(`STARTUP FAILURE: ${e?.stack || e}`));

app.on('window-all-closed', () => {
  log('all windows closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => { log('shutting down'); stopEngine(); });
