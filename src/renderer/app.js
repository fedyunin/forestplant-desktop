/* Window logic. Data access goes only through window.api (see preload). */

import { t, setLang, getLang, locale, applyDom } from './i18n.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString(locale());
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const size = (b) => (b > 1073741824 ? `${(b / 1073741824).toFixed(1)} ${t('unit.gb')}`
  : b > 1048576 ? `${Math.round(b / 1048576)} ${t('unit.mb')}` : `${fmt(b)} ${t('unit.b')}`);

const debounce = (fn, ms) => {
  let timer;
  return (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); };
};

function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, kind === 'err' ? 7000 : 3200);
}

async function call(p, what) {
  const r = await p;
  if (!r.ok) { toast(`${what}: ${r.error}`, 'err'); throw new Error(r.error); }
  return r.data;
}

const state = {
  forestries: [],   // flat list of forestries
  facets: {},
  columns: [],
  exporters: [],
  data: { picked: new Set(), page: 0, limit: 200, sort: null, desc: false, chosen: {}, mode: 'filters', sql: null },
  exp: { picked: new Set(), format: 'kml', options: {}, outDir: null, busy: false, sql: null },
  sync: { changed: [], added: [], busy: false },
};

/* ---------------------------------------------------------------- tabs */

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (!b) return;
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${b.dataset.tab}`));
  if (b.dataset.tab === 'settings') loadSettings();
});

const goTab = (name) => document.querySelector(`.tab[data-tab="${name}"]`).click();

/* ---------------------------------------------------------------- forestry list */

/**
 * The same list serves both tabs. Search rather than a tree of checkboxes:
 * with half a thousand forestries, ticking them one by one is impossible.
 *
 * The two header rows — region, then agency — are picks of their own: one
 * click takes a whole region. Clicking a header that is already fully picked
 * clears it, so the same row both selects and deselects.
 *
 * onPick receives the list of keys a row stands for; the caller decides what
 * selecting means and re-renders.
 */
function renderList(box, picked, onPick, filter = '') {
  const q = filter.trim().toLowerCase();
  const frag = document.createDocumentFragment();
  // A sentinel rather than null: the layer path is short for some services, so
  // both oblast and uchrezhdenie can genuinely be null, and `null !== null`
  // would swallow the header of the very first group.
  const NONE = Symbol('unset');
  let lastOblast = NONE;
  let lastGroup = NONE;
  let shown = 0;

  const visible = state.forestries.filter(
    (f) => !q || `${f.name} ${f.uchrezhdenie || ''} ${f.oblast || ''}`.toLowerCase().includes(q),
  );
  const keysWhere = (pick) => visible.filter(pick);

  const header = (cls, title, rows) => {
    const keys = rows.map((f) => f.key);
    const stands = rows.reduce((s, f) => s + (f.vydels || 0), 0);
    const on = keys.every((k) => picked.has(k));
    const el = document.createElement('div');
    el.className = `row ${cls}${on ? ' on' : ''}`;
    // the count column means the same thing on every row: stands, not rows
    el.innerHTML = `<span class="nm">${esc(title)}</span><span class="n">${fmt(stands)}</span>`;
    el.title = t('list.pickGroup');
    el.addEventListener('click', () => onPick(keys, !on));
    return el;
  };

  for (const f of visible) {
    shown += 1;

    if (f.oblast !== lastOblast) {
      lastOblast = f.oblast;
      lastGroup = NONE;
      frag.appendChild(header('head oblast', f.oblast || '—',
        keysWhere((x) => x.oblast === f.oblast)));
    }
    if (f.uchrezhdenie !== lastGroup) {
      lastGroup = f.uchrezhdenie;
      frag.appendChild(header('head', f.uchrezhdenie || '—',
        keysWhere((x) => x.oblast === f.oblast && x.uchrezhdenie === f.uchrezhdenie)));
    }

    const el = document.createElement('div');
    el.className = `row${picked.has(f.key) ? ' on' : ''}`;
    el.dataset.key = f.key;
    el.innerHTML = `<span class="nm">${esc(f.name)}</span><span class="n">${fmt(f.vydels)}</span>`;
    el.addEventListener('click', () => onPick([f.key], !picked.has(f.key)));
    frag.appendChild(el);
  }

  // A pick rebuilds the list, and a rebuilt list starts at the top; picking a
  // forestry halfway down would throw the user back to the first region.
  const scroll = box.scrollTop;
  box.innerHTML = '';
  box.appendChild(frag);
  box.scrollTop = scroll;
  return shown;
}

const visibleKeys = (filter) => {
  const q = filter.trim().toLowerCase();
  return state.forestries
    .filter((f) => !q || `${f.name} ${f.uchrezhdenie || ''} ${f.oblast || ''}`.toLowerCase().includes(q))
    .map((f) => f.key);
};

/* ================================================================ DATA */

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
  renderList($('dList'), state.data.picked, (keys, on) => {
    for (const k of keys) {
      if (on) state.data.picked.add(k);
      else state.data.picked.delete(k);
    }
    $('dPicked').textContent = state.data.picked.size
      ? t('list.picked', { n: state.data.picked.size }) : t('list.all');
    state.data.page = 0;
    renderDataList();
    loadRows();
  }, $('dSearch').value);
}

$('dSearch').addEventListener('input', debounce(renderDataList, 150));
$('dClear').addEventListener('click', () => {
  state.data.picked.clear();
  $('dPicked').textContent = t('list.all');
  renderDataList();
  state.data.page = 0;
  loadRows();
});

const loadRows = debounce(async () => {
  const { page, limit, sort, desc } = state.data;
  let res;
  try {
    res = await call(window.api.db.browse(dataFilters(), { offset: page * limit, limit, sort, desc }), t('tab.data'));
  } catch { return; }

  $('dCount').textContent = t('data.objects', { n: fmt(res.total) });
  $('dEmpty').hidden = res.rows.length > 0;

  $('dHead').innerHTML = `<tr>${state.columns.map((c) => {
    const on = sort === c.key ? ' class="sorted"' : '';
    const mark = sort === c.key ? (desc ? ' ↓' : ' ↑') : '';
    return `<th data-key="${c.key}"${on}>${esc(t(`col.${c.key}`))}${mark}</th>`;
  }).join('')}</tr>`;

  $('dBody').innerHTML = res.rows.map((r) => `<tr data-id="${r.id}">${
    state.columns.map((c) => {
      const v = r[c.key];
      const txt = v === null || v === undefined || String(v).trim() === '' ? '—' : v;
      return `<td class="${c.num ? 'num' : ''}">${esc(txt)}</td>`;
    }).join('')}</tr>`).join('');

  const from = res.total ? page * limit + 1 : 0;
  $('dRange').textContent = t('data.range', {
    from: fmt(from), to: fmt(Math.min(res.total, (page + 1) * limit)), total: fmt(res.total),
  });
  $('dPrev').disabled = page === 0;
  $('dNext').disabled = (page + 1) * limit >= res.total;
}, 200);

$('dHead').addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (!th || !th.dataset.key) return;
  const k = th.dataset.key;
  state.data.desc = state.data.sort === k ? !state.data.desc : false;
  state.data.sort = k;
  state.data.page = 0;
  loadRows();
});

$('dBody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.id) return;
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
  const titles = { poroda: t('filter.poroda'), kat_zem: t('filter.katZem'), bonitet: t('filter.bonitet') };
  $('dFacets').innerHTML = Object.entries(titles).map(([k, title]) => `
    <div class="facet-group"><h4>${esc(title)}</h4><div class="chips" data-col="${k}">${
  (state.facets[k] || []).slice(0, 40).map((it) => {
    const on = state.data.chosen[k]?.has(it.value) ? ' on' : '';
    return `<button class="chip${on}" data-v="${esc(it.value)}">${esc(it.value.trim() || '—')}<span class="n">${fmt(it.count)}</span></button>`;
  }).join('')
}</div></div>`).join('');
  $('dFacets').dataset.built = '1';
}

$('dFacets').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const col = chip.closest('.chips').dataset.col;
  const v = chip.dataset.v;
  state.data.chosen[col] = state.data.chosen[col] || new Set();
  if (state.data.chosen[col].has(v)) state.data.chosen[col].delete(v);
  else state.data.chosen[col].add(v);
  chip.classList.toggle('on');
  state.data.page = 0;
  loadRows();
});

async function showFeature(id) {
  let f;
  try { f = await call(window.api.db.feature(id), t('detail.parsed')); } catch { return; }
  $('dDetail').hidden = false;
  $('dDetailTitle').textContent = t('detail.title', {
    kvartal: f.row.kvartal ?? '—', vydel: f.row.vydel ?? '—',
  });

  const skip = new Set(['id', 'layer_key', 'les_key', 'minx', 'miny', 'maxx', 'maxy']);
  const canon = Object.entries(f.row).filter(([k, v]) => !skip.has(k) && v !== null && v !== '');
  const raw = Object.entries(f.props).filter(([, v]) => v !== null && String(v).trim() !== '');

  const dl = (pairs) => `<dl class="kv">${pairs.map(([k, v]) => `<dt title="${esc(k)}">${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  $('dDetailBody').innerHTML = `<h4>${t('detail.parsed')}</h4>${dl(canon)}`
    + `<h4>${t('detail.raw')}</h4>${dl(raw)}`
    + `<h4>${t('detail.extent')}</h4>${dl([
      [t('detail.geometry'), f.hasGeom ? t('detail.yes') : t('detail.no')],
      [t('detail.lon'), `${f.bbox.minx?.toFixed(5)} … ${f.bbox.maxx?.toFixed(5)}`],
      [t('detail.lat'), `${f.bbox.miny?.toFixed(5)} … ${f.bbox.maxy?.toFixed(5)}`]])}`;
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

/* ---------------------------------------------------------------- SQL as a filter */

/**
 * The second way of building the same selection.
 *
 * SQL used to live in a popup and was a dead end: it showed a table and that
 * was all. Now a query returning an id column narrows the selection just like
 * the filters do, so the shared path continues from there: browsing, the
 * estimate, the export.
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
  const sql = await call(window.api.db.filtersAsSql(dataFilters()), t('mode.sql'));
  state.data.mode = was;
  $('dSqlText').value = sql;
});

$('dSqlRun').addEventListener('click', async () => {
  const sql = $('dSqlText').value.trim();
  if (!sql) return;
  $('dSqlInfo').textContent = t('sql.running');
  let r;
  try { r = await call(window.api.db.query(sql), t('mode.sql')); } catch {
    $('dSqlInfo').textContent = '';
    return;
  }

  if (r.isSelection) {
    // The query returned ids — from here on it behaves like the filters
    state.data.sql = sql;
    state.data.page = 0;
    // dataset holds the same numbers in a language-neutral form: the window
    // self-check reads them instead of parsing the visible text
    $('dSqlInfo').dataset.kind = 'selection';
    $('dSqlInfo').dataset.total = r.total;
    $('dSqlInfo').textContent = t('sql.selection', { n: fmt(r.total), ms: r.ms });
    loadRows();
  } else {
    // A report: show it as it is and say plainly that there is nothing to export
    state.data.sql = null;
    $('dSqlInfo').dataset.kind = 'report';
    $('dSqlInfo').dataset.total = r.rows.length;
    $('dSqlInfo').textContent = t('sql.report', { n: fmt(r.rows.length), ms: r.ms })
      + (r.truncated ? t('sql.truncated') : '') + t('sql.reportNoExport');
    $('dCount').textContent = '';
    $('dEmpty').hidden = r.rows.length > 0;
    $('dHead').innerHTML = `<tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
    $('dBody').innerHTML = r.rows.map((row) => `<tr>${r.columns.map((c) => {
      const v = row[c];
      return `<td class="${typeof v === 'number' ? 'num' : ''}">${esc(v ?? '—')}</td>`;
    }).join('')}</tr>`).join('');
    $('dRange').textContent = t('sql.reportRows', { n: fmt(r.rows.length) });
    $('dPrev').disabled = true;
    $('dNext').disabled = true;
  }
});

