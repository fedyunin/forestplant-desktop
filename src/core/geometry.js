/**
 * Геометрия: bbox, счёт вершин, точка для подписи, склейка полигонов.
 *
 * Внешних зависимостей нет намеренно — всё это чистая математика на
 * координатах GeoJSON, и тянуть ради неё geos/turf смысла нет.
 */

/** Все кольца геометрии одним списком (внешние и дырки вперемешку). */
export function ringsOf(geom) {
  if (!geom) return [];
  const { type, coordinates: c } = geom;
  if (type === 'Polygon') return c.slice();
  if (type === 'MultiPolygon') return c.flat();
  return [];
}

/** Части полигона: [[внешнее, дырка, дырка], [внешнее], ...] */
export function partsOf(geom) {
  if (!geom) return [];
  const { type, coordinates: c } = geom;
  if (type === 'Polygon') return [c];
  if (type === 'MultiPolygon') return c;
  return [];
}

export function bbox(geom) {
  if (!geom) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const walk = (c) => {
    if (!c || c.length === 0) return;
    if (typeof c[0] === 'number') {
      if (c[0] < minx) minx = c[0];
      if (c[0] > maxx) maxx = c[0];
      if (c[1] < miny) miny = c[1];
      if (c[1] > maxy) maxy = c[1];
      return;
    }
    for (const p of c) walk(p);
  };
  walk(geom.coordinates);
  return Number.isFinite(minx) ? { minx, miny, maxx, maxy } : null;
}

/**
 * Число точек координат в геометрии.
 *
 * Google Earth ограничивает именно вершины, а не объекты:
 * «too many vertices (287,793) ... cannot exceed 250,000».
 * Каждая подпись — точка, то есть тоже одна вершина.
 */
export function countVertices(geom) {
  if (!geom) return 0;
  let n = 0;
  const walk = (c) => {
    if (!c || c.length === 0) return;
    if (typeof c[0] === 'number') { n += 1; return; }
    for (const p of c) walk(p);
  };
  walk(geom.coordinates);
  return n;
}

/** Площадь кольца со знаком (формула шнурков). */
export function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

/** Центроид кольца и его площадь. Для вырожденных колец — среднее вершин. */
export function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cr = x0 * y1 - x1 * y0;
    a += cr;
    cx += (x0 + x1) * cr;
    cy += (y0 + y1) * cr;
  }
  if (Math.abs(a) < 1e-15) {
    const sx = ring.reduce((s, p) => s + p[0], 0);
    const sy = ring.reduce((s, p) => s + p[1], 0);
    return { x: sx / ring.length, y: sy / ring.length, area: 0 };
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) };
}

export function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    if ((y0 > y) !== (y1 > y)) {
      if (x < x0 + ((y - y0) * (x1 - x0)) / (y1 - y0)) inside = !inside;
    }
  }
  return inside;
}

/** Точка внутри части полигона: внутри внешнего кольца и вне дырок. */
export function partContains(rings, x, y) {
  if (!ringContains(rings[0], x, y)) return false;
  for (let i = 1; i < rings.length; i++) {
    if (ringContains(rings[i], x, y)) return false;
  }
  return true;
}

export function geomContains(geom, x, y) {
  return partsOf(geom).some((rings) => rings.length && partContains(rings, x, y));
}

/** Середина самого широкого отрезка внутри полигона на высоте y. */
function scanlinePoint(rings, y) {
  const xs = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[i + 1];
      if ((y0 > y) !== (y1 > y)) {
        xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
  }
  xs.sort((a, b) => a - b);
  let best = null, bestWidth = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const w = xs[i + 1] - xs[i];
    if (w > bestWidth) { bestWidth = w; best = (xs[i] + xs[i + 1]) / 2; }
  }
  return best;
}

/**
 * Точка, куда вешать подпись — обязательно внутри контура.
 *
 * Не центроид: у вогнутых и кольцевых фигур он уходит наружу. Берём центроид
 * наибольшей части, а если он снаружи — середину самого широкого
 * горизонтального отрезка внутри контура на той же высоте.
 */
export function labelPoint(geom) {
  if (!geom) return null;
  if (geom.type === 'Point') return { x: geom.coordinates[0], y: geom.coordinates[1] };

  const parts = partsOf(geom).filter((rings) => rings.length && rings[0].length >= 4);
  if (parts.length === 0) return null;

  let best = null, bestArea = -1;
  for (const rings of parts) {
    const { area } = ringCentroid(rings[0]);
    if (area > bestArea) { bestArea = area; best = rings; }
  }

  const { x, y } = ringCentroid(best[0]);
  if (partContains(best, x, y)) return { x, y };
  const sx = scanlinePoint(best, y);
  return sx === null ? { x, y } : { x: sx, y };
}

