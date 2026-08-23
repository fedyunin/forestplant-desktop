/**
 * Экспорт в KML для Google Earth.
 *
 * Два ограничения формата определяют всё устройство и объяснены в core/kml.js:
 * подписи у полигонов не показываются без точки-якоря, а предел Google Earth
 * считается по вершинам, а не по объектам.
 */

import fs from 'node:fs';
import path from 'node:path';

import { buildKmlSet, buildIndexKml, DEFAULT_STYLE, VERTEX_BUDGET } from '../core/kml.js';

const safe = (s) => String(s || '').replace(/[^\p{L}\p{N}\-. ()]+/gu, '_').trim() || 'без имени';

export default {
  id: 'kml',
  name: 'KML для Google Earth',
  hint: 'Полигоны с подписями, границами кварталов и лесничества. '
    + 'Крупные выборки делятся на части по пределу Google Earth.',

  options: [
    { key: 'split', type: 'select', label: 'Файлы', value: 'lesnichestvo',
      choices: [
        { value: 'lesnichestvo', label: 'на каждое лесничество' },
        { value: 'none', label: 'один общий' },
      ] },
    { key: 'labelFormat', type: 'select', label: 'Подписи выделов', value: 'vydel',
      choices: [
        { value: 'vydel', label: 'номер выдела — 5' },
        { value: 'kv-vd', label: 'квартал-выдел — 29-5' },
        { value: 'full', label: 'кв 29 выд 5' },
      ] },
    { key: 'labels', type: 'bool', label: 'подписи', value: true },
    { key: 'kvartaly', type: 'bool', label: 'кварталы', value: true },
    { key: 'outline', type: 'bool', label: 'границы лесничества', value: true },
    { key: 'index', type: 'bool', label: 'сводный файл со ссылками', value: true },
    { key: 'budget', type: 'number', label: 'Предел вершин на файл',
      value: VERTEX_BUDGET, min: 10000, max: 250000, step: 10000,
      hint: 'Google Earth не принимает больше 250 000 вершин. Считаются точки '
        + 'координат, и каждая подпись — тоже точка.' },
    { key: 'lesColor', type: 'color', label: 'Границы лесничества', value: DEFAULT_STYLE.lesColor },
    { key: 'lesWidth', type: 'number', label: 'толщина', value: DEFAULT_STYLE.lesWidth, min: 0.5, max: 8, step: 0.1 },
    { key: 'kvColor', type: 'color', label: 'Кварталы', value: DEFAULT_STYLE.kvColor },
    { key: 'kvWidth', type: 'number', label: 'толщина', value: DEFAULT_STYLE.kvWidth, min: 0.5, max: 8, step: 0.1 },
    { key: 'vdColor', type: 'color', label: 'Выделы', value: DEFAULT_STYLE.vdColor },
    { key: 'vdWidth', type: 'number', label: 'толщина', value: DEFAULT_STYLE.vdWidth, min: 0.5, max: 8, step: 0.1 },
    { key: 'vdFill', type: 'number', label: 'заливка выделов', value: DEFAULT_STYLE.vdFill, min: 0, max: 1, step: 0.01 },
  ],

  /**
   * @param {object} p
   * @param {object} p.data    выборка: groups() и rows(group)
   * @param {object} p.options настройки из списка выше
   * @param {string} p.outDir  куда писать
   */
  run({ data, options: o, outDir, onProgress }) {
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
      const { vydels, kvartaly } = data.rows(g, { kvartaly: o.kvartaly });
      done += 1;
      if (vydels.length === 0) continue;

      const name = [g.uchrezhdenie, g.lesnichestvo].filter(Boolean).join(' / ') || 'Выборка';
      const dir = path.join(outDir, safe(g.oblast || 'Выборка'), safe(g.uchrezhdenie || ''));
      fs.mkdirSync(dir, { recursive: true });

      for (const part of buildKmlSet({
        name, vydels, kvartaly,
        labelFormat: o.labelFormat, labels: o.labels, style,
        outline: o.outline, budget: o.budget, stats,
      })) {
        const file = path.join(dir, `${safe(g.lesnichestvo || 'выборка')}${part.suffix.replace(/ /g, '_')}.kml`);
        fs.writeFileSync(file, part.content, 'utf8');
        links.push({ name: part.name, href: path.relative(outDir, file), file, ...part.counts });
      }

      totalVydels += vydels.length;
      onProgress?.({ done, total: groups.length, name });
    }

    let indexFile = null;
    if (o.index && links.length > 1) {
      indexFile = path.join(outDir, '_ВСЁ.kml');
      fs.writeFileSync(indexFile, buildIndexKml('Лесной фонд — сводный', links), 'utf8');
    }

    return { files: links, vydels: totalVydels, indexFile, skippedGeom: stats.skippedGeom };
  },
};