async function fillSqlTables() {
  const tables = await call(window.api.db.tables(), t('sql.tables'));
  $('dSqlTables').innerHTML = `<option value="">${t('sql.tables')}</option>`
    + tables.map((x) => `<option value="${esc(x.name)}">${esc(x.name)} (${x.columns.length})</option>`).join('');
}

$('dSqlTables').addEventListener('change', (e) => {
  if (e.target.value) $('dSqlText').value = `SELECT * FROM ${e.target.value} LIMIT 100`;
});

/* ================================================================ EXPORT */

function renderExpList() {
  renderList($('eList'), state.exp.picked, (keys, on) => {
    for (const k of keys) {
      if (on) state.exp.picked.add(k);
      else state.exp.picked.delete(k);
    }
    renderExpList();
    renderPicked();
    refreshPreview();
  }, $('eSearch').value);
}

const TAG_LIMIT = 12;

function renderPicked() {
  const byKey = new Map(state.forestries.map((f) => [f.key, f]));
  // the empty-state text lives in the attribute: the stylesheet knows no language
  $('ePicked').dataset.empty = t('export.nothingPicked');

  const keys = [...state.exp.picked];
  const tag = (k) => {
    const f = byKey.get(k);
    return `<span class="tag" data-key="${k}"><b>${esc(f?.name || k)}</b>
      <span class="n">${fmt(f?.vydels || 0)}</span><span class="x">×</span></span>`;
  };

  // A whole region is fifty forestries; fifty chips are a wall, not a list
  if (keys.length > TAG_LIMIT) {
    const stands = keys.reduce((s, k) => s + (byKey.get(k)?.vydels || 0), 0);
    const regions = [...new Set(keys.map((k) => byKey.get(k)?.oblast).filter(Boolean))];
    $('ePicked').innerHTML = `<span class="tag summary"><b>${t('export.pickedMany', { n: keys.length })}</b>
      <span class="n">${fmt(stands)}</span></span>`
      + regions.slice(0, 3).map((r) => `<span class="tag quiet">${esc(r)}</span>`).join('')
      + (regions.length > 3 ? `<span class="tag quiet">+${regions.length - 3}</span>` : '');
    return;
  }
  $('ePicked').innerHTML = keys.map(tag).join('');
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

/**
 * Format settings are built from the format's own description. Labels there
 * are translation keys, so a format stays free of interface language.
 */
function renderOptions() {
  const ex = state.exporters.find((e) => e.id === state.exp.format);
  $('eHint').textContent = ex ? t(ex.hint) : '';
  const o = state.exp.options;

  // Grouped by type rather than by position in the list: the layout should
  // not shift when a format gains one more option.
  const of = (...types) => ex.options.filter((x) => types.includes(x.type));

  const field = (x) => {
    if (x.type === 'select') {
      return `<label class="inline">${esc(t(x.label))}<select data-k="${x.key}">${
        x.choices.map((c) => `<option value="${esc(c.value)}"${o[x.key] === c.value ? ' selected' : ''}>${esc(t(c.label))}</option>`).join('')}</select></label>`;
    }
    if (x.type === 'text') {
      // the stand template only bites in «custom» mode; greyed out is clearer
      // than hidden, since it shows what the mode would use
      const off = x.key === 'labelTemplate' && o.labelFormat !== 'custom';
      return `<label class="inline wide${off ? ' dim' : ''}">${esc(t(x.label))}<input type="text"
        data-k="${x.key}" value="${esc(o[x.key] ?? '')}" spellcheck="false"
        maxlength="${x.max ?? 200}"${off ? ' disabled' : ''}
        placeholder="${esc(x.placeholder ? t(x.placeholder) : '')}"></label>`;
    }
    if (x.type === 'color') {
      return `<label class="inline">${esc(t(x.label))}<input type="color" data-k="${x.key}" value="${esc(o[x.key])}"></label>`;
    }
    return `<label class="inline">${esc(t(x.label))}<input type="number" data-k="${x.key}" value="${esc(o[x.key])}"
      ${x.min != null ? `min="${x.min}"` : ''} ${x.max != null ? `max="${x.max}"` : ''} ${x.step ? `step="${x.step}"` : ''}></label>`;
  };

  const texts = of('text');
  // the list of placeholders comes from the format itself, so the hint cannot
  // drift away from what the templates actually understand
  const withHint = texts.find((x) => x.hint);
  const hint = withHint
    ? t(withHint.hint, { fields: (withHint.fields || []).map((f) => `{${f}}`).join(' ') })
    : '';

  $('eOpts').innerHTML = `<div class="opt-row">${of('select').map(field).join('')}</div>`
    + `<div class="opt-row opt-checks">${of('bool').map((x) => `<label><input type="checkbox" data-k="${x.key}"${o[x.key] ? ' checked' : ''}> ${esc(t(x.label))}</label>`).join('')}</div>`
    + (texts.length ? `<div class="opt-row">${texts.map(field).join('')}</div>` : '')
    + (hint ? `<p class="hint">${esc(hint)}</p>` : '')
    + `<div class="opt-row">${of('color', 'number').map(field).join('')}</div>`;

  $('eOpts').querySelectorAll('[data-k]').forEach((el) => {
    el.addEventListener('input', () => {
      const k = el.dataset.k;
      o[k] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
      // switching the label mode enables or greys out the template field
      if (k === 'labelFormat') renderOptions();
      drawPreview();
      refreshPreview();
    });
  });
  drawPreview();
}

function renderFormats() {
  $('eFormat').innerHTML = state.exporters
    .map((e) => `<option value="${e.id}"${e.id === state.exp.format ? ' selected' : ''}>${esc(t(e.name))}</option>`)
    .join('');
}

$('eFormat').addEventListener('change', () => {
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

  // The preview shows what the file will actually hold: a layer switched off
  // disappears here too, and the labels are drawn through the same template.
  if (o.vdPoly) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) box(70 + i * 140, 30 + j * 38, 130, 34, o.vdColor, o.vdWidth, o.vdFill);
    }
  }
  if (o.kvPoly) box(65, 25, 420, 82, o.kvColor, o.kvWidth, 0);
  if (o.outline) box(45, 12, 460, 106, o.lesColor, o.lesWidth, 0);

  if (o.vdLabels) {
    ctx.fillStyle = o.vdColor; ctx.font = '11px sans-serif';
    [7, 12, 3].forEach((vd, i) => {
      ctx.fillText(sampleLabel(vd), 110 + i * 140, 50);
    });
  }
  if (o.kvLabels) {
    ctx.fillStyle = o.kvColor; ctx.font = 'bold 12px sans-serif';
    ctx.fillText(sampleKvLabel(), 230, 20);
  }
}

