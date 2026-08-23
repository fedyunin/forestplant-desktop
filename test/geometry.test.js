import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bbox, countVertices, labelPoint, geomContains,
  dissolve, ringsToMultiPolygon, signedArea,
} from '../src/core/geometry.js';

const square = (x, y, s = 1) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]],
});

/** Г-образная фигура: центроид лежит снаружи. */
const lShape = {
  type: 'Polygon',
  coordinates: [[[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3], [0, 0]]],
};

/** Квадрат с дыркой посередине. */
const donut = {
  type: 'Polygon',
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]],
  ],
};

test('bbox покрывает все части геометрии', () => {
  const b = bbox({ type: 'MultiPolygon', coordinates: [square(0, 0).coordinates, square(5, 5).coordinates] });
  assert.deepEqual(b, { minx: 0, miny: 0, maxx: 6, maxy: 6 });
});

test('вершины считаются по всем кольцам и частям', () => {
  assert.equal(countVertices(square(0, 0)), 5);
  assert.equal(countVertices(donut), 10);
  assert.equal(countVertices({ type: 'Point', coordinates: [1, 2] }), 1);
  assert.equal(countVertices(null), 0);
});

test('подпись ставится внутри выпуклой фигуры', () => {
  const p = labelPoint(square(0, 0));
  assert.ok(geomContains(square(0, 0), p.x, p.y));
});

test('подпись ставится внутри вогнутой фигуры', () => {
  // У Г-образной фигуры центроид снаружи — сюда и падал наивный расчёт
  const p = labelPoint(lShape);
  assert.ok(geomContains(lShape, p.x, p.y), `точка ${p.x},${p.y} вне фигуры`);
});

test('подпись не попадает в дырку', () => {
  const p = labelPoint(donut);
  assert.ok(geomContains(donut, p.x, p.y), `точка ${p.x},${p.y} в дырке или снаружи`);
});

test('подпись садится на самую крупную часть', () => {
  const multi = {
    type: 'MultiPolygon',
    coordinates: [square(0, 0, 0.2).coordinates, square(10, 10, 5).coordinates],
  };
  const p = labelPoint(multi);
  assert.ok(p.x >= 10 && p.x <= 15, `ожидалась крупная часть, получено ${p.x}`);
});

test('склейка двух смежных квадратов даёт один прямоугольник', () => {
  const rings = dissolve([square(0, 0), square(1, 0)]);
  assert.equal(rings.length, 1, 'внутреннее ребро должно исчезнуть');
  assert.equal(Math.abs(signedArea(rings[0])), 2, 'площадь равна сумме частей');
});

test('склейка сохраняет отдельные куски как отдельные кольца', () => {
  const rings = dissolve([square(0, 0), square(10, 10)]);
  assert.equal(rings.length, 2);
});

test('склейка кольца из четырёх квадратов оставляет дырку', () => {
  const parts = [square(0, 0), square(1, 0), square(2, 0), square(2, 1), square(2, 2),
    square(1, 2), square(0, 2), square(0, 1)];
  const rings = dissolve(parts, { minFrac: 0 });
  assert.equal(rings.length, 2, 'внешний контур и дырка в середине');
  const mp = ringsToMultiPolygon(rings);
  assert.equal(mp.coordinates.length, 1, 'один полигон');
  assert.equal(mp.coordinates[0].length, 2, 'внешнее кольцо плюс дырка');
  assert.ok(!geomContains(mp, 1.5, 1.5), 'середина не принадлежит фигуре');
});

test('отдельные куски не превращаются в ложные дырки', () => {
  // Именно так у Каскеленского два отдельных куска квартала
  // склеивались бы в полигон с несуществующей дыркой
  const mp = ringsToMultiPolygon(dissolve([square(0, 0), square(10, 10)]));
  assert.equal(mp.coordinates.length, 2, 'две независимые части');
  assert.equal(mp.coordinates[0].length, 1, 'без дырок');
  assert.equal(mp.coordinates[1].length, 1, 'без дырок');
});

test('микроскопические кольца-слипы отсекаются', () => {
  const big = [square(0, 0, 100), square(100, 0, 100)];
  const withSliver = [...big, square(50, 50, 0.001)];
  const all = dissolve(withSliver, { minFrac: 0 });
  const filtered = dissolve(withSliver, { minFrac: 2e-4 });
  assert.ok(filtered.length < all.length, 'слип должен отсеяться');
});
