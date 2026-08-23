/**
 * Сборка KML: стили, подписи, разбивка по бюджету вершин, сводный файл.
 *
 * Два ограничения формата, определяющие всё устройство:
 *
 * 1. KML не показывает подписи у полигонов — это ограничение формата, а не
 *    рендерера. Подпись ставится отдельной точкой-якорем внутри контура с
 *    невидимой иконкой.
 * 2. Google Earth не принимает больше 250 000 ВЕРШИН на файл (не объектов!),
 *    и каждая подпись — это ещё одна вершина.
 */

import { countVertices, labelPoint, outlineOf } from './geometry.js';
import { SKIP_FIELDS } from './fields.js';

export const DEFAULT_STYLE = {
  lesColor: '#FFD400', lesWidth: 4.5,
  kvColor: '#00A03C', kvWidth: 2.6,
  vdColor: '#9400D3', vdWidth: 1.2,
  vdFill: 0.12,
};

/** Толщина растёт по иерархии, иначе на общем плане уровни сливаются. */
export const VERTEX_BUDGET = 240000; // с запасом к гугловым 250 000

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** #RRGGBB -> aabbggrr, как принято в KML. */
export function kmlColor(color, alpha = 1) {
  const c = String(color).trim().replace(/^#/, '');
  if (c.length === 8) return c.toLowerCase();
  const [r, g, b] = [c.slice(0, 2), c.slice(2, 4), c.slice(4, 6)];
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16).padStart(2, '0');
  return `${a}${b}${g}${r}`.toLowerCase();
}

function styles(st) {
  return `
<Style id="lesnichestvo">
  <LineStyle><color>${kmlColor(st.lesColor)}</color><width>${st.lesWidth}</width></LineStyle>
  <PolyStyle><fill>0</fill></PolyStyle>
</Style>
<Style id="kvartal">
  <LineStyle><color>${kmlColor(st.kvColor)}</color><width>${st.kvWidth}</width></LineStyle>
  <PolyStyle><fill>0</fill></PolyStyle>
</Style>
<Style id="vydel">
  <LineStyle><color>${kmlColor(st.vdColor)}</color><width>${st.vdWidth}</width></LineStyle>
  <PolyStyle><color>${kmlColor(st.vdColor, st.vdFill)}</color></PolyStyle>
  <BalloonStyle><text><![CDATA[<h3>$[name]</h3>$[description]]]></text></BalloonStyle>
</Style>
<Style id="lbl_vydel">
  <IconStyle><scale>0</scale><Icon><href></href></Icon></IconStyle>
  <LabelStyle><color>${kmlColor(st.vdColor)}</color><scale>0.75</scale></LabelStyle>
</Style>
<Style id="lbl_kvartal">
  <IconStyle><scale>0</scale><Icon><href></href></Icon></IconStyle>
  <LabelStyle><color>${kmlColor(st.kvColor)}</color><scale>0.95</scale></LabelStyle>
</Style>`;
}

const coords = (ring) => ring.map(([x, y]) => `${x.toFixed(8)},${y.toFixed(8)},0`).join(' ');

/** Кольцо годится, если это замкнутый контур хотя бы из трёх точек. */
const usableRing = (r) => Array.isArray(r) && r.length >= 4
  && r.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));

function polygonKml(rings) {
  // В данных встречаются части мультиполигона без колец — два объекта на
  // Алматинскую область. Без проверки сборка всего файла падала целиком.
  const good = (rings || []).filter(usableRing);
  if (good.length === 0) return '';
  const parts = [
    `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords(good[0])}</coordinates></LinearRing></outerBoundaryIs>`,
  ];
  for (let i = 1; i < good.length; i++) {
    parts.push(`<innerBoundaryIs><LinearRing><coordinates>${coords(good[i])}</coordinates></LinearRing></innerBoundaryIs>`);
  }
  parts.push('</Polygon>');
  return parts.join('');
}

