/**
 * Building KML: styles, labels, splitting by a vertex budget, index file.
 *
 * Two limits of the format shape everything here:
 *
 * 1. KML shows no labels on polygons — a limit of the format, not of the
 *    renderer. A label is placed as a separate anchor point inside the
 *    outline, with an invisible icon.
 * 2. Google Earth refuses more than 250 000 VERTICES per file (not objects!),
 *    and every label is one more vertex.
 */

import { countVertices, labelPoint, outlineOf } from './geometry.js';
import { SKIP_FIELDS } from './fields.js';

/** Line width grows with the hierarchy, otherwise the levels merge visually. */
export const DEFAULT_STYLE = {
  lesColor: '#FFD400', lesWidth: 4.5,
  kvColor: '#00A03C', kvWidth: 2.6,
  vdColor: '#9400D3', vdWidth: 1.2,
  vdFill: 0.12,
};

/** Kept below the Google Earth limit of 250 000 with room to spare. */
export const VERTEX_BUDGET = 240000;

/**
 * Text that ends up inside the exported file.
 *
 * The data itself is Russian, so Russian stays the default; the app passes
 * its own language through when the reader wants English.
 */
const TEXT = {
  ru: {
    outline: 'Границы лесничества',
    kvartaly: 'Кварталы',
    kvLabels: 'Подписи кварталов',
    vydely: 'Выделы',
    vdLabels: 'Подписи выделов',
    full: (kv, vd) => `кв ${kv} выд ${vd}`,
    kvPrefix: 'КВ',
    part: (i, n) => ` (часть ${i} из ${n})`,
  },
  en: {
    outline: 'Forestry boundary',
    kvartaly: 'Blocks',
    kvLabels: 'Block labels',
    vydely: 'Stands',
    vdLabels: 'Stand labels',
    full: (kv, vd) => `block ${kv} stand ${vd}`,
    kvPrefix: 'BL',
    part: (i, n) => ` (part ${i} of ${n})`,
  },
  kk: {
    outline: 'Орманшылық шекарасы',
    kvartaly: 'Кварталдар',
    kvLabels: 'Квартал жазулары',
    vydely: 'Бөліктер',
    vdLabels: 'Бөлік жазулары',
    full: (kv, vd) => `${kv}-квартал ${vd}-бөлік`,
    kvPrefix: 'КВ',
    part: (i, n) => ` (${n} бөліктің ${i}-сі)`,
  },
};

const text = (lang) => TEXT[lang] || TEXT.ru;

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** #RRGGBB -> aabbggrr, the byte order KML expects. */
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

/** A ring is usable when it is a closed outline of at least three points. */
const usableRing = (r) => Array.isArray(r) && r.length >= 4
  && r.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));

