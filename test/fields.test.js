import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRoles, classifyLayer, forestryKey, asInt } from '../src/core/fields.js';

/* Real field sets from the system — one per schema encountered. */
const ALMATY = ['OBJECTID', 'Лесничество', 'КатегорияЗащитностиЛесныхЗемель',
  'НумерацияКварталов', 'НумерацияВыделов', 'Площадь', 'КатегорияЛесныхЗемель',
  'Бонитет', 'ТипЛеса', 'Порода', 'PorodaPP', 'company'];
const PAVLODAR = ['OBJECTID', 'Лесничеств', 'КатЗащ', 'Nкварт', 'Nвыд', 'Площ',
  'КатЗем', 'Бонитет', 'Тип_леса', 'Порода', 'ПородаПП'];
const VARIANT_NKV = ['OBJECTID', 'Лесничеств', 'NКварт', 'NВыд'];
const VARIANT_UNDERSCORE = ['OBJECTID', 'Лесничество', 'Нумерация_кварталов', 'Нумерация_выделов'];
/* Kostanay region: the field names are truncated. */
const TRUNCATED = ['OBJECTID', 'Лесни', 'Nквар', 'company'];

test('roles are recognised in every spelling', () => {
  for (const [name, fields, kv, vd] of [
    ['Almaty', ALMATY, 'НумерацияКварталов', 'НумерацияВыделов'],
    ['Pavlodar', PAVLODAR, 'Nкварт', 'Nвыд'],
    ['NКварт variant', VARIANT_NKV, 'NКварт', 'NВыд'],
    ['underscore variant', VARIANT_UNDERSCORE, 'Нумерация_кварталов', 'Нумерация_выделов'],
  ]) {
    const r = resolveRoles(fields);
    assert.equal(r.kv, kv, `${name}: block number`);
    assert.equal(r.vd, vd, `${name}: stand number`);
    assert.ok(r.les, `${name}: forestry`);
  }
});

test('truncated field names are recognised', () => {
  // Kostanay: «Лесни» and «Nквар» instead of whole words. Demanding full
  // endings silently switched off block linking for the entire region.
  const r = resolveRoles(TRUNCATED);
  assert.equal(r.les, 'Лесни');
  assert.equal(r.kv, 'Nквар');
});

test('a forestry name is cleaned of rubbish in the value', () => {
  // The data contains ",Кондратьевское" — with a leading comma
  assert.equal(forestryKey(',Кондратьевское'), forestryKey('Кондратьевское'));
});

test('«land category» is not stolen by «protection category»', () => {
  // «КатегорияЗащитностиЛесныхЗемель» holds both «категор» and «Земель»:
  // without an excluding pattern the real КатегорияЛесныхЗемель was lost.
  const r = resolveRoles(ALMATY);
  assert.equal(r.kat_zem, 'КатегорияЛесныхЗемель');
  assert.equal(r.kat_zasch, 'КатегорияЗащитностиЛесныхЗемель');
});

test('the block number and the stand number are not confused', () => {
  const r = resolveRoles(PAVLODAR);
  assert.notEqual(r.kv, r.vd);
  assert.equal(r.kv, 'Nкварт');
  assert.equal(r.vd, 'Nвыд');
});

test('the layer type is decided by fields, not by name', () => {
  const roles = resolveRoles(PAVLODAR);
  // in North Kazakhstan the stand layers are called «ВыдПород», «ВыдПород2_12»
  assert.equal(classifyLayer({ layerName: 'ВыдПород2_12', geometryType: 'esriGeometryPolygon' }, roles), 'vydel');
  assert.equal(classifyLayer({ layerName: 'Границы выделов', geometryType: 'esriGeometryPolygon' }, roles), 'vydel');
  assert.equal(
    classifyLayer({ layerName: 'Границы кварталов', geometryType: 'esriGeometryPolygon' }, { kv: 'НумерацияКварталов', les: 'Лесничество' }),
    'kvartal',
  );
  assert.equal(classifyLayer({ layerName: 'Посадка деревьев', geometryType: 'esriGeometryPoint' }, roles), 'misc');
});

test('the forestry key folds different spellings into one', () => {
  const same = [
    ['Каскеленское лесничество', 'Каскеленское'],
    ['Мало-Алматинское лесничество', 'Мало-Алматинское'],
    ['Талгарский участок', 'Талгарский'],
    ['Уч.Бессаз', 'Бессаз'],
    ['Л-во им. Шокана Уалиханова', 'им Шокана Уалиханова'],
    ['Каратальское лесничество', 'каратальское'],
  ];
  for (const [a, b] of same) {
    assert.equal(forestryKey(a), forestryKey(b), `${a} against ${b}`);
  }
});

test('the forestry key still tells different forestries apart', () => {
  assert.notEqual(forestryKey('Каскеленское'), forestryKey('Каратальское'));
  assert.notEqual(forestryKey('Аксуское'), forestryKey('Аксайское'));
});

test('the key survives case and the letter ё', () => {
  assert.equal(forestryKey('КОКЖИДИНСКОЕ'), forestryKey('Кокжидинское'));
  assert.equal(forestryKey('Тёплое'), forestryKey('Теплое'));
});

test('numbers are parsed with the fractional part dropped', () => {
  assert.equal(asInt(29), 29);
  assert.equal(asInt('29'), 29);
  assert.equal(asInt(29.0), 29);
  assert.equal(asInt(null), null);
  assert.equal(asInt(''), null);
  assert.equal(asInt('нет'), null);
});