export function geomKml(geom) {
  if (!geom) return '';
  const { type, coordinates: c } = geom;
  if (!c) return '';

  if (type === 'Polygon') return polygonKml(c);
  if (type === 'MultiPolygon') {
    const body = c.map(polygonKml).filter(Boolean).join('');
    return body ? `<MultiGeometry>${body}</MultiGeometry>` : '';
  }
  if (type === 'Point') {
    return Number.isFinite(c[0]) && Number.isFinite(c[1])
      ? `<Point><coordinates>${c[0].toFixed(8)},${c[1].toFixed(8)},0</coordinates></Point>` : '';
  }
  if (type === 'LineString') {
    return usableRing([...c, c[0]]) || (Array.isArray(c) && c.length >= 2)
      ? `<LineString><coordinates>${coords(c.filter((p) => Number.isFinite(p?.[0])))}</coordinates></LineString>` : '';
  }
  if (type === 'MultiLineString') {
    const body = c.map((l) => geomKml({ type: 'LineString', coordinates: l })).filter(Boolean).join('');
    return body ? `<MultiGeometry>${body}</MultiGeometry>` : '';
  }
  return '';
}

function attrTable(props) {
  const rows = Object.entries(props)
    .filter(([k, v]) => !SKIP_FIELDS.has(k) && !k.startsWith('_') && v !== null && v !== '')
    .map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`)
    .join('');
  return `<![CDATA[<table>${rows}</table>]]>`;
}

function extData(props) {
  return Object.entries(props)
    .filter(([k, v]) => !SKIP_FIELDS.has(k) && !k.startsWith('_') && v !== null && v !== '')
    .map(([k, v]) => `<Data name="${esc(k)}"><value>${esc(v)}</value></Data>`)
    .join('');
}

function folder(name, body) {
  return `<Folder><name>${esc(name)}</name><open>0</open><visibility>1</visibility>\n${body.join('\n')}\n</Folder>`;
}

/** Текст подписи выдела. */
function vydelLabel(kv, vd, format) {
  if (kv === null && vd === null) return '';
  if (format === 'full') return `кв ${kv} выд ${vd}`;
  if (format === 'kv-vd') return `${kv}-${vd}`;
  return String(vd);
}

/**
 * Один документ KML.
 * Объекты — {properties, geometry, kvartal, vydel}; номера берутся из
 * канонических полей, а не из props: имена полей разнятся по областям, и при
 * слиянии нескольких областей в один файл роли одного слоя дали бы неверные
 * подписи всем остальным.
 */
export function buildKml({
  name, vydels = [], kvartaly = [], outline = null,
  labelFormat = 'vydel', labels = true, style = {}, stats = null,
}) {
  const st = { ...DEFAULT_STYLE, ...style };
  const polyL = [], polyK = [], lblK = [], polyV = [], lblV = [];

  if (outline) {
    polyL.push(`<Placemark><name>${esc(name)}</name><styleUrl>#lesnichestvo</styleUrl>${geomKml(outline)}</Placemark>`);
  }

  for (const f of kvartaly) {
    const label = `КВ-${f.kvartal}`;
    polyK.push(`<Placemark><name>${esc(label)}</name><styleUrl>#kvartal</styleUrl><ExtendedData>${extData(f.properties)}</ExtendedData>${geomKml(f.geometry)}</Placemark>`);
    if (labels) {
      const lp = labelPoint(f.geometry);
      if (lp) {
        lblK.push(`<Placemark><name>${esc(label)}</name><styleUrl>#lbl_kvartal</styleUrl><Point><coordinates>${lp.x.toFixed(8)},${lp.y.toFixed(8)},0</coordinates></Point></Placemark>`);
      }
    }
  }

  let skippedGeom = 0;
  for (const f of vydels) {
    const full = `кв ${f.kvartal} выд ${f.vydel}`;
    const g = geomKml(f.geometry);
    if (!g) { skippedGeom += 1; continue; }   // битая геометрия в исходных данных
    polyV.push(`<Placemark><name>${esc(full)}</name><styleUrl>#vydel</styleUrl><description>${attrTable(f.properties)}</description><ExtendedData>${extData(f.properties)}</ExtendedData>${g}</Placemark>`);
    if (labels) {
      const lp = labelPoint(f.geometry);
      if (lp) {
        lblV.push(`<Placemark><name>${esc(vydelLabel(f.kvartal, f.vydel, labelFormat))}</name><styleUrl>#lbl_vydel</styleUrl><description>${attrTable(f.properties)}</description><Point><coordinates>${lp.x.toFixed(8)},${lp.y.toFixed(8)},0</coordinates></Point></Placemark>`);
      }
    }
  }

  if (stats) stats.skippedGeom = (stats.skippedGeom || 0) + skippedGeom;

  const body = [];
  if (polyL.length) body.push(folder('Границы лесничества', polyL));
  if (polyK.length) body.push(folder('Кварталы', polyK));
  if (lblK.length) body.push(folder('Подписи кварталов', lblK));
  if (polyV.length) body.push(folder('Выделы', polyV));
  if (lblV.length) body.push(folder('Подписи выделов', lblV));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
    `<name>${esc(name)}</name>`,
    '<open>1</open>',
    styles(st),
    body.join('\n'),
    '</Document></kml>',
  ].join('\n');
}