function polygonKml(rings) {
  // The data contains multipolygon parts with no rings at all — two objects in
  // the Almaty region. Without this check, building the whole file failed.
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

/**
 * Placeholders a label template may use.
 *
 * The values come from the canonical columns, never from the raw attributes:
 * field names differ between regions, so a template written against one
 * region's spelling would silently produce empty labels in another.
 */
export const LABEL_FIELDS = ['kv', 'vd', 'ploshad', 'poroda', 'bonitet', 'tip', 'katzem', 'les', 'obl'];

const valueOf = (f, key) => {
  const c = f.canon || {};
  switch (key) {
    case 'kv': return f.kvartal;
    case 'vd': return f.vydel;
    case 'ploshad': return c.ploshad;
    case 'poroda': return c.poroda;
    case 'bonitet': return c.bonitet;
    case 'tip': return c.tip_lesa;
    case 'katzem': return c.kat_zem;
    case 'les': return c.lesnichestvo;
    case 'obl': return c.oblast;
    default: return undefined;
  }
};

/**
 * Render a label from a template such as `{kv}-{vd}` or `выд {vd} {poroda}`.
 *
 * An unknown or empty placeholder becomes an empty string rather than the
 * literal `{x}`: a label reading «кв 29 выд {poroda}» on a stand with no
 * species would look like a bug in the file, not like missing data.
 */
export function renderLabel(template, f) {
  return String(template).replace(/\{(\w+)\}/g, (m, key) => {
    const v = valueOf(f, key);
    return v === null || v === undefined ? '' : String(v);
  }).replace(/\s+/g, ' ').trim();
}

/** Label text of a stand: a preset, or the user's own template. */
function vydelLabel(f, format, template, T) {
  if (format === 'custom') {
    // A template over a stand with no numbers renders as «-» and other such
    // punctuation; nothing readable came out, so nothing is written.
    const s = renderLabel(template || '{vd}', f);
    return /[\p{L}\p{N}]/u.test(s) ? s : '';
  }
  if (f.kvartal === null && f.vydel === null) return '';
  if (format === 'full') return T.full(f.kvartal, f.vydel);
  if (format === 'kv-vd') return `${f.kvartal}-${f.vydel}`;
  return String(f.vydel);
}

/**
 * A single KML document.
 *
 * Objects are {properties, geometry, kvartal, vydel, canon}; the numbers and
 * the label values come from the canonical fields rather than from props:
 * field names differ between regions, and when several regions merge into one
 * file the roles of one layer would mislabel everything else.
 *
 * Each of the five layers can be left out. A whole region with labels on is
 * tens of megabytes and minutes of loading in Google Earth; with the stand
 * labels and blocks dropped the same selection opens at once, which is what
 * an overview map needs.
 */
export function buildKml({
  name, vydels = [], kvartaly = [], outline = null,
  labelFormat = 'vydel', labelTemplate = '', kvLabelTemplate = '',
  vdPoly = true, vdLabels = true, kvPoly = true, kvLabels = true,
  style = {}, stats = null, lang = 'ru',
}) {
  const T = text(lang);
  const st = { ...DEFAULT_STYLE, ...style };
  const polyL = [], polyK = [], lblK = [], polyV = [], lblV = [];

  if (outline) {
    polyL.push(`<Placemark><name>${esc(name)}</name><styleUrl>#lesnichestvo</styleUrl>${geomKml(outline)}</Placemark>`);
  }

  for (const f of kvartaly) {
    const label = kvLabelTemplate
      ? renderLabel(kvLabelTemplate, f)
      : `${T.kvPrefix}-${f.kvartal}`;
    if (kvPoly) {
      polyK.push(`<Placemark><name>${esc(label)}</name><styleUrl>#kvartal</styleUrl><ExtendedData>${extData(f.properties)}</ExtendedData>${geomKml(f.geometry)}</Placemark>`);
    }
    if (kvLabels) {
      const lp = labelPoint(f.geometry);
      if (lp) {
        lblK.push(`<Placemark><name>${esc(label)}</name><styleUrl>#lbl_kvartal</styleUrl><Point><coordinates>${lp.x.toFixed(8)},${lp.y.toFixed(8)},0</coordinates></Point></Placemark>`);
      }
    }
  }

  let skippedGeom = 0;
  for (const f of vydels) {
    const full = T.full(f.kvartal, f.vydel);
    const g = vdPoly ? geomKml(f.geometry) : '';
    if (vdPoly && !g) { skippedGeom += 1; continue; }   // broken geometry in the source data
    if (vdPoly) {
      polyV.push(`<Placemark><name>${esc(full)}</name><styleUrl>#vydel</styleUrl><description>${attrTable(f.properties)}</description><ExtendedData>${extData(f.properties)}</ExtendedData>${g}</Placemark>`);
    }
    if (vdLabels) {
      const lp = labelPoint(f.geometry);
      if (lp) {
        lblV.push(`<Placemark><name>${esc(vydelLabel(f, labelFormat, labelTemplate, T))}</name><styleUrl>#lbl_vydel</styleUrl><description>${attrTable(f.properties)}</description><Point><coordinates>${lp.x.toFixed(8)},${lp.y.toFixed(8)},0</coordinates></Point></Placemark>`);
      } else if (!vdPoly) {
        // nothing at all came of this stand: in a labels-only file a broken
        // geometry is just as lost, and has to be reported as skipped
        skippedGeom += 1;
      }
    }
  }

  if (stats) stats.skippedGeom = (stats.skippedGeom || 0) + skippedGeom;

  const body = [];
  if (polyL.length) body.push(folder(T.outline, polyL));
  if (polyK.length) body.push(folder(T.kvartaly, polyK));
  if (lblK.length) body.push(folder(T.kvLabels, lblK));
  if (polyV.length) body.push(folder(T.vydely, polyV));
  if (lblV.length) body.push(folder(T.vdLabels, lblV));

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
 * Split the stands into parts so that each one fits the vertex budget.
 * Blocks and the outline go into the first part only — otherwise their
 * weight is counted again in every part.
 */
export function planChunks({
  vydels, kvartaly = [], outline = null, budget = VERTEX_BUDGET,
  vdPoly = true, vdLabels = true, kvPoly = true, kvLabels = true,
}) {
  // What is switched off weighs nothing — that is the point of switching it
  // off, and an estimate that ignored this would split files that fit.
  const vdCost = (f) => (vdPoly ? countVertices(f.geometry) : 0) + (vdLabels ? 1 : 0);
  const fixed = countVertices(outline)
    + kvartaly.reduce((s, f) => s + (kvPoly ? countVertices(f.geometry) : 0) + (kvLabels ? 1 : 0), 0);

  // Blocks plus the outline can weigh more than half the budget: at Iliyskoe
  // forestry they crowded out the stands so badly that the first part went
  // over the limit (260 274 vertices against a 250 000 threshold). When
  // almost no room is left for stands, the blocks move into their own file.
  const room = budget - fixed;
  const separateKvartaly = fixed > 0 && room < budget * 0.25;

  const chunks = [];
  let cur = [], curN = 0;
  let cap = separateKvartaly ? budget : room;

  for (const f of vydels) {
    const v = vdCost(f);
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

/** Index file with links — Google Earth loads the parts on its own. */
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

/** The complete set of files for one group (one forestry). */
export function buildKmlSet({
  name, vydels, kvartaly = [], labelFormat = 'vydel',
  labelTemplate = '', kvLabelTemplate = '',
  vdPoly = true, vdLabels = true, kvPoly = true, kvLabels = true,
  style = {}, outline = true, budget = VERTEX_BUDGET, stats = null, lang = 'ru',
}) {
  const og = outline === true ? outlineOf(vydels, kvartaly) : (outline || null);
  const layers = { vdPoly, vdLabels, kvPoly, kvLabels };

  // Objects whose every layer is off draw nothing, so they must not claim a
  // part: with both stand layers off the stands used to take a file of their
  // own that held only the KML header. The outline is still computed from the
  // real stands — it is a layer of its own.
  const stands = vdPoly || vdLabels ? vydels : [];
  const blocks = kvPoly || kvLabels ? kvartaly : [];

  const { chunks, separateKvartaly } = planChunks({
    vydels: stands, kvartaly: blocks, outline: og, budget, ...layers,
  });

  // Blocks either travel in the first part together with the stands, or alone
  const parts = separateKvartaly
    ? [{ vydels: [], kvartaly: blocks, outline: og }, ...chunks.map((c) => ({ vydels: c, kvartaly: [], outline: null }))]
    : chunks.map((c, i) => ({
      vydels: c,
      kvartaly: i === 0 ? blocks : [],
      outline: i === 0 ? og : null,
    }));

  // A part with nothing in it is still a file Google Earth has to open. With
  // both stand layers off the stand chunk is empty, and without this the set
  // came out as «part 1 of 2» plus a 1 KB file holding no placemarks at all.
  const kept = parts.filter((p) => p.vydels.length || p.kvartaly.length || p.outline);

  const total = kept.length;
  return kept.map((p, i) => {
    const suffix = total === 1 ? '' : text(lang).part(i + 1, total);
    return {
      suffix,
      name: name + suffix,
      content: buildKml({
        name: name + suffix,
        vydels: p.vydels,
        kvartaly: p.kvartaly,
        outline: p.outline,
        labelFormat, labelTemplate, kvLabelTemplate, ...layers, style, stats, lang,
      }),
      counts: { vydels: p.vydels.length, kvartaly: p.kvartaly.length },
    };
  });
}
