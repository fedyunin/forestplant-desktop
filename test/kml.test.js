import { test } from 'node:test';
import assert from 'node:assert/strict';

import { kmlColor, buildKml, buildKmlSet, planChunks, buildIndexKml } from '../src/core/kml.js';
import { countVertices } from '../src/core/geometry.js';

const poly = (x, y, n = 5) => {
  const ring = [];
  for (let i = 0; i < n; i++) ring.push([x + Math.cos((i / n) * 2 * Math.PI), y + Math.sin((i / n) * 2 * Math.PI)]);
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
};

const vydel = (kv, vd, x = 0, y = 0, n = 5) => ({
  properties: { OBJECTID: vd, Порода: 'Сосна' },
  geometry: poly(x, y, n),
  kvartal: kv,
  vydel: vd,
});

test('a colour is converted into the KML byte order (aabbggrr)', () => {
  assert.equal(kmlColor('#FFD400'), 'ff00d4ff');
  assert.equal(kmlColor('#9400D3'), 'ffd30094');
  assert.equal(kmlColor('#00A03C', 0.12), '1f3ca000');
  assert.equal(kmlColor('ff00d4ff'), 'ff00d4ff', 'a ready code passes through as it is');
});

test('the document holds every layer and every label', () => {
  const xml = buildKml({
    name: 'Тест',
    vydels: [vydel(1, 2), vydel(1, 3)],
    kvartaly: [{ properties: {}, geometry: poly(0, 0, 6), kvartal: 1 }],
    outline: poly(0, 0, 8),
  });
  for (const folder of ['Границы лесничества', 'Кварталы', 'Подписи кварталов', 'Выделы', 'Подписи выделов']) {
    assert.ok(xml.includes(`<name>${folder}</name>`), `folder «${folder}» is missing`);
  }
  assert.ok(xml.includes('<name>кв 1 выд 2</name>'));
  assert.ok(xml.includes('<name>КВ-1</name>'));
});

test('the text inside the file follows the chosen language', () => {
  const opts = {
    name: 'Test',
    vydels: [vydel(29, 5)],
    kvartaly: [{ properties: {}, geometry: poly(0, 0, 6), kvartal: 29 }],
    outline: poly(0, 0, 8),
    labelFormat: 'full',
  };
  const en = buildKml({ ...opts, lang: 'en' });
  for (const folder of ['Forestry boundary', 'Blocks', 'Block labels', 'Stands', 'Stand labels']) {
    assert.ok(en.includes(`<name>${folder}</name>`), `folder «${folder}» is missing`);
  }
  assert.ok(en.includes('<name>block 29 stand 5</name>'));
  assert.ok(en.includes('<name>BL-29</name>'));

  // Russian stays the default: the data itself is Russian
  assert.ok(buildKml(opts).includes('<name>Выделы</name>'));

  const parts = buildKmlSet({
    name: 'Test',
    vydels: Array.from({ length: 40 }, (_, i) => vydel(1, i, i, 0, 20)),
    budget: 300,
    lang: 'en',
  });
  assert.match(parts[0].name, /part 1 of \d+/);
});

test('labels come out in three formats', () => {
  const opts = { name: 'Т', vydels: [vydel(29, 5)], kvartaly: [], outline: null };
  assert.ok(buildKml({ ...opts, labelFormat: 'vydel' }).includes('<name>5</name>'));
  assert.ok(buildKml({ ...opts, labelFormat: 'kv-vd' }).includes('<name>29-5</name>'));
  assert.ok(buildKml({ ...opts, labelFormat: 'full' }).includes('<name>кв 29 выд 5</name>'));
});

test('service keys do not leak into the balloon', () => {
  const v = vydel(1, 2);
  v.properties._kv = 1;
  v.properties.last_edited_date = 123;
  const xml = buildKml({ name: 'Т', vydels: [v], kvartaly: [] });
  // We check the data fields specifically: the substring «_kv» also occurs in
  // the style id lbl_kvartal
  assert.ok(!xml.includes('name="_kv"'), 'a service key is visible to the user');
  assert.ok(!xml.includes('name="last_edited_date"'));
  assert.ok(!/<td><b>_/.test(xml), 'a service key ended up in the balloon');
  assert.ok(xml.includes('Сосна'), 'useful attributes must stay');
});

