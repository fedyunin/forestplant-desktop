/* Логика окна. Доступ к данным — только через window.api (см. preload). */

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const size = (b) => (b > 1073741824 ? `${(b / 1073741824).toFixed(1)} ГБ`
  : b > 1048576 ? `${Math.round(b / 1048576)} МБ` : `${fmt(b)} Б`);

const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

function toast(msg, kind = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast'; }, kind === 'err' ? 7000 : 3200);
}

async function call(p, what) {
  const r = await p;
  if (!r.ok) { toast(`${what}: ${r.error}`, 'err'); throw new Error(r.error); }
  return r.data;
}

const state = {
  forestries: [],   // плоский список лесничеств
  facets: {},
  columns: [],
  exporters: [],
  data: { picked: new Set(), page: 0, limit: 200, sort: null, desc: false, chosen: {}, mode: 'filters', sql: null },
  exp: { picked: new Set(), format: 'kml', options: {}, outDir: null, busy: false, sql: null },
  sync: { changed: [], added: [], busy: false },
};

/* ---------------------------------------------------------------- вкладки */

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (!b) return;
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${b.dataset.tab}`));
  if (b.dataset.tab === 'settings') loadSettings();
});

const goTab = (name) => document.querySelector(`.tab[data-tab="${name}"]`).click();

/* ---------------------------------------------------------------- список лесничеств */

/**
 * Один и тот же список используется на обеих вкладках. Поиск вместо дерева с
 * флажками: с полутысячей лесничеств отмечать их по одному невозможно.
 */
function renderList(box, picked, onToggle, filter = '') {
  const q = filter.trim().toLowerCase();
  const frag = document.createDocumentFragment();
  let lastGroup = null;
  let shown = 0;

  for (const f of state.forestries) {
    const hay = `${f.name} ${f.uchrezhdenie || ''} ${f.oblast || ''}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    shown += 1;

    const group = `${f.oblast || '—'} · ${f.uchrezhdenie || '—'}`;
    if (group !== lastGroup) {
      lastGroup = group;
      const h = document.createElement('div');
      h.className = 'row head';
      h.textContent = group;
      frag.appendChild(h);
    }

    const el = document.createElement('div');
    el.className = `row${picked.has(f.key) ? ' on' : ''}`;
    el.dataset.key = f.key;
    el.innerHTML = `<span class="nm">${esc(f.name)}</span><span class="n">${fmt(f.vydels)}</span>`;
    el.addEventListener('click', () => onToggle(f.key, el));
    frag.appendChild(el);
  }

  box.innerHTML = '';
  box.appendChild(frag);
  return shown;
}

const visibleKeys = (filter) => {
  const q = filter.trim().toLowerCase();
  return state.forestries
    .filter((f) => !q || `${f.name} ${f.uchrezhdenie || ''} ${f.oblast || ''}`.toLowerCase().includes(q))
    .map((f) => f.key);
};

/* ================================================================ ДАННЫЕ */

function dataFilters() {
  return {
    keys: [...state.data.picked],
    kvartal: $('dKvartal').value,
    vydel: $('dVydel').value,
    ploshadMin: $('dPloshadMin').value,
    ploshadMax: $('dPloshadMax').value,
    poroda: [...(state.data.chosen.poroda || [])],
    kat_zem: [...(state.data.chosen.kat_zem || [])],
    bonitet: [...(state.data.chosen.bonitet || [])],
    sql: state.data.mode === 'sql' ? state.data.sql : null,
  };
}

function renderDataList() {
  renderList($('dList'), state.data.picked, (key, el) => {
    state.data.picked.has(key) ? state.data.picked.delete(key) : state.data.picked.add(key);
    el.classList.toggle('on');
    $('dPicked').textContent = state.data.picked.size ? `выбрано ${state.data.picked.size}` : 'всё';
    state.data.page = 0;
    loadRows();
  }, $('dSearch').value);
}

$('dSearch').addEventListener('input', debounce(renderDataList, 150));
$('dClear').addEventListener('click', () => {
  state.data.picked.clear();
  $('dPicked').textContent = 'всё';
  renderDataList();
  state.data.page = 0;
  loadRows();
  fillSqlTables();
});

