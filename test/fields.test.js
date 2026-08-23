import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRoles, classifyLayer, forestryKey, asInt } from '../src/core/fields.js';

/* Реальные наборы полей из системы — по одному на каждую встреченную схему. */
const ALMATY = ['OBJECTID', 'Лесничество', 'КатегорияЗащитностиЛесныхЗемель',
  'НумерацияКварталов', 'НумерацияВыделов', 'Площадь', 'КатегорияЛесныхЗемель',
  'Бонитет', 'ТипЛеса', 'Порода', 'PorodaPP', 'company'];
const PAVLODAR = ['OBJECTID', 'Лесничеств', 'КатЗащ', 'Nкварт', 'Nвыд', 'Площ',
  'КатЗем', 'Бонитет', 'Тип_леса', 'Порода', 'ПородаПП'];
const VARIANT_NKV = ['OBJECTID', 'Лесничеств', 'NКварт', 'NВыд'];
const VARIANT_UNDERSCORE = ['OBJECTID', 'Лесничество', 'Нумерация_кварталов', 'Нумерация_выделов'];
/* Костанайская область: имена полей усечены. */
const TRUNCATED = ['OBJECTID', 'Лесни', 'Nквар', 'company'];

test('роли распознаются во всех вариантах написания', () => {
  for (const [name, fields, kv, vd] of [
    ['Алматинская', ALMATY, 'НумерацияКварталов', 'НумерацияВыделов'],
    ['Павлодарская', PAVLODAR, 'Nкварт', 'Nвыд'],
    ['вариант NКварт', VARIANT_NKV, 'NКварт', 'NВыд'],
    ['вариант с подчёркиванием', VARIANT_UNDERSCORE, 'Нумерация_кварталов', 'Нумерация_выделов'],
  ]) {
    const r = resolveRoles(fields);
    assert.equal(r.kv, kv, `${name}: номер квартала`);
    assert.equal(r.vd, vd, `${name}: номер выдела`);
    assert.ok(r.les, `${name}: лесничество`);
  }
});

test('усечённые имена полей распознаются', () => {
  // Костанайская: «Лесни» и «Nквар» вместо полных слов. Требование полных
  // окончаний молча отключало связывание кварталов для всей области.
  const r = resolveRoles(TRUNCATED);
  assert.equal(r.les, 'Лесни');
  assert.equal(r.kv, 'Nквар');
});

test('название лесничества чистится от мусора в значении', () => {
  // В данных встречается ",Кондратьевское" — с ведущей запятой
  assert.equal(forestryKey(',Кондратьевское'), forestryKey('Кондратьевское'));
});

test('«категория земель» не перехватывается «защитностью»', () => {
  // В «КатегорияЗащитностиЛесныхЗемель» есть и «категор», и «Земель»:
  // без исключающего шаблона настоящая КатегорияЛесныхЗемель терялась.
  const r = resolveRoles(ALMATY);
  assert.equal(r.kat_zem, 'КатегорияЛесныхЗемель');
  assert.equal(r.kat_zasch, 'КатегорияЗащитностиЛесныхЗемель');
});

test('номер квартала и номер выдела не путаются между собой', () => {
  const r = resolveRoles(PAVLODAR);
  assert.notEqual(r.kv, r.vd);
  assert.equal(r.kv, 'Nкварт');
  assert.equal(r.vd, 'Nвыд');
});

test('тип слоя определяется по полям, а не по названию', () => {
  const roles = resolveRoles(PAVLODAR);
  // у СКО слои выделов называются «ВыдПород», «ВыдПород2_12» — по имени не опознать
  assert.equal(classifyLayer({ layerName: 'ВыдПород2_12', geometryType: 'esriGeometryPolygon' }, roles), 'vydel');
  assert.equal(classifyLayer({ layerName: 'Границы выделов', geometryType: 'esriGeometryPolygon' }, roles), 'vydel');
  assert.equal(
    classifyLayer({ layerName: 'Границы кварталов', geometryType: 'esriGeometryPolygon' }, { kv: 'НумерацияКварталов', les: 'Лесничество' }),
    'kvartal',
  );
  assert.equal(classifyLayer({ layerName: 'Посадка деревьев', geometryType: 'esriGeometryPoint' }, roles), 'misc');
});

test('ключ лесничества сводит разные написания к одному', () => {
  const same = [
    ['Каскеленское лесничество', 'Каскеленское'],
    ['Мало-Алматинское лесничество', 'Мало-Алматинское'],
    ['Талгарский участок', 'Талгарский'],
    ['Уч.Бессаз', 'Бессаз'],
    ['Л-во им. Шокана Уалиханова', 'им Шокана Уалиханова'],
    ['Каратальское лесничество', 'каратальское'],
  ];
  for (const [a, b] of same) {
    assert.equal(forestryKey(a), forestryKey(b), `${a} против ${b}`);
  }
});

test('ключ лесничества различает разные лесничества', () => {
  assert.notEqual(forestryKey('Каскеленское'), forestryKey('Каратальское'));
  assert.notEqual(forestryKey('Аксуское'), forestryKey('Аксайское'));
});

test('ключ устойчив к регистру и букве ё', () => {
  assert.equal(forestryKey('КОКЖИДИНСКОЕ'), forestryKey('Кокжидинское'));
  assert.equal(forestryKey('Тёплое'), forestryKey('Теплое'));
});

test('числа разбираются с отбрасыванием дробной части', () => {
  assert.equal(asInt(29), 29);
  assert.equal(asInt('29'), 29);
  assert.equal(asInt(29.0), 29);
  assert.equal(asInt(null), null);
  assert.equal(asInt(''), null);
  assert.equal(asInt('нет'), null);
});
