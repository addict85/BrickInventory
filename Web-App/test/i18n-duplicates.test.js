/**
 * Doppelte Übersetzungsschlüssel.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Liest die Schlüssel einer Sprachdatei aus der QUELLE.
 */
function keysOf(lang) {
  const src = require('./helpers/sources').localeSource(lang);
  const keys = [...src.matchAll(/^\s*'([^']+)':/gm)].map(m => m[1]);
  assert.ok(keys.length > 100, `Sprachdatei ${lang}: nur ${keys.length} Schlüssel gefunden`);
  return keys;
}

for (const lang of ['de', 'en']) {
  test(`keine doppelten Schlüssel in i18n (${lang})`, () => {
    const keys = keysOf(lang);
    const seen = new Set(),
      dupes = new Set();
    for (const k of keys) (seen.has(k) ? dupes : seen).add(k);
    assert.deepEqual(
      [...dupes],
      [],
      `Doppelt vergeben — der spätere Eintrag überschreibt den früheren still: ${[...dupes].join(', ')}`,
    );
    assert.ok(keys.length > 500, `Nur ${keys.length} Schlüssel gefunden — Blockerkennung kaputt?`);
  });
}

test('de und en haben denselben Schlüsselvorrat', () => {
  const de = new Set(keysOf('de')),
    en = new Set(keysOf('en'));
  const onlyDe = [...de].filter(k => !en.has(k));
  const onlyEn = [...en].filter(k => !de.has(k));
  assert.deepEqual(onlyDe, [], `Nur auf Deutsch vorhanden: ${onlyDe.join(', ')}`);
  assert.deepEqual(onlyEn, [], `Nur auf Englisch vorhanden: ${onlyEn.join(', ')}`);
});