test('without labels there are no label folders', () => {
  const xml = buildKml({ name: 'Т', vydels: [vydel(1, 2)], kvartaly: [], labels: false });
  assert.ok(!xml.includes('Подписи выделов'));
  assert.ok(xml.includes('Выделы'));
});

test('splitting stays within the vertex budget', () => {
  // 60 shapes of 21 vertices each, plus one vertex per label
  const vydels = Array.from({ length: 60 }, (_, i) => vydel(1, i, i, 0, 20));
  const budget = 300;
  const { chunks } = planChunks({ vydels, kvartaly: [], outline: null, labels: true, budget });
  assert.ok(chunks.length > 1, 'it should split');
  for (const c of chunks) {
    const v = c.reduce((s, f) => s + countVertices(f.geometry) + 1, 0);
    assert.ok(v <= budget, `a part of ${v} vertices exceeds the budget of ${budget}`);
  }
  assert.equal(chunks.flat().length, vydels.length, 'no stand is lost');
});

test('blocks and the outline go into the first part only', () => {
  const vydels = Array.from({ length: 40 }, (_, i) => vydel(1, i, i, 0, 20));
  const parts = buildKmlSet({
    name: 'Т', vydels,
    kvartaly: [{ properties: {}, geometry: poly(0, 0, 6), kvartal: 1 }],
    budget: 300,
  });
  assert.ok(parts.length > 1);
  assert.equal(parts[0].counts.kvartaly, 1);
  for (const p of parts.slice(1)) {
    assert.equal(p.counts.kvartaly, 0, 'the blocks are duplicated');
    assert.ok(!p.content.includes('Границы лесничества'), 'the outline is duplicated');
  }
});

test('heavy blocks move into a file of their own', () => {
  // At Iliyskoe forestry the blocks with the outline weighed more than the
  // stands had left, and the first part went over the limit: 260 274 vertices
  // against a 250 000 threshold. No part may exceed the budget, ever.
  const budget = 1000;
  const heavyKvartaly = Array.from({ length: 8 }, (_, i) => ({
    properties: {}, geometry: poly(i, 0, 100), kvartal: i,
  }));
  const vydels = Array.from({ length: 30 }, (_, i) => vydel(1, i, i, 0, 20));
  const parts = buildKmlSet({ name: 'Илийское', vydels, kvartaly: heavyKvartaly, budget });

  for (const p of parts) {
    const v = [...p.content.matchAll(/<coordinates>([^<]*)<\/coordinates>/g)]
      .reduce((n, m) => n + m[1].trim().split(/\s+/).length, 0);
    assert.ok(v <= budget, `part «${p.name}» of ${v} vertices exceeds the budget of ${budget}`);
  }
  assert.equal(parts.reduce((s, p) => s + p.counts.vydels, 0), vydels.length, 'stands were lost');
  assert.equal(parts.reduce((s, p) => s + p.counts.kvartaly, 0), heavyKvartaly.length, 'blocks were lost');
});

test('the parts are named in a way a human can read', () => {
  const vydels = Array.from({ length: 40 }, (_, i) => vydel(1, i, i, 0, 20));
  const parts = buildKmlSet({ name: 'Каскеленское', vydels, budget: 300 });
  assert.match(parts[0].name, /часть 1 из \d+/);
});

test('a single part keeps no suffix', () => {
  const parts = buildKmlSet({ name: 'Каскеленское', vydels: [vydel(1, 2)] });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].suffix, '');
  assert.equal(parts[0].name, 'Каскеленское');
});

test('the index file links to every part', () => {
  const xml = buildIndexKml('Сводный', [
    { name: 'A', href: 'a.kml' }, { name: 'B', href: 'дир/b.kml' },
  ]);
  assert.equal((xml.match(/<NetworkLink>/g) || []).length, 2);
  assert.ok(xml.includes('<href>дир/b.kml</href>'));
});

test('special characters in names are escaped', () => {
  const v = vydel(1, 2);
  v.properties['Порода & вид'] = '<Сосна>';
  const xml = buildKml({ name: 'Лес & "Тест"', vydels: [v], kvartaly: [] });
  assert.ok(xml.includes('Лес &amp; &quot;Тест&quot;'));
  assert.ok(!xml.includes('<Сосна>'));
});
