import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { LANGS, setLang, getLang, locale, t } from '../src/renderer/i18n.js';
import { buildKml } from '../src/core/kml.js';

/**
 * The dictionaries are checked against each other rather than by eye.
 *
 * A key added to one language and forgotten in another shows as a phrase in
 * the wrong language, which nobody notices until a user does — the same shape
 * of silent bug as the field roles. So the key sets and the placeholders are
 * compared instead of trusted.
 *
 * The keys are read out of the source: t() falls back to Russian, so a key
 * missing from one dictionary would answer just fine and hide itself.
 */
const dict = (() => {
  const src = fs.readFileSync('src/renderer/i18n.js', 'utf8');
  const out = {};
  for (const lang of LANGS) {
    const start = src.indexOf(`\n  ${lang}: {`);
    assert.notEqual(start, -1, `dictionary ${lang} not found`);
    const end = src.indexOf('\n  },', start);
    out[lang] = [...src.slice(start, end).matchAll(/^ {4}'([^']+)':/gm)].map((m) => m[1]);
  }
  return out;
})();

test('every language holds exactly the same keys', () => {
  const [first, ...rest] = LANGS;
  for (const lang of rest) {
    assert.deepEqual(dict[first].filter((k) => !dict[lang].includes(k)), [],
      `${lang} is missing keys`);
    assert.deepEqual(dict[lang].filter((k) => !dict[first].includes(k)), [],
      `${lang} has keys no other language has`);
  }
});

test('no key is declared twice in one language', () => {
  for (const lang of LANGS) {
    const seen = new Set();
    const twice = dict[lang].filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    assert.deepEqual(twice, [], `${lang} declares a key twice`);
  }
});

test('a phrase keeps its placeholders in every language', () => {
  const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of dict[LANGS[0]]) {
    setLang(LANGS[0]);
    const want = placeholders(t(key));
    for (const lang of LANGS.slice(1)) {
      setLang(lang);
      assert.deepEqual(placeholders(t(key)), want, `${lang}: ${key}`);
    }
  }
  setLang('ru');
});

test('an unknown language falls back instead of throwing', () => {
  setLang('fr');
  assert.equal(getLang(), 'ru');
  assert.equal(locale(), 'ru-RU');
  assert.equal(typeof t('tab.data'), 'string');
});

test('each language formats numbers by its own locale', () => {
  const seen = new Set();
  for (const lang of LANGS) {
    setLang(lang);
    seen.add(locale());
  }
  assert.equal(seen.size, LANGS.length, 'two languages share one locale');
  setLang('ru');
});

test('the exported file speaks Kazakh when asked', () => {
  const xml = buildKml({
    name: 'Тест',
    labelFormat: 'full',
    lang: 'kk',
    kvartaly: [],
    vydels: [{
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      kvartal: 29,
      vydel: 5,
    }],
  });
  assert.ok(xml.includes('<name>Бөліктер</name>'), 'the stand folder is not in Kazakh');
  assert.ok(xml.includes('<name>29-квартал 5-бөлік</name>'), 'the stand label is not in Kazakh');
});