/**
 * Разбить выделы на части так, чтобы каждая уложилась в бюджет вершин.
 * Кварталы и контур идут только в первую часть — иначе их вес дублируется.
 */
export function planChunks({ vydels, kvartaly = [], outline = null, labels = true, budget = VERTEX_BUDGET }) {
  const lbl = labels ? 1 : 0;
  const fixed = countVertices(outline)
    + kvartaly.reduce((s, f) => s + countVertices(f.geometry) + lbl, 0);

  // Кварталы с контуром бывают тяжелее, чем половина бюджета: у Илийского
  // лесничества они вытесняли выделы так, что первая часть выходила за лимит
  // (260 274 вершины при пороге 250 000). Если места под выделы почти не
  // остаётся, кварталы уезжают в собственный файл.
  const room = budget - fixed;
  const separateKvartaly = fixed > 0 && room < budget * 0.25;

  const chunks = [];
  let cur = [], curN = 0;
  let cap = separateKvartaly ? budget : room;

  for (const f of vydels) {
    const v = countVertices(f.geometry) + lbl;
    if (cur.length && curN + v > cap) {
      chunks.push(cur);
      cur = []; curN = 0; cap = budget;
    }
    cur.push(f);
    curN += v;
  }
  if (cur.length) chunks.push(cur);
  if (chunks.length === 0) chunks.push([]);
  return { chunks, separateKvartaly, fixed };
}

/** Сводный файл со ссылками — Google Earth подгружает части сам. */
export function buildIndexKml(name, links) {
  const body = links
    .map(({ name: n, href }) => `<NetworkLink><name>${esc(n)}</name><visibility>1</visibility><open>0</open><Link><href>${esc(href)}</href></Link></NetworkLink>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<name>${esc(name)}</name><open>1</open>
${body}
</Document></kml>`;
}

/** Полный набор файлов для одной группы (лесничества). */
export function buildKmlSet({
  name, vydels, kvartaly = [], labelFormat = 'vydel', labels = true,
  style = {}, outline = true, budget = VERTEX_BUDGET, stats = null,
}) {
  const og = outline === true ? outlineOf(vydels, kvartaly) : (outline || null);
  const { chunks, separateKvartaly } = planChunks({ vydels, kvartaly, outline: og, labels, budget });

  // Кварталы либо едут в первой части вместе с выделами, либо отдельным файлом
  const parts = separateKvartaly
    ? [{ vydels: [], kvartaly, outline: og }, ...chunks.map((c) => ({ vydels: c, kvartaly: [], outline: null }))]
    : chunks.map((c, i) => ({
      vydels: c,
      kvartaly: i === 0 ? kvartaly : [],
      outline: i === 0 ? og : null,
    }));

  const total = parts.length;
  return parts.map((p, i) => {
    const suffix = total === 1 ? '' : ` (часть ${i + 1} из ${total})`;
    return {
      suffix,
      name: name + suffix,
      content: buildKml({
        name: name + suffix,
        vydels: p.vydels,
        kvartaly: p.kvartaly,
        outline: p.outline,
        labelFormat, labels, style, stats,
      }),
      counts: { vydels: p.vydels.length, kvartaly: p.kvartaly.length },
    };
  });
}