/** A stand label as the current settings would write it, for the preview. */
function sampleLabel(vd) {
  const o = state.exp.options;
  // every placeholder the hint offers has a value here, or a working
  // template would look broken in the preview
  const sample = {
    kv: 29, vd, ploshad: 4.2, poroda: 'Сосна', bonitet: '2', tip: 'С3',
    katzem: 'Покрытые лесом', les: 'Каскеленское', obl: 'Алматинская',
  };
  if (o.labelFormat === 'custom') return fillTemplate(o.labelTemplate || '{vd}', sample);
  if (o.labelFormat === 'kv-vd') return `${sample.kv}-${vd}`;
  if (o.labelFormat === 'full') return t('preview.full', { kv: sample.kv, vd });
  return String(vd);
}

function sampleKvLabel() {
  const o = state.exp.options;
  if (o.kvLabelTemplate) return fillTemplate(o.kvLabelTemplate, { kv: 29 });
  return `${getLang() === 'en' ? 'BL' : 'КВ'}-29`;
}

/** Same substitution the exporter does, kept here only for the preview. */
const fillTemplate = (tpl, v) => String(tpl)
  .replace(/\{(\w+)\}/g, (m, k) => (v[k] === undefined ? '' : String(v[k])))
  .replace(/\s+/g, ' ').trim();

