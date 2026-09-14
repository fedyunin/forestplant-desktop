/**
 * Export to GeoJSON.
 *
 * The plainest way out of here: the geometry is already GeoJSON in WGS84, so
 * this writes what the database holds, with the attributes chosen by the user.
 * QGIS, ArcGIS and every web map read it without a plugin.
 *
 * The file is written feature by feature rather than built as one string:
 * a region is hundreds of thousands of objects, and a single JSON.stringify
 * of that would be a gigabyte-long string in memory before the first byte
 * reaches the disk.
 */

import fs from 'node:fs';
import path from 'node:path';

import { SKIP_FIELDS } from '../core/fields.js';

const TEXT = {
  ru: { selection: 'Выборка', selectionFile: 'выборка', noName: 'без имени', blocks: 'кварталы' },
  en: { selection: 'Selection', selectionFile: 'selection', noName: 'unnamed', blocks: 'blocks' },
  kk: { selection: 'Іріктеу', selectionFile: 'іріктеу', noName: 'атауы жоқ', blocks: 'кварталдар' },
};

const safe = (s, fallback) => String(s || '').replace(/[^\p{L}\p{N}\-. ()]+/gu, '_').trim() || fallback;

/** Attributes of one object, in the shape the user asked for. */
function propsOf(f, mode) {
  const canon = {
    oblast: f.canon?.oblast ?? null,
    uchrezhdenie: f.canon?.uchrezhdenie ?? null,
    lesnichestvo: f.canon?.lesnichestvo ?? null,
    kvartal: f.kvartal,
    vydel: f.vydel,
    ploshad: f.canon?.ploshad ?? null,
    poroda: f.canon?.poroda ?? null,
    bonitet: f.canon?.bonitet ?? null,
    tip_lesa: f.canon?.tip_lesa ?? null,
    kat_zem: f.canon?.kat_zem ?? null,
  };
  if (mode === 'canonical') return canon;

  const raw = {};
  for (const [k, v] of Object.entries(f.properties || {})) {
    if (SKIP_FIELDS.has(k) || k.startsWith('_') || v === null || v === '') continue;
    raw[k] = v;
  }
  return mode === 'raw' ? raw : { ...canon, ...raw };
}

export default {
  id: 'geojson',
  name: 'fmt.geojson.name',
  hint: 'fmt.geojson.hint',
  estimate: 'export.estimateSimple',

  options: [
    { key: 'split', type: 'select', label: 'opt.split', value: 'lesnichestvo',
      choices: [
        { value: 'lesnichestvo', label: 'opt.split.les' },
        { value: 'none', label: 'opt.split.none' },
      ] },
    { key: 'attrs', type: 'select', label: 'opt.attrs', value: 'both',
      choices: [
        { value: 'both', label: 'opt.attrs.both' },
        { value: 'canonical', label: 'opt.attrs.canonical' },
        { value: 'raw', label: 'opt.attrs.raw' },
      ] },
    { key: 'kvartaly', type: 'bool', label: 'opt.kvartalyFile', value: false },
    { key: 'pretty', type: 'bool', label: 'opt.pretty', value: false },
  ],

  /** What the estimate should count: polygons, no labels, no splitting. */
  plan: (o) => ({
    split: o.split,
    budget: null,
    // the blocks travel in a file of their own, so a group can be two files
    perGroupFiles: o.kvartaly ? 2 : 1,
    vdPoly: true,
    vdLabels: false,
    kvPoly: o.kvartaly,
    kvLabels: false,
    outline: false,
  }),

  run({ data, options: o, outDir, onProgress, lang = 'ru' }) {
    const T = TEXT[lang] || TEXT.ru;
    const groups = data.groups(o.split);
    if (groups.length === 0) return { files: [], vydels: 0 };

    const files = [];
    let totalVydels = 0;
    let skippedGeom = 0;
    let done = 0;

    const write = (file, rows) => {
      const fd = fs.openSync(file, 'w');
      const nl = o.pretty ? '\n' : '';
      let n = 0;
      try {
        fs.writeSync(fd, `{"type":"FeatureCollection","features":[${nl}`);
        for (const f of rows) {
          if (!f.geometry) { skippedGeom += 1; continue; }
          const feature = { type: 'Feature', properties: propsOf(f, o.attrs), geometry: f.geometry };
          const text = o.pretty ? JSON.stringify(feature, null, 1) : JSON.stringify(feature);
          fs.writeSync(fd, (n ? `,${nl}` : '') + text);
          n += 1;
        }
        fs.writeSync(fd, `${nl}]}`);
      } finally {
        fs.closeSync(fd);
      }
      return n;
    };

    for (const g of groups) {
      const { vydels, kvartaly } = data.rows(g, { kvartaly: o.kvartaly });
      done += 1;
      if (vydels.length === 0) continue;

      const dir = path.join(outDir, safe(g.oblast, T.selection), safe(g.uchrezhdenie, T.noName));
      fs.mkdirSync(dir, { recursive: true });
      const base = safe(g.lesnichestvo, T.selectionFile);
      const name = [g.uchrezhdenie, g.lesnichestvo].filter(Boolean).join(' / ') || T.selection;

      // A collection with no features is a file that opens to nothing; when
      // every object of a group had broken geometry, write none at all.
      const file = path.join(dir, `${base}.geojson`);
      const written = write(file, vydels);
      if (written === 0) fs.rmSync(file, { force: true });
      else files.push({ name, href: path.relative(outDir, file), file, vydels: written, kvartaly: 0 });

      if (o.kvartaly && kvartaly.length) {
        const kvFile = path.join(dir, `${base}-${T.blocks}.geojson`);
        const kvN = write(kvFile, kvartaly);
        if (kvN === 0) fs.rmSync(kvFile, { force: true });
        else {
          files.push({
            name: `${name} · ${T.blocks}`,
            href: path.relative(outDir, kvFile),
            file: kvFile,
            vydels: 0,
            kvartaly: kvN,
          });
        }
      }

      totalVydels += written;
      onProgress?.({ done, total: groups.length, name });
    }

    return { files, vydels: totalVydels, indexFile: null, skippedGeom };
  },
};
