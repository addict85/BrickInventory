/**
 * Anführungszeichen in der Oberfläche: deutsch „…“, englisch “…”. Vorher stand
 * „Keine Sets gefunden für „xyzxyz"“ — unten öffnend, oben ein gerades Zeichen.
 *
 * Geprüft wird die gezeigte Meldung im echten Bündel (jsdom) und jeder Text
 * der beiden Wörterbücher, wie das Bündel sie lädt.
 *
 * Gegenproben (am 28.10. gemessen):
 *   A  gallery.no_results in de.js wieder mit "  → rot: „Suche ohne Treffer: de“
 *      und „jedes „ hat sein ““
 *   B  en.js wieder "{query}" → rot: „Suche ohne Treffer: en“ und „keine geraden …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt } = require('./helpers/oberflaeche');

async function suche(sprache) {
  const o = await oeffneOberflaeche({}, { sprache });
  const feld = o.d.getElementById('gs');
  feld.value = 'xyzxyz';
  feld.dispatchEvent(new o.w.Event('input', { bubbles: true }));
  await warte(() => /xyzxyz/.test(o.d.getElementById('gallery').textContent), 3000);
  await takt(20);
  const text = o.d.querySelector('#gallery .leer h3')?.textContent || o.d.getElementById('gallery').textContent;
  return { o, text: text.trim() };
}

test('Suche ohne Treffer: de', async () => {
  const { o, text } = await suche('de');
  try { assert.equal(text, 'Keine Sets gefunden für „xyzxyz“'); } finally { o.w.close(); }
});

test('Suche ohne Treffer: en', async () => {
  const { o, text } = await suche('en');
  try { assert.equal(text, 'No sets found for “xyzxyz”'); } finally { o.w.close(); }
});

test('jedes „ hat sein “, und englisch keine geraden Anführungszeichen um Wörter', async () => {
  const { w } = await oeffneOberflaeche({}, { angemeldet: false });
  try {
    const de = Object.entries(w.I18N_DE), en = Object.entries(w.I18N_EN);
    assert.ok(de.length > 500 && en.length > 500, 'Wörterbücher nicht geladen');
    const deFalsch = de.filter(([, v]) => (v.match(/„/g) || []).length !== (v.match(/“/g) || []).length || /„[^“]*"/.test(v));
    assert.deepEqual(deFalsch.map(([k]) => k), [], 'de: „ ohne passendes “');
    const enFalsch = en.filter(([, v]) => /"[^"<>=]*"/.test(v) && !/<|=/.test(v) || /„/.test(v));
    assert.deepEqual(enFalsch.map(([k]) => k), [], 'en: gerade oder deutsche Anführungszeichen');
  } finally { w.close(); }
});
