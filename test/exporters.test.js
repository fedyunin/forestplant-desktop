import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import geojson from '../src/exporters/geojson.js';
import csv from '../src/exporters/csv.js';
import { exporters, getExporter, defaultOptions, sanitizeOptions } from '../src/exporters/index.js';

const square = (x, y, s = 1) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]],
});

const stand = (kv, vd, props = {}, canon = {}) => ({
  properties: { OBJECTID: vd, Порода: 'Сосна', ...props },
  geometry: square(kv, vd, 0.01),
  kvartal: kv,
  vydel: vd,
  canon: {
    oblast: 'Алматинская область',
    lesnichestvo: 'Каскеленское',
    ploshad: 4.2,
    poroda: 'Сосна',
    bonitet: '2',
    tip_lesa: 'С3',
    kat_zem: 'Покрытые лесом',
    ...canon,
  },
});

/** A selection the way queries.selection() hands one over. */
const fakeData = (vydels, kvartaly = []) => ({
  groups: () => [{
    layer_key: 'L1', oblast: 'Алматинская область',
    uchrezhdenie: 'Талгарский филиал', lesnichestvo: 'Каскеленское',
  }],
  rows: (_g, { kvartaly: want = true } = {}) => ({ vydels, kvartaly: want ? kvartaly : [] }),
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fp-export-'));
const run = (exporter, data, over = {}) => {
  const outDir = tmp();
  const res = exporter.run({
    data,
    options: sanitizeOptions(exporter.id, { ...defaultOptions(exporter.id), ...over }),
    outDir,
    lang: 'ru',
  });
  return { res, outDir, read: (i = 0) => fs.readFileSync(res.files[i].file, 'utf8') };
};

test('the registry offers every format with what the window needs', () => {
  const list = exporters();
  assert.deepEqual(list.map((e) => e.id), ['kml', 'geojson', 'csv']);
  for (const e of list) {
    assert.ok(e.name && e.hint && e.estimate, `${e.id} lacks a translation key`);
    assert.ok(e.options.length > 0);
    assert.equal(typeof getExporter(e.id).plan, 'function', `${e.id} has no plan()`);
    assert.equal(typeof getExporter(e.id).run, 'function');
  }
});

test('every format says what its estimate should count', () => {
  const plan = (id) => getExporter(id).plan(defaultOptions(id));
  assert.equal(plan('kml').budget > 0, true, 'KML splits by a vertex budget');
  assert.equal(plan('geojson').budget, null, 'GeoJSON has no size limit of its own');
  assert.equal(plan('csv').budget, null);
  assert.equal(plan('csv').vdPoly, false, 'a CSV holds no geometry to count');
  assert.equal(plan('geojson').vdPoly, true);
});

/* ---------------------------------------------------------------- GeoJSON */

test('GeoJSON writes a valid FeatureCollection', () => {
  const { res, read } = run(geojson, fakeData([stand(1, 2), stand(1, 3)]));
  assert.equal(res.files.length, 1);
  assert.equal(res.vydels, 2);

  const doc = JSON.parse(read());
  assert.equal(doc.type, 'FeatureCollection');
  assert.equal(doc.features.length, 2);
  assert.equal(doc.features[0].type, 'Feature');
  assert.equal(doc.features[0].geometry.type, 'Polygon');
  assert.equal(doc.features[0].properties.kvartal, 1);
  assert.equal(doc.features[0].properties.poroda, 'Сосна');
});

test('GeoJSON attribute modes hold what they promise', () => {
  const data = fakeData([stand(1, 2, { ПородаПП: 'Ель' })]);

  const both = JSON.parse(run(geojson, data, { attrs: 'both' }).read()).features[0].properties;
  assert.equal(both.ploshad, 4.2, 'the parsed column is there');
  assert.equal(both.ПородаПП, 'Ель', 'and so is the raw attribute');

  const canon = JSON.parse(run(geojson, data, { attrs: 'canonical' }).read()).features[0].properties;
  assert.equal(canon.ploshad, 4.2);
  assert.equal(canon.ПородаПП, undefined);

  const raw = JSON.parse(run(geojson, data, { attrs: 'raw' }).read()).features[0].properties;
  assert.equal(raw.ПородаПП, 'Ель');
  assert.equal(raw.ploshad, undefined);
  assert.equal(raw.last_edited_date, undefined, 'service fields stay out');
});

test('GeoJSON skips broken geometry instead of writing null', () => {
  const broken = stand(1, 4);
  broken.geometry = null;
  const { res, read } = run(geojson, fakeData([stand(1, 2), broken]));
  assert.equal(res.skippedGeom, 1);
  const doc = JSON.parse(read());
  assert.equal(doc.features.length, 1, 'only the usable object is written');
});

test('GeoJSON puts the blocks in a file of their own when asked', () => {
  const blocks = [{ properties: {}, geometry: square(0, 0, 2), kvartal: 1, canon: {} }];
  const off = run(geojson, fakeData([stand(1, 2)], blocks));
  assert.equal(off.res.files.length, 1, 'blocks are off by default');

  const on = run(geojson, fakeData([stand(1, 2)], blocks), { kvartaly: true });
  assert.equal(on.res.files.length, 2);
  assert.match(on.res.files[1].file, /кварталы\.geojson$/);
  assert.equal(JSON.parse(on.read(1)).features.length, 1);
});

/* ---------------------------------------------------------------- CSV */

test('CSV opens in Excel: BOM, semicolons, CRLF', () => {
  const { read } = run(csv, fakeData([stand(1, 2)]));
  const text = read();
  assert.ok(text.startsWith('﻿'), 'without the BOM Excel mangles Cyrillic');
  assert.ok(text.includes('\r\n'), 'Excel expects CRLF');
  const [header, row] = text.replace(/^\ufeff/, '').trim().split('\r\n');
  assert.equal(header.split(';')[0], 'oblast');
  assert.equal(row.split(';')[3], '1', 'kvartal');
  assert.equal(row.split(';')[4], '2', 'vydel');
});

test('CSV delimiters and the BOM are settings, not assumptions', () => {
  const comma = run(csv, fakeData([stand(1, 2)]), { delimiter: 'comma', bom: false }).read();
  assert.ok(!comma.startsWith('﻿'));
  assert.ok(comma.split('\r\n')[0].includes(','));

  const tab = run(csv, fakeData([stand(1, 2)]), { delimiter: 'tab' }).read();
  assert.ok(tab.split('\r\n')[0].includes('\t'));
});

test('CSV quotes what would otherwise break a row', () => {
  const messy = stand(1, 2, {}, { poroda: 'Сосна; ель', lesnichestvo: 'Он сказал "да"' });
  const text = run(csv, fakeData([messy])).read();
  assert.ok(text.includes('"Сосна; ель"'), 'a delimiter inside a value must be quoted');
  assert.ok(text.includes('"Он сказал ""да"""'), 'quotes are doubled');
});

test('CSV does not hand a spreadsheet a formula', () => {
  // A value out of someone else's database should not execute in Excel
  const nasty = stand(1, 2, {}, { poroda: '=1+1', tip_lesa: '@SUM(A1)' });
  const text = run(csv, fakeData([nasty])).read();
  assert.ok(text.includes("'=1+1"), 'a leading = is neutralised');
  assert.ok(text.includes("'@SUM(A1)"));
  // a negative number is data, not a formula
  const negative = stand(1, 2, {}, { ploshad: -4.2 });
  assert.ok(run(csv, fakeData([negative])).read().includes('-4.2'));
});

test('CSV coordinates land inside the stand', () => {
  const text = run(csv, fakeData([stand(1, 2)])).read();
  const header = text.replace(/^\ufeff/, '').split('\r\n')[0].split(';');
  const row = text.replace(/^\ufeff/, '').split('\r\n')[1].split(';');
  const lon = Number(row[header.indexOf('lon')]);
  const lat = Number(row[header.indexOf('lat')]);
  assert.ok(lon > 1 && lon < 1.01, `lon ${lon} is outside the square`);
  assert.ok(lat > 2 && lat < 2.01, `lat ${lat} is outside the square`);

  const without = run(csv, fakeData([stand(1, 2)]), { coords: false }).read();
  assert.ok(!without.includes('lon'), 'the columns go away when switched off');
});

test('CSV raw columns are the union of what the selection holds', () => {
  // Field names differ between regions: a fixed column list would drop one
  // region's fields and write empty ones for another
  const data = fakeData([
    stand(1, 2, { Порода: 'Сосна' }),
    stand(1, 3, { ПородаПП: 'Ель', Бонитет: '3' }),
  ]);
  const text = run(csv, data, { attrs: 'both' }).read();
  const header = text.replace(/^\ufeff/, '').split('\r\n')[0];
  for (const col of ['Порода', 'ПородаПП', 'Бонитет']) {
    assert.ok(header.includes(col), `column ${col} is missing`);
  }
  const rows = text.replace(/^\ufeff/, '').trim().split('\r\n').slice(1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].split(';').length, rows[1].split(';').length, 'rows stay rectangular');
});

/* ------------------------------------------------- what the review caught */

test('a formula-looking value is neutralised, a number is not', () => {
  // «-2+3+cmd|' /C calc'!A0» is the classic CSV injection, and it starts with
  // a minus — the same character a negative area starts with
  const nasty = stand(1, 2, {}, { poroda: "-2+3+cmd|' /C calc'!A0", ploshad: -4.2 });
  const text = run(csv, fakeData([nasty])).read();
  assert.ok(text.includes("'-2+3+cmd"), 'the formula must not stay a formula');
  assert.ok(/(^|;)-4\.2(;|\r)/.test(text), 'a negative number stays a number');
});

test('the agency column is filled even without grouping', () => {
  // groups('none') has no agency of its own; the value has to come from the row
  const data = {
    groups: () => [{ layer_key: null, oblast: null, uchrezhdenie: null, lesnichestvo: null }],
    rows: () => ({ vydels: [stand(1, 2, {}, { uchrezhdenie: 'Талгарский филиал' })], kvartaly: [] }),
  };
  const text = run(csv, data, { split: 'none' }).read();
  assert.ok(text.includes('Талгарский филиал'), 'the agency is lost under split=none');
});

test('GeoJSON writes no file when nothing has geometry', () => {
  const broken = stand(1, 2);
  broken.geometry = null;
  const { res, outDir } = run(geojson, fakeData([broken]));
  assert.equal(res.files.length, 0, 'an empty collection is not a file worth writing');
  assert.equal(res.skippedGeom, 1);
  const written = fs.readdirSync(outDir, { recursive: true }).filter((p) => String(p).endsWith('.geojson'));
  assert.deepEqual(written, [], 'and nothing is left on disk');
});

test('the blocks file is counted in the estimate', () => {
  const plain = getExporter('geojson').plan({ ...defaultOptions('geojson'), kvartaly: false });
  const withBlocks = getExporter('geojson').plan({ ...defaultOptions('geojson'), kvartaly: true });
  assert.equal(plain.perGroupFiles, 1);
  assert.equal(withBlocks.perGroupFiles, 2, 'the sidecar file has to be promised too');
});
