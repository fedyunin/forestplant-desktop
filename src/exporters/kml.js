/**
 * Export to KML for Google Earth.
 *
 * Two limits of the format shape everything here and are explained in
 * core/kml.js: polygons show no labels without an anchor point, and the
 * Google Earth limit counts vertices rather than objects.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  buildKmlSet, buildIndexKml, DEFAULT_STYLE, VERTEX_BUDGET, LABEL_FIELDS,
} from '../core/kml.js';

const TEXT = {
  ru: {
    selection: 'Выборка',
    selectionFile: 'выборка',
    noName: 'без имени',
    indexFile: '_ВСЁ.kml',
    indexName: 'Лесной фонд — сводный',
  },
  en: {
    selection: 'Selection',
    selectionFile: 'selection',
    noName: 'unnamed',
    indexFile: '_ALL.kml',
    indexName: 'Forest fund — index',
  },
  kk: {
    selection: 'Іріктеу',
    selectionFile: 'іріктеу',
    noName: 'атауы жоқ',
    indexFile: '_БАРЛЫҒЫ.kml',
    indexName: 'Орман қоры — жиынтық',
  },
};

const safe = (s, fallback) => String(s || '').replace(/[^\p{L}\p{N}\-. ()]+/gu, '_').trim() || fallback;

export default {
  id: 'kml',
  name: 'fmt.kml.name',
  hint: 'fmt.kml.hint',

  options: [
    { key: 'split', type: 'select', label: 'opt.split', value: 'lesnichestvo',
      choices: [
        { value: 'lesnichestvo', label: 'opt.split.les' },
        { value: 'none', label: 'opt.split.none' },
      ] },
    { key: 'labelFormat', type: 'select', label: 'opt.labelFormat', value: 'vydel',
      choices: [
        { value: 'vydel', label: 'opt.labelFormat.vydel' },
        { value: 'kv-vd', label: 'opt.labelFormat.kvvd' },
        { value: 'full', label: 'opt.labelFormat.full' },
        { value: 'custom', label: 'opt.labelFormat.custom' },
      ] },
    // Each layer is separate: a whole region with everything on takes minutes
    // to open in Google Earth, and an overview map needs none of it.
    { key: 'vdPoly', type: 'bool', label: 'opt.vdPoly', value: true },
    { key: 'vdLabels', type: 'bool', label: 'opt.vdLabels', value: true },
    { key: 'kvPoly', type: 'bool', label: 'opt.kvPoly', value: true },
    { key: 'kvLabels', type: 'bool', label: 'opt.kvLabels', value: true },
    { key: 'outline', type: 'bool', label: 'opt.outline', value: true },
    { key: 'index', type: 'bool', label: 'opt.index', value: true },
    { key: 'labelTemplate', type: 'text', label: 'opt.labelTemplate', value: '{kv}-{vd}',
      placeholder: 'opt.labelTemplate.ph', hint: 'opt.template.hint',
      fields: LABEL_FIELDS, max: 200 },
    { key: 'kvLabelTemplate', type: 'text', label: 'opt.kvLabelTemplate', value: '',
      placeholder: 'opt.kvLabelTemplate.ph', max: 200 },
    { key: 'budget', type: 'number', label: 'opt.budget',
      // Google Earth refuses more than 250 000 vertices; a label is a point too
      value: VERTEX_BUDGET, min: 10000, max: 250000, step: 10000 },
    { key: 'lesColor', type: 'color', label: 'opt.lesColor', value: DEFAULT_STYLE.lesColor },
    { key: 'lesWidth', type: 'number', label: 'opt.width', value: DEFAULT_STYLE.lesWidth, min: 0.5, max: 8, step: 0.1 },
    { key: 'kvColor', type: 'color', label: 'opt.kvColor', value: DEFAULT_STYLE.kvColor },
    { key: 'kvWidth', type: 'number', label: 'opt.width', value: DEFAULT_STYLE.kvWidth, min: 0.5, max: 8, step: 0.1 },
    { key: 'vdColor', type: 'color', label: 'opt.vdColor', value: DEFAULT_STYLE.vdColor },
    { key: 'vdWidth', type: 'number', label: 'opt.width', value: DEFAULT_STYLE.vdWidth, min: 0.5, max: 8, step: 0.1 },
    { key: 'vdFill', type: 'number', label: 'opt.vdFill', value: DEFAULT_STYLE.vdFill, min: 0, max: 1, step: 0.01 },
  ],

  /**
   * @param {object} p
   * @param {object} p.data    the selection: groups() and rows(group)
   * @param {object} p.options settings from the list above
   * @param {string} p.outDir  where to write
   * @param {string} p.lang    language of the text inside the files
   */
  run({ data, options: o, outDir, onProgress, lang = 'ru' }) {
    const T = TEXT[lang] || TEXT.ru;
    const style = {
      lesColor: o.lesColor, lesWidth: o.lesWidth,
      kvColor: o.kvColor, kvWidth: o.kvWidth,
      vdColor: o.vdColor, vdWidth: o.vdWidth, vdFill: o.vdFill,
    };

    const groups = data.groups(o.split);
    if (groups.length === 0) return { files: [], vydels: 0 };

    const links = [];
    const stats = { skippedGeom: 0 };
    let totalVydels = 0;
    let done = 0;

    for (const g of groups) {
      // the blocks are read only when at least one of their layers is wanted
      const wantKvartaly = o.kvPoly || o.kvLabels;
      const { vydels, kvartaly } = data.rows(g, { kvartaly: wantKvartaly });
      done += 1;
      if (vydels.length === 0) continue;

      const name = [g.uchrezhdenie, g.lesnichestvo].filter(Boolean).join(' / ') || T.selection;
      const dir = path.join(outDir, safe(g.oblast, T.selection), safe(g.uchrezhdenie, T.noName));
      fs.mkdirSync(dir, { recursive: true });

      for (const part of buildKmlSet({
        name, vydels, kvartaly,
        labelFormat: o.labelFormat,
        labelTemplate: o.labelTemplate,
        kvLabelTemplate: o.kvLabelTemplate,
        vdPoly: o.vdPoly, vdLabels: o.vdLabels,
        kvPoly: o.kvPoly, kvLabels: o.kvLabels,
        style, outline: o.outline, budget: o.budget, stats, lang,
      })) {
        const file = path.join(dir, `${safe(g.lesnichestvo, T.selectionFile)}${part.suffix.replace(/ /g, '_')}.kml`);
        fs.writeFileSync(file, part.content, 'utf8');
        links.push({ name: part.name, href: path.relative(outDir, file), file, ...part.counts });
      }

      totalVydels += vydels.length;
      onProgress?.({ done, total: groups.length, name });
    }

    let indexFile = null;
    if (o.index && links.length > 1) {
      indexFile = path.join(outDir, T.indexFile);
      fs.writeFileSync(indexFile, buildIndexKml(T.indexName, links), 'utf8');
    }

    return { files: links, vydels: totalVydels, indexFile, skippedGeom: stats.skippedGeom };
  },
};