const loadRows = debounce(async () => {
  const { page, limit, sort, desc } = state.data;
  let res;
  try {
    res = await call(window.api.db.browse(dataFilters(), { offset: page * limit, limit, sort, desc }), 'Данные');
  } catch { return; }

  $('dCount').textContent = `${fmt(res.total)} объектов`;
  $('dEmpty').hidden = res.rows.length > 0;

  $('dHead').innerHTML = `<tr>${state.columns.map((c) => {
    const on = sort === c.key ? ' class="sorted"' : '';
    const mark = sort === c.key ? (desc ? ' ↓' : ' ↑') : '';
    return `<th data-key="${c.key}"${on}>${esc(c.label)}${mark}</th>`;
  }).join('')}</tr>`;

  $('dBody').innerHTML = res.rows.map((r) => `<tr data-id="${r.id}">${
    state.columns.map((c) => {
      const v = r[c.key];
      const txt = v === null || v === undefined || String(v).trim() === '' ? '—' : v;
      return `<td class="${c.num ? 'num' : ''}">${esc(txt)}</td>`;
    }).join('')}</tr>`).join('');

  const from = res.total ? page * limit + 1 : 0;
  $('dRange').textContent = `${fmt(from)}–${fmt(Math.min(res.total, (page + 1) * limit))} из ${fmt(res.total)}`;
  $('dPrev').disabled = page === 0;
  $('dNext').disabled = (page + 1) * limit >= res.total;
}, 200);

$('dHead').addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (!th) return;
  const k = th.dataset.key;
  state.data.desc = state.data.sort === k ? !state.data.desc : false;
  state.data.sort = k;
  state.data.page = 0;
  loadRows();
});

$('dBody').addEventListener('click', async (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  document.querySelectorAll('#dBody tr').forEach((x) => x.classList.toggle('on', x === tr));
  showFeature(tr.dataset.id);
});

$('dPrev').addEventListener('click', () => { state.data.page -= 1; loadRows(); });
$('dNext').addEventListener('click', () => { state.data.page += 1; loadRows(); });

for (const id of ['dKvartal', 'dVydel', 'dPloshadMin', 'dPloshadMax']) {
  $(id).addEventListener('input', () => { state.data.page = 0; loadRows(); });
}

$('dMoreFilters').addEventListener('click', () => {
  const f = $('dFacets');
  f.hidden = !f.hidden;
  if (!f.hidden && !f.dataset.built) renderFacets();
});

function renderFacets() {
  const titles = { poroda: 'Порода', kat_zem: 'Категория земель', bonitet: 'Бонитет' };
  $('dFacets').innerHTML = Object.entries(titles).map(([k, t]) => `
    <div class="facet-group"><h4>${t}</h4><div class="chips" data-col="${k}">${
    (state.facets[k] || []).slice(0, 40).map((it) => `<button class="chip" data-v="${esc(it.value)}">${esc(it.value.trim() || '—')}<span class="n">${fmt(it.count)}</span></button>`).join('')
  }</div></div>`).join('');
  $('dFacets').dataset.built = '1';

  $('dFacets').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const col = chip.closest('.chips').dataset.col;
    const v = chip.dataset.v;
    state.data.chosen[col] = state.data.chosen[col] || new Set();
    state.data.chosen[col].has(v) ? state.data.chosen[col].delete(v) : state.data.chosen[col].add(v);
    chip.classList.toggle('on');
    state.data.page = 0;
    loadRows();
  });
}

