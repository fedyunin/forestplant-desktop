/**
 * Export to CSV — the table without the geometry, for Excel and reports.
 *
 * Two details decide whether the file opens correctly at the other end, and
 * both are settings rather than assumptions:
 *
 * 1. Excel on a Russian-language Windows splits on `;`, not on `,`. A comma
 *    file opens there as one column of text.
 * 2. Without a UTF-8 BOM the same Excel reads Cyrillic as mojibake.
 *
 * The coordinates are optional and are the label point — a point guaranteed
 * to be inside the stand, so a row pasted into a map lands in the right place.
 */

import fs from 'node:fs';
import path from 'node:path';

import { labelPoint } from '../core/geometry.js';
import { SKIP_FIELDS } from '../core/fields.js';

const TEXT = {
  ru: { selection: 'Выборка', selectionFile: 'выборка', noName: 'без имени' },
  en: { selection: 'Selection', selectionFile: 'selection', noName: 'unnamed' },
  kk: { selection: 'Іріктеу', selectionFile: 'іріктеу', noName: 'атауы жоқ' },
};

const safe = (s, fallback) => String(s || '').replace(/[^\p{L}\p{N}\-. ()]+/gu, '_').trim() || fallback;

const COLUMNS = [
  'oblast', 'uchrezhdenie', 'lesnichestvo', 'kvartal', 'vydel',
  'ploshad', 'poroda', 'bonitet', 'tip_lesa', 'kat_zem',
];

const DELIMS = { semicolon: ';', comma: ',', tab: '\t' };

/**
 * One CSV field.
 *
 * A leading `=`, `+`, `@` or `-` is what a spreadsheet reads as the start of a
 * formula; a value out of someone else's database should not become one. A
 * value that parses as a number is left alone, so -4.2 stays -4.2 while
 * «-2+3+cmd|' /C calc'!A0» is neutralised.
 */
function field(value, delim) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+@-]/.test(s) && !Number.isFinite(Number(s))) s = `'${s}`;
  return /["\n\r]|^\s|\s$/.test(s) || s.includes(delim)
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export default {
  id: 'csv',
  name: 'fmt.csv.name',
  hint: 'fmt.csv.hint',
  estimate: 'export.estimateSimple',

  options: [
    { key: 'split', type: 'select', label: 'opt.split', value: 'lesnichestvo',
      choices: [
        { value: 'lesnichestvo', label: 'opt.split.les' },
        { value: 'none', label: 'opt.split.none' },
      ] },
    { key: 'delimiter', type: 'select', label: 'opt.delimiter', value: 'semicolon',
      choices: [
        { value: 'semicolon', label: 'opt.delimiter.semicolon' },
        { value: 'comma', label: 'opt.delimiter.comma' },
        { value: 'tab', label: 'opt.delimiter.tab' },
      ] },
    { key: 'attrs', type: 'select', label: 'opt.attrs', value: 'canonical',
      choices: [
        { value: 'canonical', label: 'opt.attrs.canonical' },
        { value: 'both', label: 'opt.attrs.both' },
      ] },
    { key: 'coords', type: 'bool', label: 'opt.coords', value: true },
    { key: 'bom', type: 'bool', label: 'opt.bom', value: true },
  ],

  /** Rows, not vertices: the estimate counts stands and files. */
  plan: (o) => ({
    split: o.split,
    budget: null,
    vdPoly: false,
    vdLabels: false,
    kvPoly: false,
    kvLabels: false,
    outline: false,
  }),

  run({ data, options: o, outDir, onProgress, lang = 'ru' }) {
    const T = TEXT[lang] || TEXT.ru;
    const delim = DELIMS[o.delimiter] || ';';
    const groups = data.groups(o.split);
    if (groups.length === 0) return { files: [], vydels: 0 };

    const files = [];
    let totalVydels = 0;
    let done = 0;

    for (const g of groups) {
      const { vydels } = data.rows(g, { kvartaly: false });
      done += 1;
      if (vydels.length === 0) continue;

      // The raw attributes differ between regions, so the columns are the
      // union over what this selection actually holds — a fixed list would
      // drop fields in one region and write empty ones in another.
      const extra = [];
      if (o.attrs === 'both') {
        const seen = new Set();
        for (const f of vydels) {
          for (const [k, v] of Object.entries(f.properties || {})) {
            if (SKIP_FIELDS.has(k) || k.startsWith('_') || v === null || v === '') continue;
            if (!seen.has(k)) { seen.add(k); extra.push(k); }
          }
        }
      }

      const header = [
        ...COLUMNS,
        ...(o.coords ? ['lon', 'lat'] : []),
        ...extra,
      ];

      const dir = path.join(outDir, safe(g.oblast, T.selection), safe(g.uchrezhdenie, T.noName));
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${safe(g.lesnichestvo, T.selectionFile)}.csv`);
      const name = [g.uchrezhdenie, g.lesnichestvo].filter(Boolean).join(' / ') || T.selection;

      const fd = fs.openSync(file, 'w');
      try {
        if (o.bom) fs.writeSync(fd, '\ufeff');
        fs.writeSync(fd, `${header.map((h) => field(h, delim)).join(delim)}\r\n`);

        for (const f of vydels) {
          const c = f.canon || {};
          const row = [
            c.oblast, c.uchrezhdenie ?? g.uchrezhdenie ?? null, c.lesnichestvo, f.kvartal, f.vydel,
            c.ploshad, c.poroda, c.bonitet, c.tip_lesa, c.kat_zem,
          ];
          if (o.coords) {
            const lp = f.geometry ? labelPoint(f.geometry) : null;
            row.push(lp ? lp.x.toFixed(6) : '', lp ? lp.y.toFixed(6) : '');
          }
          for (const k of extra) row.push(f.properties?.[k] ?? null);
          fs.writeSync(fd, `${row.map((v) => field(v, delim)).join(delim)}\r\n`);
        }
      } finally {
        fs.closeSync(fd);
      }

      files.push({ name, href: path.relative(outDir, file), file, vydels: vydels.length, kvartaly: 0 });
      totalVydels += vydels.length;
      onProgress?.({ done, total: groups.length, name });
    }

    return { files, vydels: totalVydels, indexFile: null, skippedGeom: 0 };
  },
};