/**
 * Estimates are asked for on every keystroke and answered out of order, so
 * each run takes a ticket and a late answer is dropped. Without it a request
 * still in flight when the last layer is switched off comes back and enables
 * the Run button again — on a selection that would write an empty file.
 */
let previewRun = 0;

const refreshPreview = debounce(async () => {
  const o = state.exp.options;
  const seq = ++previewRun;
  if (state.exp.picked.size === 0 && !state.exp.sql) {
    $('eLine').dataset.vydels = 0;
    $('eLine').textContent = t('export.pickLeft');
    $('eRun').disabled = true;
    return;
  }
  // Every layer switched off would write a file with nothing in it. Only KML
  // has these switches, so the guard asks before it judges.
  if ('vdPoly' in o && !o.vdPoly && !o.vdLabels && !o.kvPoly && !o.kvLabels && !o.outline) {
    $('eLine').dataset.vydels = 0;
    $('eLine').textContent = t('export.nothingToDraw');
    $('eRun').disabled = true;
    return;
  }
  $('eLine').textContent = t('export.counting');
  let p;
  try {
    p = await call(window.api.exportData.preview(
      state.exp.format, expFilters(), state.exp.options,
    ), t('tab.export'));
  } catch { return; }
  if (seq !== previewRun) return;   // a newer run has already answered
  $('eLine').dataset.vydels = p.vydels;
  $('eLine').dataset.vertices = p.vertices;
  $('eLine').dataset.files = p.estimatedFiles;
  const ex = state.exporters.find((e) => e.id === state.exp.format);
  $('eLine').innerHTML = p.vydels === 0
    ? t('export.nothingMatches')
    : t(ex?.estimate || 'export.estimate', {
      vydels: `<b>${fmt(p.vydels)}</b>`,
      vertices: `<b>${fmt(p.vertices)}</b>`,
      files: `<b>${p.estimatedFiles}</b>`,
    }) + (p.estimatedFiles > p.groups ? ` <span class="warn">${t('export.willSplit')}</span>` : '');
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
      state.exp.outDir = await call(window.api.exportData.pickDir(), t('tab.export'));
      if (!state.exp.outDir) return;
    }
    state.exp.busy = true;
    $('eRun').disabled = true;
    $('eRun').textContent = t('export.running');

    const res = await call(window.api.exportData.run(
      state.exp.format, expFilters(), state.exp.options, state.exp.outDir,
    ), t('tab.export'));

    const skipped = res.skippedGeom
      ? ` <span class="warn">${t('export.skippedGeom', { n: fmt(res.skippedGeom) })}</span>` : '';
    $('eLine').innerHTML = t('export.done', {
      vydels: `<b>${fmt(res.vydels)}</b>`, files: `<b>${res.files.length}</b>`,
    }) + skipped;
    toast(t('export.toast', { vydels: fmt(res.vydels), files: res.files.length }), 'ok');
    window.api.reveal(res.indexFile || res.outDir);
  } catch { /* already reported */ } finally {
    state.exp.busy = false;
    $('eRun').textContent = t('export.run');
    refreshPreview();
  }
});