async function showFeature(id) {
  let f;
  try { f = await call(window.api.db.feature(id), 'Объект'); } catch { return; }
  $('dDetail').hidden = false;
  $('dDetailTitle').textContent = `кв ${f.row.kvartal ?? '—'} выд ${f.row.vydel ?? '—'}`;

  const skip = new Set(['id', 'layer_key', 'les_key', 'minx', 'miny', 'maxx', 'maxy']);
  const canon = Object.entries(f.row).filter(([k, v]) => !skip.has(k) && v !== null && v !== '');
  const raw = Object.entries(f.props).filter(([, v]) => v !== null && String(v).trim() !== '');

  const dl = (pairs) => `<dl class="kv">${pairs.map(([k, v]) => `<dt title="${esc(k)}">${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  $('dDetailBody').innerHTML = `<h4>Разобранные поля</h4>${dl(canon)}`
    + `<h4>Как в источнике</h4>${dl(raw)}`
    + `<h4>Охват</h4>${dl([['геометрия', f.hasGeom ? 'есть' : 'нет'],
      ['долгота', `${f.bbox.minx?.toFixed(5)} … ${f.bbox.maxx?.toFixed(5)}`],
      ['широта', `${f.bbox.miny?.toFixed(5)} … ${f.bbox.maxy?.toFixed(5)}`]])}`;
}

$('dDetailClose').addEventListener('click', () => { $('dDetail').hidden = true; });

$('dToExport').addEventListener('click', () => {
  state.exp.picked = new Set(state.data.picked);
  state.exp.sql = state.data.mode === 'sql' ? state.data.sql : null;
  $('eKvartal').value = $('dKvartal').value;
  $('eVydel').value = $('dVydel').value;
  $('ePloshadMin').value = $('dPloshadMin').value;
  $('ePloshadMax').value = $('dPloshadMax').value;
  goTab('export');
  renderExpList();
  renderPicked();
  refreshPreview();
});

/* ---------------------------------------------------------------- SQL как фильтр */

/**
 * Второй способ собрать ту же выборку.
 *
 * Раньше SQL жил во всплывающем окне и был тупиком: показал таблицу — и всё.
 * Теперь запрос, вернувший колонку id, сужает выборку наравне с фильтрами,
 * поэтому дальше работает общий путь: просмотр, оценка, экспорт.
 */
$('dModes').addEventListener('click', (e) => {
  const b = e.target.closest('.mode');
  if (!b) return;
  state.data.mode = b.dataset.mode;
  document.querySelectorAll('#dModes .mode').forEach((x) => x.classList.toggle('on', x === b));
  $('dModeFilters').hidden = state.data.mode !== 'filters';
  $('dModeSql').hidden = state.data.mode !== 'sql';
  state.data.page = 0;
  if (state.data.mode === 'filters' || state.data.sql) loadRows();
});

$('dSqlFromFilters').addEventListener('click', async () => {
  const was = state.data.mode;
  state.data.mode = 'filters';
  const sql = await call(window.api.db.filtersAsSql(dataFilters()), 'Фильтры в SQL');
  state.data.mode = was;
  $('dSqlText').value = sql;
});

$('dSqlRun').addEventListener('click', async () => {
  const sql = $('dSqlText').value.trim();
  if (!sql) return;
  $('dSqlInfo').textContent = 'выполняю…';
  let r;
  try { r = await call(window.api.db.query(sql), 'Запрос'); }
  catch { $('dSqlInfo').textContent = ''; return; }

  if (r.isSelection) {
    // Запрос вернул id — это выборка, дальше всё как с фильтрами
    state.data.sql = sql;
    state.data.page = 0;
    $('dSqlInfo').textContent = `выборка: ${fmt(r.total)} объектов за ${r.ms} мс`;
    loadRows();
  } else {
    // Отчёт: показываем как есть и честно говорим, что выгружать нечего
    state.data.sql = null;
    $('dSqlInfo').textContent = `отчёт: ${fmt(r.rows.length)} строк за ${r.ms} мс`
      + (r.truncated ? ' (обрезано)' : '') + ' · нет колонки id, выгрузить нельзя';
    $('dCount').textContent = '';
    $('dEmpty').hidden = r.rows.length > 0;
    $('dHead').innerHTML = `<tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
    $('dBody').innerHTML = r.rows.map((row) => `<tr>${r.columns.map((c) => {
      const v = row[c];
      return `<td class="${typeof v === 'number' ? 'num' : ''}">${esc(v ?? '—')}</td>`;
    }).join('')}</tr>`).join('');
    $('dRange').textContent = `${fmt(r.rows.length)} строк отчёта`;
    $('dPrev').disabled = true;
    $('dNext').disabled = true;
  }
});

async function fillSqlTables() {
  const t = await call(window.api.db.tables(), 'Таблицы');
  $('dSqlTables').innerHTML = '<option value="">таблицы…</option>'
    + t.map((x) => `<option value="${esc(x.name)}">${esc(x.name)} (${x.columns.length})</option>`).join('');
  $('dSqlTables').addEventListener('change', (e) => {
    if (e.target.value) $('dSqlText').value = `SELECT * FROM ${e.target.value} LIMIT 100`;
  });
}

/* ================================================================ ЭКСПОРТ */

function renderExpList() {
  renderList($('eList'), state.exp.picked, (key, el) => {
    state.exp.picked.has(key) ? state.exp.picked.delete(key) : state.exp.picked.add(key);
    el.classList.toggle('on');
    renderPicked();
    refreshPreview();
  }, $('eSearch').value);
}

function renderPicked() {
  const byKey = new Map(state.forestries.map((f) => [f.key, f]));
  $('ePicked').innerHTML = [...state.exp.picked].map((k) => {
    const f = byKey.get(k);
    return `<span class="tag" data-key="${k}"><b>${esc(f?.name || k)}</b>
      <span class="n">${fmt(f?.vydels || 0)}</span><span class="x">×</span></span>`;
  }).join('');
}

$('ePicked').addEventListener('click', (e) => {
  const x = e.target.closest('.x');
  if (!x) return;
  state.exp.picked.delete(x.closest('.tag').dataset.key);
  renderPicked();
  renderExpList();
  refreshPreview();
});

$('eSearch').addEventListener('input', debounce(renderExpList, 150));
$('eAddFound').addEventListener('click', () => {
  for (const k of visibleKeys($('eSearch').value)) state.exp.picked.add(k);
  renderExpList(); renderPicked(); refreshPreview();
});
$('eClear').addEventListener('click', () => {
  state.exp.picked.clear();
  renderExpList(); renderPicked(); refreshPreview();
});

/** Настройки формата строятся из его же описания. */
function renderOptions() {
  const ex = state.exporters.find((e) => e.id === state.exp.format);
  $('eHint').textContent = ex?.hint || '';
  const o = state.exp.options;

  const checks = ex.options.filter((x) => x.type === 'bool');
  const rest = ex.options.filter((x) => x.type !== 'bool');

  const field = (x) => {
    if (x.type === 'select') {
      return `<label class="inline">${esc(x.label)}<select data-k="${x.key}">${
        x.choices.map((c) => `<option value="${esc(c.value)}"${o[x.key] === c.value ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>`;
    }
    if (x.type === 'color') {
      return `<label class="inline">${esc(x.label)}<input type="color" data-k="${x.key}" value="${esc(o[x.key])}"></label>`;
    }
    return `<label class="inline">${esc(x.label)}<input type="number" data-k="${x.key}" value="${esc(o[x.key])}"
      ${x.min != null ? `min="${x.min}"` : ''} ${x.max != null ? `max="${x.max}"` : ''} ${x.step ? `step="${x.step}"` : ''}></label>`;
  };

  $('eOpts').innerHTML = `<div class="opt-row">${rest.slice(0, 2).map(field).join('')}</div>`
    + `<div class="opt-row opt-checks">${checks.map((x) => `<label><input type="checkbox" data-k="${x.key}"${o[x.key] ? ' checked' : ''}> ${esc(x.label)}</label>`).join('')}</div>`
    + `<div class="opt-row">${rest.slice(2).map(field).join('')}</div>`;

  $('eOpts').querySelectorAll('[data-k]').forEach((el) => {
    el.addEventListener('input', () => {
      const k = el.dataset.k;
      o[k] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
      drawPreview();
      refreshPreview();
    });
  });
  drawPreview();
}

$('eFormat').addEventListener('change', async () => {
  state.exp.format = $('eFormat').value;
  const ex = state.exporters.find((e) => e.id === state.exp.format);
  state.exp.options = Object.fromEntries(ex.options.map((x) => [x.key, x.value]));
  renderOptions();
  refreshPreview();
});

function expFilters() {
  return {
    keys: [...state.exp.picked],
    sql: state.exp.sql || null,
    kvartal: $('eKvartal').value,
    vydel: $('eVydel').value,
    ploshadMin: $('ePloshadMin').value,
    ploshadMax: $('ePloshadMax').value,
  };
}

function drawPreview() {
  const c = $('ePreview');
  const ctx = c.getContext('2d');
  const o = state.exp.options;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#0e1013';
  ctx.fillRect(0, 0, c.width, c.height);
  if (!o.vdColor) return;

  const box = (x, y, w, h, color, lw, fill) => {
    if (fill > 0) { ctx.globalAlpha = fill; ctx.fillStyle = color; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.strokeRect(x, y, w, h);
  };
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) box(70 + i * 140, 30 + j * 38, 130, 34, o.vdColor, o.vdWidth, o.vdFill);
  }
  box(65, 25, 420, 82, o.kvColor, o.kvWidth, 0);
  box(45, 12, 460, 106, o.lesColor, o.lesWidth, 0);
  ctx.fillStyle = o.vdColor; ctx.font = '11px sans-serif';
  ctx.fillText('7', 130, 50); ctx.fillText('12', 270, 50); ctx.fillText('3', 410, 50);
  ctx.fillStyle = o.kvColor; ctx.font = 'bold 12px sans-serif';
  ctx.fillText('КВ-29', 230, 20);
}

const refreshPreview = debounce(async () => {
  if (state.exp.picked.size === 0) {
    $('eLine').textContent = 'выберите лесничества слева';
    $('eRun').disabled = true;
    return;
  }
  $('eLine').textContent = 'считаю…';
  let p;
  try { p = await call(window.api.exportData.preview(expFilters(), state.exp.options), 'Оценка'); } catch { return; }
  $('eLine').innerHTML = p.vydels === 0
    ? 'под фильтр ничего не попадает'
    : `<b>${fmt(p.vydels)}</b> выделов, <b>${fmt(p.vertices)}</b> вершин → примерно <b>${p.estimatedFiles}</b> файл(ов)`
      + (p.estimatedFiles > p.groups ? ' <span class="warn">(с разбивкой)</span>' : '');
  $('eRun').disabled = p.vydels === 0 || state.exp.busy;
}, 200);

for (const id of ['eKvartal', 'eVydel', 'ePloshadMin', 'ePloshadMax']) {
  $(id).addEventListener('input', refreshPreview);
}

window.api.exportData.onProgress(({ done, total, name }) => {
  $('eLine').textContent = `${done}/${total} — ${name}`;
});

$('eRun').addEventListener('click', async () => {
  if (state.exp.busy) return;
  try {
    if (!state.exp.outDir) {
      state.exp.outDir = await call(window.api.exportData.pickDir(), 'Выбор каталога');
      if (!state.exp.outDir) return;
    }
    state.exp.busy = true;
    $('eRun').disabled = true;
    $('eRun').textContent = 'Выгружаю…';

    const res = await call(window.api.exportData.run(
      state.exp.format, expFilters(), state.exp.options, state.exp.outDir,
    ), 'Экспорт');

    const skipped = res.skippedGeom
      ? ` <span class="warn">· пропущено с битой геометрией: ${fmt(res.skippedGeom)}</span>` : '';
    $('eLine').innerHTML = `готово: <b>${fmt(res.vydels)}</b> выделов в <b>${res.files.length}</b> файл(ах)${skipped}`;
    toast(`Выгружено ${fmt(res.vydels)} выделов в ${res.files.length} файл(ов)`, 'ok');
    window.api.reveal(res.indexFile || res.outDir);
  } catch { /* показано */ } finally {
    state.exp.busy = false;
    $('eRun').textContent = 'Выгрузить';
    refreshPreview();
  }
});

/* ================================================================ НАСТРОЙКИ */

async function loadSettings() {
  let s;
  try { s = await call(window.api.settings.status(), 'Настройки'); }
  catch (e) { console.error('настройки не прочитались:', e.message); return; }
  $('sDataDir').textContent = s.dataDir || 'не выбран';
  $('sCreds').textContent = s.creds.saved ? `${s.creds.username} · ${s.creds.source}` : 'не заданы';

  $('sStore').innerHTML = [
    ['База', s.dbExists ? size(s.dbSize) : 'нет'],
    ['Архив', s.rawExists ? size(s.rawSize) : 'нет'],
    ['Слоёв в архиве', fmt(s.rawLayers)],
  ].map(([k, v]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="k">${k}</div></div>`).join('');

  if (s.dbExists) {
    const sum = await call(window.api.db.summary(), 'Сводка');
    $('sStore').innerHTML += [
      ['Объектов', fmt(sum.features)], ['Выделов', fmt(sum.vydels)],
      ['Кварталов', fmt(sum.kvartaly)], ['Лесничеств', fmt(sum.forestries)],
      ['Областей', fmt(sum.oblasts)], ['Версия схемы', sum.schema],
    ].map(([k, v]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="k">${k}</div></div>`).join('');
  }

  try {
    const m = await call(window.api.sync.manifest(), 'Архив');
    const noRights = m.bad.filter((b) => b.noRights);
    const other = m.bad.filter((b) => !b.noRights);
    $('sBad').innerHTML = m.bad.length === 0
      ? '<p class="hint">Все слои забраны полностью.</p>'
      : `<p class="hint">Из ${fmt(m.layers)} слоёв недоступно ${m.bad.length}: нет прав ${noRights.length}, прочих ${other.length}.
         Отказ по правам повторами не лечится.</p>
         <table class="grid"><tr><th>Слой</th><th>Область</th><th>Причина</th></tr>${
  [...other, ...noRights].slice(0, 60).map((b) => `<tr><td>${esc(b.key)}</td><td>${esc(b.oblast || '')}</td><td>${b.noRights ? 'нет прав (403)' : esc(b.error)}</td></tr>`).join('')}</table>`;
  } catch { $('sBad').innerHTML = '<p class="hint">Архив недоступен.</p>'; }

  const list = await call(window.api.db.schemas(), 'Схемы');
  const ROLES = {
    les: 'лесничество', kv: '№ квартала', vd: '№ выдела', comp: 'учреждение',
    ploshad: 'площадь', poroda: 'порода', bonitet: 'бонитет',
    tip_lesa: 'тип леса', kat_zem: 'категория земель', kat_zasch: 'защитность',
  };
  $('sSchemas').innerHTML = list.slice(0, 12).map((s2) => `
    <div class="schema">
      <div class="head"><b>${fmt(s2.features)} объектов</b>
        <span class="obl">${s2.layers} слоёв · ${s2.oblasts.map(esc).join(', ')}</span></div>
      <div class="roles">${Object.entries(ROLES).map(([k, t]) => {
    const f = s2.roles[k];
    return `<span class="role${f ? '' : ' missing'}"><i>${t}:</i> ${f ? esc(f) : '—'}</span>`;
  }).join('')}</div></div>`).join('');
}

$('sPickDir').addEventListener('click', async () => {
  const s = await call(window.api.settings.pickDataDir(), 'Каталог данных');
  if (!s) return;
  await loadSettings();
  if (s.dbExists) { await bootData(); toast('База подключена', 'ok'); }
  else toast('В каталоге нет базы — синхронизируйте или укажите другой', 'err');
});

$('sReveal').addEventListener('click', () => window.api.settings.reveal('db'));

/* ---- учётные данные ---- */

const closeCreds = () => { $('credsModal').hidden = true; $('credsPass').value = ''; };
$('sCredsSet').addEventListener('click', () => { $('credsModal').hidden = false; $('credsUser').focus(); });
$('credsCancel').addEventListener('click', closeCreds);
$('credsModal').addEventListener('click', (e) => { if (e.target === $('credsModal')) closeCreds(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('credsModal').hidden) closeCreds();
});
$('credsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await window.api.settings.credsSave($('credsUser').value.trim(), $('credsPass').value);
  if (r.ok) { closeCreds(); toast('Сохранено в связке ключей', 'ok'); loadSettings(); }
  else toast(r.error, 'err');
});
$('sCredsClear').addEventListener('click', async () => {
  await window.api.settings.credsClear();
  toast('Учётные данные забыты');
  loadSettings();
});

/* ---- управление базой ---- */

function syncLog(text, cls = '') {
  const box = $('sLog');
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = text;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 400) box.removeChild(box.firstChild);
}