/**
 * Внешняя граница объединения полигонов: рёбра, встретившиеся ровно один раз.
 *
 * Работает на топологически чистых данных, где соседние полигоны делят
 * вершины — у выделов и кварталов это так, они нарезаны из одного покрытия.
 *
 * Проверено на реальных данных: склейка выделов каждого квартала совпала с
 * настоящим полигоном квартала в 56 случаях из 59; остальные три оказались
 * кварталами из двух отдельных кусков, а не ошибкой склейки.
 *
 * minFrac отсекает микроскопические кольца-слипы, возникающие там, где соседи
 * не делят вершины точь-в-точь (у Каскеленского таких было 43 из 46).
 */
export function dissolve(geoms, { precision = 7, minFrac = 2e-4 } = {}) {
  const k = 10 ** precision;
  const round = (v) => Math.round(v * k) / k;
  const counts = new Map();

  for (const g of geoms) {
    for (const ring of ringsOf(g)) {
      for (let i = 0; i < ring.length - 1; i++) {
        const ax = round(ring[i][0]), ay = round(ring[i][1]);
        const bx = round(ring[i + 1][0]), by = round(ring[i + 1][1]);
        if (ax === bx && ay === by) continue;
        const a = `${ax},${ay}`, b = `${bx},${by}`;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }

  // только рёбра, принадлежащие одному полигону — внутренние отбрасываем
  const adj = new Map();
  for (const [key, n] of counts) {
    if (n !== 1) continue;
    const [a, b] = key.split('|');
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }

  const used = new Set();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const rings = [];

  for (const start of adj.keys()) {
    for (;;) {
      const free = (adj.get(start) || []).some((c) => !used.has(edgeKey(start, c)));
      if (!free) break;
      const path = [start];
      let cur = start, prev = null;
      for (;;) {
        const nbrs = adj.get(cur) || [];
        let next = nbrs.find((c) => c !== prev && !used.has(edgeKey(cur, c)));
        if (next === undefined) next = nbrs.find((c) => !used.has(edgeKey(cur, c)));
        if (next === undefined) break;
        used.add(edgeKey(cur, next));
        path.push(next);
        prev = cur;
        cur = next;
        if (next === start) break;
      }
      if (path.length < 4) break;
      if (path[0] !== path[path.length - 1]) path.push(path[0]);
      rings.push(path.map((p) => p.split(',').map(Number)));
    }
  }

  rings.sort((a, b) => ringCentroid(b).area - ringCentroid(a).area);
  if (rings.length && minFrac) {
    const big = ringCentroid(rings[0]).area;
    return rings.filter((r) => ringCentroid(r).area >= big * minFrac);
  }
  return rings;
}

/**
 * Кольца -> MultiPolygon. Кольцо внутри нечётного числа других — дырка.
 *
 * Без разбора вложенности несколько отдельных кусков лесничества склеились бы
 * в один полигон с ложными дырками — у Каскеленского такие кварталы есть.
 */
export function ringsToMultiPolygon(rings) {
  if (!rings || rings.length === 0) return null;
  const depth = rings.map((r, i) => {
    const [x, y] = r[0];
    let d = 0;
    for (let j = 0; j < rings.length; j++) {
      if (j !== i && ringContains(rings[j], x, y)) d++;
    }
    return d;
  });

  const parts = [];
  for (let i = 0; i < rings.length; i++) {
    if (depth[i] % 2 === 1) continue;
    const holes = rings.filter((r, j) => depth[j] === depth[i] + 1 && ringContains(rings[i], r[0][0], r[0][1]));
    parts.push([rings[i], ...holes]);
  }
  return parts.length ? { type: 'MultiPolygon', coordinates: parts } : null;
}

/** Контур лесничества: предпочтительно по кварталам, иначе по выделам. */
export function outlineOf(vydels, kvartaly) {
  const src = (kvartaly && kvartaly.length ? kvartaly : vydels)
    .map((f) => f.geometry)
    .filter(Boolean);
  if (src.length === 0) return null;
  try {
    return ringsToMultiPolygon(dissolve(src));
  } catch {
    return null;
  }
}
