/**
 * Doppelte Übersetzungsschlüssel.
 *
 * In einem JavaScript-Objektliteral gewinnt bei einem doppelten Schlüssel
 * stillschweigend der SPÄTERE Eintrag. In public/i18n.js waren fünf Schlüssel
 * je Sprache doppelt vergeben (login.password, login.forgot, figs.stat.types,
 * partslist.reset, common.network_error) — mit teils UNTERSCHIEDLICHEN Texten:
 * 'Typen' gegen 'Figurtypen', 'Zurücksetzen' gegen '🗑️ Zurücksetzen'.
 *
 * Der Effekt: Wer den früheren Eintrag ändert, sieht keine Wirkung. Genau die
 * Sorte Beobachtung, die man sich als eigenen Fehler erklärt.
 *
 * Aufgefallen ist das erst, als scripts/build-frontend.js die Dateien für das
 * Bündel durch esbuild geschickt hat — der Minifizierer warnt davor.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = require('./helpers/sources').i18nAll();

/**
 * Liest die Schlüssel einer Sprachdatei aus der QUELLE.
 *
 * Bewusst textuell statt per require(): Ein geladenes Objekt hätte die
 * Duplikate schon aufgelöst — also genau die Information verloren, um die es
 * hier geht. Seit die Wörterbücher in public/locales/{de,en}.js liegen, ist je
 * Sprache eine eigene Datei zu lesen; die frühere Klammer-Zählerei über den
 * de:/en:-Block entfällt damit.
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
    const seen = new Set(), dupes = new Set();
    for (const k of keys) (seen.has(k) ? dupes : seen).add(k);
    assert.deepEqual([...dupes], [],
      `Doppelt vergeben — der spätere Eintrag überschreibt den früheren still: ${[...dupes].join(', ')}`);
    assert.ok(keys.length > 500, `Nur ${keys.length} Schlüssel gefunden — Blockerkennung kaputt?`);
  });
}

test('de und en haben denselben Schlüsselvorrat', () => {
  const de = new Set(keysOf('de')), en = new Set(keysOf('en'));
  const onlyDe = [...de].filter(k => !en.has(k));
  const onlyEn = [...en].filter(k => !de.has(k));
  assert.deepEqual(onlyDe, [], `Nur auf Deutsch vorhanden: ${onlyDe.join(', ')}`);
  assert.deepEqual(onlyEn, [], `Nur auf Englisch vorhanden: ${onlyEn.join(', ')}`);
});