function syncBusy(on) {
  state.sync.busy = on;
  for (const id of ['sCheck', 'sRetry', 'sRebuild']) $(id).disabled = on;
  $('sPull').disabled = on || (state.sync.changed.length + state.sync.added.length) === 0;
  $('sProgress').hidden = !on;
  if (on) { $('sLog').innerHTML = ''; $('sFill').style.width = '0%'; }
}

window.api.sync.onProgress((p) => {
  if (p.type === 'probe' || p.type === 'load') {
    $('sFill').style.width = `${Math.round((p.i / p.total) * 100)}%`;
    if (p.i % 100 === 0 || p.i === p.total) syncLog(`${p.type === 'probe' ? 'опрошено' : 'загружено'} ${p.i}/${p.total}`);
  } else if (p.type === 'layer') {
    $('sFill').style.width = `${Math.round((p.i / p.total) * 100)}%`;
    if (p.status === 'уже есть') return;
    syncLog(`[${p.i}/${p.total}] ${p.status} ${p.text} ${p.error ? `— ${p.error}` : (p.count != null ? `— ${fmt(p.count)} об.` : '')}`,
      p.status === 'ошибка' ? 'err' : (p.status === 'готово' ? 'ok' : ''));
  } else if (p.type === 'stage') {
    syncLog(p.text);
  }
});
window.api.sync.onLog(({ text }) => syncLog(text));

