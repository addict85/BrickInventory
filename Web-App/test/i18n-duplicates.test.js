/**
 * Duplicate translation keys.
 *
 * Counter-check: 'login.submit' a second time in public/locales/de.js → red “no duplicate keys in i18n (de)”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Reads the keys of a language file from the SOURCE.
 */
function keysOf(lang) {
  const src = require('./helpers/sources').localeSource(lang);
  const keys = [...src.matchAll(/^\s*'([^']+)':/gm)].map(m => m[1]);
  assert.ok(keys.length > 100, `Language file ${lang}: only ${keys.length} keys found`);
  return keys;
}

for (const lang of ['de', 'en']) {
  test(`no duplicate keys in i18n (${lang})`, () => {
    const keys = keysOf(lang);
    const seen = new Set(),
      dupes = new Set();
    for (const k of keys) (seen.has(k) ? dupes : seen).add(k);
    assert.deepEqual(
      [...dupes],
      [],
      `Assigned twice — the later entry silently overwrites the earlier one: ${[...dupes].join(', ')}`,
    );
    assert.ok(keys.length > 500, `Only ${keys.length} keys found — block detection broken?`);
  });
}

test('de and en have the same key stock', () => {
  const de = new Set(keysOf('de')),
    en = new Set(keysOf('en'));
  const onlyDe = [...de].filter(k => !en.has(k));
  const onlyEn = [...en].filter(k => !de.has(k));
  assert.deepEqual(onlyDe, [], `Only present in German: ${onlyDe.join(', ')}`);
  assert.deepEqual(onlyEn, [], `Only present in English: ${onlyEn.join(', ')}`);
});
