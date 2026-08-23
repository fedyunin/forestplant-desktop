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

/** An L-shape: its centroid lies outside. */
const lShape = {
  type: 'Polygon',
  coordinates: [[[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3], [0, 0]]],
};

/** A square with a hole in the middle. */
const donut = {
  type: 'Polygon',
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]],
  ],
};

test('bbox covers every part of a geometry', () => {
  const b = bbox({ type: 'MultiPolygon', coordinates: [square(0, 0).coordinates, square(5, 5).coordinates] });
  assert.deepEqual(b, { minx: 0, miny: 0, maxx: 6, maxy: 6 });
});

test('vertices are counted across all rings and parts', () => {
  assert.equal(countVertices(square(0, 0)), 5);
  assert.equal(countVertices(donut), 10);
  assert.equal(countVertices({ type: 'Point', coordinates: [1, 2] }), 1);
  assert.equal(countVertices(null), 0);
});

test('a label lands inside a convex shape', () => {
  const p = labelPoint(square(0, 0));
  assert.ok(geomContains(square(0, 0), p.x, p.y));
});

test('a label lands inside a concave shape', () => {
  // The centroid of an L-shape is outside — that is where the naive maths fell
  const p = labelPoint(lShape);
  assert.ok(geomContains(lShape, p.x, p.y), `point ${p.x},${p.y} is outside the shape`);
});

test('a label does not land in a hole', () => {
  const p = labelPoint(donut);
  assert.ok(geomContains(donut, p.x, p.y), `point ${p.x},${p.y} is in the hole or outside`);
});

test('a label sits on the largest part', () => {
  const multi = {
    type: 'MultiPolygon',
    coordinates: [square(0, 0, 0.2).coordinates, square(10, 10, 5).coordinates],
  };
  const p = labelPoint(multi);
  assert.ok(p.x >= 10 && p.x <= 15, `the large part was expected, got ${p.x}`);
});

test('merging two adjacent squares yields one rectangle', () => {
  const rings = dissolve([square(0, 0), square(1, 0)]);
  assert.equal(rings.length, 1, 'the interior edge must disappear');
  assert.equal(Math.abs(signedArea(rings[0])), 2, 'the area equals the sum of the parts');
});

test('merging keeps separate pieces as separate rings', () => {
  const rings = dissolve([square(0, 0), square(10, 10)]);
  assert.equal(rings.length, 2);
});

test('merging a ring of four squares leaves a hole', () => {
  const parts = [square(0, 0), square(1, 0), square(2, 0), square(2, 1), square(2, 2),
    square(1, 2), square(0, 2), square(0, 1)];
  const rings = dissolve(parts, { minFrac: 0 });
  assert.equal(rings.length, 2, 'the outer outline and the hole in the middle');
  const mp = ringsToMultiPolygon(rings);
  assert.equal(mp.coordinates.length, 1, 'one polygon');
  assert.equal(mp.coordinates[0].length, 2, 'an outer ring plus a hole');
  assert.ok(!geomContains(mp, 1.5, 1.5), 'the middle does not belong to the shape');
});

test('separate pieces do not turn into false holes', () => {
  // This is exactly how two separate pieces of a Kaskelenskoe block would
  // have merged into a polygon with a hole that does not exist
  const mp = ringsToMultiPolygon(dissolve([square(0, 0), square(10, 10)]));
  assert.equal(mp.coordinates.length, 2, 'two independent parts');
  assert.equal(mp.coordinates[0].length, 1, 'no holes');
  assert.equal(mp.coordinates[1].length, 1, 'no holes');
});

test('microscopic sliver rings are dropped', () => {
  const big = [square(0, 0, 100), square(100, 0, 100)];
  const withSliver = [...big, square(50, 50, 0.001)];
  const all = dissolve(withSliver, { minFrac: 0 });
  const filtered = dissolve(withSliver, { minFrac: 2e-4 });
  assert.ok(filtered.length < all.length, 'the sliver must be filtered out');
});