$('sCheck').addEventListener('click', async () => {
  syncBusy(true);
  try {
    const r = await call(window.api.sync.check(), 'Проверка');
    state.sync.changed = r.changed; state.sync.added = r.added;
    const n = r.changed.length + r.added.length;
    $('sResult').innerHTML = n === 0
      ? '<p class="hint">Изменений нет, база актуальна.</p>'
      : `<p class="hint">К докачке ${n} слоёв${r.removed.length ? `, исчезло с сервера ${r.removed.length} (в базе остаются)` : ''}.</p>`
        + `<table class="grid"><tr><th>Слой</th><th>Область</th><th>Что изменилось</th></tr>${
          r.changed.slice(0, 60).map((c) => `<tr><td>${esc(c.key)}</td><td>${esc(c.oblast || '')}</td><td>${esc(c.why)}</td></tr>`).join('')}</table>`;
  } catch { /* показано */ } finally { syncBusy(false); }
});

const pull = async (keys) => {
  if (keys.length === 0) { toast('Нечего качать'); return; }
  syncBusy(true);
  try {
    const r = await call(window.api.sync.pull(keys), 'Докачка');
    syncLog(`\nслоёв ${r.done}, ошибок ${r.failed}, объектов ${fmt(r.features)}`, 'ok');
    syncLog(`лесничеств с кварталами: ${r.links.forestriesWithKvartaly} из ${r.links.forestriesTotal}`);
    toast(`Докачано ${r.done} слоёв`, 'ok');
    state.sync.changed = []; state.sync.added = [];
    await bootData();
    await loadSettings();
  } catch { /* показано */ } finally { syncBusy(false); }
};

