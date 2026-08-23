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

test('цвет переводится в порядок KML (aabbggrr)', () => {
  assert.equal(kmlColor('#FFD400'), 'ff00d4ff');
  assert.equal(kmlColor('#9400D3'), 'ffd30094');
  assert.equal(kmlColor('#00A03C', 0.12), '1f3ca000');
  assert.equal(kmlColor('ff00d4ff'), 'ff00d4ff', 'готовый код проходит как есть');
});

test('документ содержит все слои и подписи', () => {
  const xml = buildKml({
    name: 'Тест',
    vydels: [vydel(1, 2), vydel(1, 3)],
    kvartaly: [{ properties: {}, geometry: poly(0, 0, 6), kvartal: 1 }],
    outline: poly(0, 0, 8),
  });
  for (const folder of ['Границы лесничества', 'Кварталы', 'Подписи кварталов', 'Выделы', 'Подписи выделов']) {
    assert.ok(xml.includes(`<name>${folder}</name>`), `нет папки «${folder}»`);
  }
  assert.ok(xml.includes('<name>кв 1 выд 2</name>'));
  assert.ok(xml.includes('<name>КВ-1</name>'));
});

test('подписи выводятся в трёх форматах', () => {
  const opts = { name: 'Т', vydels: [vydel(29, 5)], kvartaly: [], outline: null };
  assert.ok(buildKml({ ...opts, labelFormat: 'vydel' }).includes('<name>5</name>'));
  assert.ok(buildKml({ ...opts, labelFormat: 'kv-vd' }).includes('<name>29-5</name>'));
  assert.ok(buildKml({ ...opts, labelFormat: 'full' }).includes('<name>кв 29 выд 5</name>'));
});

test('служебные ключи не утекают в балун', () => {
  const v = vydel(1, 2);
  v.properties._kv = 1;
  v.properties.last_edited_date = 123;
  const xml = buildKml({ name: 'Т', vydels: [v], kvartaly: [] });
  // Проверяем именно поля данных: подстрока «_kv» есть и в id стиля lbl_kvartal
  assert.ok(!xml.includes('name="_kv"'), 'служебный ключ виден пользователю');
  assert.ok(!xml.includes('name="last_edited_date"'));
  assert.ok(!/<td><b>_/.test(xml), 'служебный ключ попал в балун');
  assert.ok(xml.includes('Сосна'), 'полезные атрибуты должны остаться');
});

test('без подписей папки подписей отсутствуют', () => {
  const xml = buildKml({ name: 'Т', vydels: [vydel(1, 2)], kvartaly: [], labels: false });
  assert.ok(!xml.includes('Подписи выделов'));
  assert.ok(xml.includes('Выделы'));
});

test('разбивка укладывается в бюджет вершин', () => {
  // 60 фигур по 21 вершине, каждая плюс вершина подписи
  const vydels = Array.from({ length: 60 }, (_, i) => vydel(1, i, i, 0, 20));
  const budget = 300;
  const { chunks } = planChunks({ vydels, kvartaly: [], outline: null, labels: true, budget });
  assert.ok(chunks.length > 1, 'должно разбиться');
  for (const c of chunks) {
    const v = c.reduce((s, f) => s + countVertices(f.geometry) + 1, 0);
    assert.ok(v <= budget, `часть на ${v} вершин превышает бюджет ${budget}`);
  }
  assert.equal(chunks.flat().length, vydels.length, 'ни один выдел не потерян');
});

test('кварталы и контур попадают только в первую часть', () => {
  const vydels = Array.from({ length: 40 }, (_, i) => vydel(1, i, i, 0, 20));
  const parts = buildKmlSet({
    name: 'Т', vydels,
    kvartaly: [{ properties: {}, geometry: poly(0, 0, 6), kvartal: 1 }],
    budget: 300,
  });
  assert.ok(parts.length > 1);
  assert.equal(parts[0].counts.kvartaly, 1);
  for (const p of parts.slice(1)) {
    assert.equal(p.counts.kvartaly, 0, 'кварталы задублированы');
    assert.ok(!p.content.includes('Границы лесничества'), 'контур задублирован');
  }
});

test('тяжёлые кварталы уезжают в отдельный файл', () => {
  // У Илийского лесничества кварталы с контуром весили больше, чем оставалось
  // выделам, и первая часть выходила за лимит: 260 274 вершины при пороге
  // 250 000. Ни одна часть не должна превышать бюджет ни при каком раскладе.
  const budget = 1000;
  const heavyKvartaly = Array.from({ length: 8 }, (_, i) => ({
    properties: {}, geometry: poly(i, 0, 100), kvartal: i,
  }));
  const vydels = Array.from({ length: 30 }, (_, i) => vydel(1, i, i, 0, 20));
  const parts = buildKmlSet({ name: 'Илийское', vydels, kvartaly: heavyKvartaly, budget });

  for (const p of parts) {
    const v = [...p.content.matchAll(/<coordinates>([^<]*)<\/coordinates>/g)]
      .reduce((n, m) => n + m[1].trim().split(/\s+/).length, 0);
    assert.ok(v <= budget, `часть «${p.name}» на ${v} вершин превышает бюджет ${budget}`);
  }
  assert.equal(parts.reduce((s, p) => s + p.counts.vydels, 0), vydels.length, 'выделы потеряны');
  assert.equal(parts.reduce((s, p) => s + p.counts.kvartaly, 0), heavyKvartaly.length, 'кварталы потеряны');
});

test('части подписаны по-человечески', () => {
  const vydels = Array.from({ length: 40 }, (_, i) => vydel(1, i, i, 0, 20));
  const parts = buildKmlSet({ name: 'Каскеленское', vydels, budget: 300 });
  assert.match(parts[0].name, /часть 1 из \d+/);
});

test('единственная часть остаётся без суффикса', () => {
  const parts = buildKmlSet({ name: 'Каскеленское', vydels: [vydel(1, 2)] });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].suffix, '');
  assert.equal(parts[0].name, 'Каскеленское');
});

test('сводный файл ссылается на все части', () => {
  const xml = buildIndexKml('Сводный', [
    { name: 'A', href: 'a.kml' }, { name: 'B', href: 'дир/b.kml' },
  ]);
  assert.equal((xml.match(/<NetworkLink>/g) || []).length, 2);
  assert.ok(xml.includes('<href>дир/b.kml</href>'));
});

test('спецсимволы в названиях экранируются', () => {
  const v = vydel(1, 2);
  v.properties['Порода & вид'] = '<Сосна>';
  const xml = buildKml({ name: 'Лес & "Тест"', vydels: [v], kvartaly: [] });
  assert.ok(xml.includes('Лес &amp; &quot;Тест&quot;'));
  assert.ok(!xml.includes('<Сосна>'));
});
