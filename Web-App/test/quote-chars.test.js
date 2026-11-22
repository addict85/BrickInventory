/**
 * Quotation marks in the UI: German „…“, English “…”, never opening at the bottom
 * and closing with a straight character at the top.
 *
 * What is checked is the shown message in the real bundle (jsdom) and every text
 * of the two dictionaries, as the bundle loads them.
 *
 * Counter-checks (measured on 28.10.):
 *   A  common.no_hits in de.js again with "  → red: “search without results: de”
 *      and “every „ has its “”
 *   B  en.js again "{query}" → red: “search without results: en” and “… no straight …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt } = require('./helpers/ui');

async function suche(sprache) {
  const o = await openUi({}, { sprache });
  const feld = o.d.getElementById('gs');
  feld.value = 'xyzxyz';
  feld.dispatchEvent(new o.w.Event('input', { bubbles: true }));
  await warte(() => /xyzxyz/.test(o.d.getElementById('gallery').textContent), 3000);
  await takt(20);
  const text = o.d.querySelector('#gallery .empty-state h2')?.textContent || o.d.getElementById('gallery').textContent;
  return { o, text: text.trim() };
}

test('search without results: de', async () => {
  const { o, text } = await suche('de');
  try {
    assert.equal(text, 'Keine Treffer für „xyzxyz“');
  } finally {
    o.w.close();
  }
});

test('search without results: en', async () => {
  const { o, text } = await suche('en');
  try {
    assert.equal(text, 'No results for “xyzxyz”');
  } finally {
    o.w.close();
  }
});

test('every „ has its “, and English has no straight quotes around words', async () => {
  const { w } = await openUi({}, { angemeldet: false });
  try {
    const de = Object.entries(w.I18N_DE),
      en = Object.entries(w.I18N_EN);
    assert.ok(de.length > 500 && en.length > 500, 'Wörterbücher nicht geladen');
    const deWrong = de.filter(
      ([, v]) => (v.match(/„/g) || []).length !== (v.match(/“/g) || []).length || /„[^“]*"/.test(v),
    );
    assert.deepEqual(
      deWrong.map(([k]) => k),
      [],
      'de: „ ohne passendes “',
    );
    const enWrong = en.filter(([, v]) => (/"[^"<>=]*"/.test(v) && !/<|=/.test(v)) || /„/.test(v));
    assert.deepEqual(
      enWrong.map(([k]) => k),
      [],
      'en: gerade oder deutsche Anführungszeichen',
    );
  } finally {
    w.close();
  }
});