$('sPull').addEventListener('click', () => pull([...state.sync.changed.map((c) => c.key), ...state.sync.added]));
$('sRetry').addEventListener('click', async () => {
  const m = await call(window.api.sync.manifest(), 'Архив');
  pull(m.bad.filter((b) => !b.noRights).map((b) => b.key));
});

$('sRebuild').addEventListener('click', async () => {
  syncBusy(true);
  try {
    const r = await call(window.api.db.rebuild(true), 'Пересборка');
    syncLog(`загружено ${r.loaded} слоёв, связей ${r.links.byName}+${r.links.byGeo}`, 'ok');
    toast('База пересобрана', 'ok');
    await bootData();
    await loadSettings();
  } catch { /* показано */ } finally { syncBusy(false); }
});

/* ================================================================ старт */

async function bootData() {
  const info = await call(window.api.db.summary(), 'Сводка');
  $('dbinfo').textContent = `${fmt(info.vydels)} выделов · ${fmt(info.forestries)} лесничеств · ${fmt(info.oblasts)} областей`;
  state.forestries = await call(window.api.db.forestries(), 'Лесничества');
  state.columns = await call(window.api.db.columns(), 'Колонки');
  state.facets = await call(window.api.db.facets(), 'Справочники');
  state.data.picked.clear();
  state.exp.picked.clear();
  renderDataList();
  renderExpList();
  renderPicked();
  $('dFacets').dataset.built = '';
  loadRows();
}

(async function init() {
  state.exporters = await call(window.api.exportData.list(), 'Форматы');
  $('eFormat').innerHTML = state.exporters.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  state.exp.format = state.exporters[0]?.id || 'kml';
  state.exp.options = Object.fromEntries((state.exporters[0]?.options || []).map((x) => [x.key, x.value]));
  renderOptions();

  try {
    await call(window.api.db.open(), 'Открытие базы');
    await bootData();
  } catch {
    $('dbinfo').textContent = 'база не открыта';
    $('dEmpty').hidden = false;
    $('dEmpty').innerHTML = 'база не выбрана — укажите каталог данных в <button class="link" id="goSettings">Настройках</button>';
    $('goSettings')?.addEventListener('click', () => goTab('settings'));
  }
})();