/* ================================================================ SETTINGS */

const stats = (pairs) => pairs
  .map(([k, v]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`)
  .join('');

async function loadSettings() {
  let s;
  try { s = await call(window.api.settings.status(), t('tab.settings')); } catch { return; }

  $('sDataDir').textContent = s.dataDir || t('settings.notChosen');
  $('sCreds').textContent = s.creds.saved
    ? `${s.creds.username} · ${s.creds.source}` : t('settings.credsNone');
  $('sLang').value = s.language || 'system';
  $('sLangSystem').textContent = s.systemLocale || '';

  // The whole block is written at once: with two assignments around an await,
  // a second call to loadSettings — the tab and the language switch both make
  // one — left the summary half-drawn.
  const figures = [
    [t('stat.db'), s.dbExists ? size(s.dbSize) : t('stat.none')],
    [t('stat.archive'), s.rawExists ? size(s.rawSize) : t('stat.none')],
    [t('stat.archiveLayers'), fmt(s.rawLayers)],
  ];
  if (s.dbExists) {
    const sum = await call(window.api.db.summary(), t('settings.summary'));
    figures.push(
      [t('stat.objects'), fmt(sum.features)], [t('stat.vydels'), fmt(sum.vydels)],
      [t('stat.kvartaly'), fmt(sum.kvartaly)], [t('stat.forestries'), fmt(sum.forestries)],
      [t('stat.oblasts'), fmt(sum.oblasts)], [t('stat.schemaVersion'), sum.schema],
    );
  }
  $('sStore').innerHTML = stats(figures);

  try {
    const m = await call(window.api.sync.manifest(), t('settings.archiveState'));
    const noRights = m.bad.filter((b) => b.noRights);
    const other = m.bad.filter((b) => !b.noRights);
    $('sBad').innerHTML = m.bad.length === 0
      ? `<p class="hint">${t('sync.allFetched')}</p>`
      : `<p class="hint">${t('sync.badSummary', {
        layers: fmt(m.layers), bad: m.bad.length, noRights: noRights.length, other: other.length,
      })}</p>
         <table class="grid"><tr><th>${t('sync.layer')}</th><th>${t('sync.oblast')}</th><th>${t('sync.reason')}</th></tr>${
  [...other, ...noRights].slice(0, 60).map((b) => `<tr><td>${esc(b.key)}</td><td>${esc(b.oblast || '')}</td><td>${b.noRights ? t('sync.noRights') : esc(b.error)}</td></tr>`).join('')}</table>`;
  } catch { $('sBad').innerHTML = `<p class="hint">${t('sync.archiveUnavailable')}</p>`; }

  const list = await call(window.api.db.schemas(), t('settings.schemas'));
  const roles = ['les', 'kv', 'vd', 'comp', 'ploshad', 'poroda', 'bonitet', 'tip_lesa', 'kat_zem', 'kat_zasch'];
  $('sSchemas').innerHTML = list.slice(0, 12).map((sc) => `
    <div class="schema">
      <div class="head"><b>${t('data.objects', { n: fmt(sc.features) })}</b>
        <span class="obl">${sc.layers} · ${sc.oblasts.map(esc).join(', ')}</span></div>
      <div class="roles">${roles.map((k) => {
    const f = sc.roles[k];
    return `<span class="role${f ? '' : ' missing'}"><i>${t(`role.${k}`)}:</i> ${f ? esc(f) : '—'}</span>`;
  }).join('')}</div></div>`).join('');
}

$('sLang').addEventListener('change', async () => {
  const r = await call(window.api.settings.setLanguage($('sLang').value), t('settings.language'));
  setLang(r.effectiveLanguage);
  applyDom();
  relabel();
  loadSettings();
});

$('sPickDir').addEventListener('click', async () => {
  const s = await call(window.api.settings.pickDataDir(), t('settings.dataDir'));
  if (!s) return;
  await loadSettings();
  if (s.dbExists) { await bootData(); toast(t('sync.dbConnected'), 'ok'); }
  else toast(t('sync.noDbInDir'), 'err');
});

$('sReveal').addEventListener('click', () => window.api.settings.reveal('db'));

/* ---- credentials ---- */

const closeCreds = () => { $('credsModal').hidden = true; $('credsPass').value = ''; };
$('sCredsSet').addEventListener('click', () => { $('credsModal').hidden = false; $('credsUser').focus(); });
$('credsCancel').addEventListener('click', closeCreds);
$('credsModal').addEventListener('click', (e) => { if (e.target === $('credsModal')) closeCreds(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('credsModal').hidden) closeCreds();
});
$('credsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await window.api.settings.credsSave($('credsUser').value.trim(), $('credsPass').value);
  if (r.ok) { closeCreds(); toast(t('settings.credsSaved'), 'ok'); loadSettings(); } else toast(r.error, 'err');
});
$('sCredsClear').addEventListener('click', async () => {
  await window.api.settings.credsClear();
  toast(t('settings.credsCleared'));
  loadSettings();
});

/* ---- database management ---- */

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
    if (p.i % 100 === 0 || p.i === p.total) {
      syncLog(t(p.type === 'probe' ? 'sync.probed' : 'sync.loaded', { i: p.i, total: p.total }));
    }
  } else if (p.type === 'layer') {
    $('sFill').style.width = `${Math.round((p.i / p.total) * 100)}%`;
    if (p.status === 'skipped') return;
    const tail = p.error ? `— ${p.error}` : (p.count != null ? `— ${fmt(p.count)}` : '');
    syncLog(`[${p.i}/${p.total}] ${t(`sync.status.${p.status}`)} ${p.text} ${tail}`,
      p.status === 'failed' ? 'err' : (p.status === 'done' ? 'ok' : ''));
  } else if (p.type === 'stage') {
    syncLog(p.text);
  }
});
window.api.sync.onLog(({ text }) => syncLog(text));

$('sCheck').addEventListener('click', async () => {
  syncBusy(true);
  try {
    const r = await call(window.api.sync.check(), t('settings.check'));
    state.sync.changed = r.changed; state.sync.added = r.added;
    const n = r.changed.length + r.added.length;
    $('sResult').innerHTML = n === 0
      ? `<p class="hint">${t('sync.noChanges')}</p>`
      : `<p class="hint">${t('sync.toPull', { n })}${r.removed.length ? t('sync.removed', { n: r.removed.length }) : ''}.</p>`
        + `<table class="grid"><tr><th>${t('sync.layer')}</th><th>${t('sync.oblast')}</th><th>${t('sync.whatChanged')}</th></tr>${
          r.changed.slice(0, 60).map((c) => `<tr><td>${esc(c.key)}</td><td>${esc(c.oblast || '')}</td><td>${esc(c.why)}</td></tr>`).join('')}</table>`;
  } catch { /* already reported */ } finally { syncBusy(false); }
});

const pull = async (keys) => {
  if (keys.length === 0) { toast(t('sync.nothingToPull')); return; }
  syncBusy(true);
  try {
    const r = await call(window.api.sync.pull(keys), t('settings.pull'));
    syncLog(t('sync.pullReport', { done: r.done, failed: r.failed, features: fmt(r.features) }), 'ok');
    toast(t('sync.pulled', { n: r.done }), 'ok');
    state.sync.changed = []; state.sync.added = [];
    await bootData();
    await loadSettings();
  } catch { /* already reported */ } finally { syncBusy(false); }
};

$('sPull').addEventListener('click', () => pull([...state.sync.changed.map((c) => c.key), ...state.sync.added]));
$('sRetry').addEventListener('click', async () => {
  const m = await call(window.api.sync.manifest(), t('settings.archiveState'));
  pull(m.bad.filter((b) => !b.noRights).map((b) => b.key));
});

$('sRebuild').addEventListener('click', async () => {
  syncBusy(true);
  try {
    const r = await call(window.api.db.rebuild(true), t('settings.rebuild'));
    syncLog(t('sync.rebuildReport', { loaded: r.loaded, links: `${r.links.byName}+${r.links.byGeo}` }), 'ok');
    toast(t('sync.rebuilt'), 'ok');
    await bootData();
    await loadSettings();
  } catch { /* already reported */ } finally { syncBusy(false); }
});

/* ================================================================ start */

/** Re-render everything whose text comes from data, after a language switch. */
function relabel() {
  $('dPicked').textContent = state.data.picked.size
    ? t('list.picked', { n: state.data.picked.size }) : t('list.all');
  $('dFacets').dataset.built = '';
  if (!$('dFacets').hidden) renderFacets();
  if (state.exporters.length) { renderFormats(); renderOptions(); }
  renderPicked();
  fillSqlTables();
  loadRows();
  refreshPreview();
}

async function bootData() {
  const info = await call(window.api.db.summary(), t('settings.summary'));
  $('dbinfo').textContent = t('db.info', {
    vydels: fmt(info.vydels), forestries: fmt(info.forestries), oblasts: fmt(info.oblasts),
  });
  state.forestries = await call(window.api.db.forestries(), t('stat.forestries'));
  state.columns = await call(window.api.db.columns(), t('tab.data'));
  state.facets = await call(window.api.db.facets(), t('filter.more'));
  state.data.picked.clear();
  state.exp.picked.clear();
  renderDataList();
  renderExpList();
  renderPicked();
  $('dFacets').dataset.built = '';
  loadRows();
  fillSqlTables();
}

(async function init() {
  // Language comes first: everything after it renders already translated
  try {
    const s = await call(window.api.settings.status(), 'settings');
    setLang(s.effectiveLanguage);
  } catch { setLang('en'); }
  applyDom();

  state.exporters = await call(window.api.exportData.list(), t('export.format'));
  state.exp.format = state.exporters[0]?.id || 'kml';
  state.exp.options = Object.fromEntries((state.exporters[0]?.options || []).map((x) => [x.key, x.value]));
  renderFormats();
  renderOptions();

  try {
    await call(window.api.db.open(), t('stat.db'));
    await bootData();
  } catch {
    $('dbinfo').textContent = t('db.notChosen');
    $('dEmpty').hidden = false;
    $('dEmpty').textContent = t('data.chooseDb');
  }
  window.__lang = getLang;   // handy for the smoke test
})();
