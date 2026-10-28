/**
 * Teile- und Minifiguren-Reiter: Ein Leerzustand steht nur da, wenn BEIDE
 * Quellen leer sind, und Farbe/Kategorie stehen als Auswahlfelder in der
 * Filterleiste über den Listen. Geprüft am echten Bündel in jsdom mit
 * vorgegebenen Serverantworten (test/helpers/oberflaeche.js).
 *
 * Gegenproben (am 28.10. gemessen):
 *   A  in 03-parts.js den alten Leerzustand der Set-Teile wieder unbedingt
 *      gezeichnet → rot: „Teile: manuelle da, aus Sets leer" und „beide leer"
 *   B  in figurenLeerAbgleichen() (06-minifigs.js) die Ausnahme für vorhandene
 *      manuelle Figuren entfernt → rot: „Figuren: manuelle da, aus Sets leer"
 *   C  teilPasstZumFilter() immer wahr → rot: „Farbfilter … wirkt auf beide Listen"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte, takt } = require('./helpers/oberflaeche');

const ROT = { part_number: '3001', part_name: 'Brick 2 x 4', color_id: 4, color_name: 'Red', color_hex: 'C91A09', quantity: 2, conditions: ['U'], category_name: '11' };
const BLAU = { part_number: '3002', part_name: 'Brick 2 x 2', color_id: 1, color_name: 'Blue', color_hex: '0055BF', quantity: 1, conditions: ['N'], category_name: '11' };
const FIGUR = { fig_number: 'fig-000123', fig_name: 'Chewbacca', quantity: 1, conditions: ['N'] };
const SETTEIL = { part_number: '3020', part_name: 'Plate 2 x 4', color_name: 'Red', color_hex: 'C91A09', color_id: 4, total_quantity: 3 };

const text = el => (el?.textContent || '').replace(/\s+/g, ' ');
const sichtbar = el => !!el && el.style.display !== 'none';

async function teile(antworten) {
  const o = await oeffneOberflaeche(antworten);
  await reiter(o.w, 'parts');
  await warte(() => !o.d.querySelector('#parts-main .loading, #parts-main .lade'), 3000);
  await takt(150);
  return o;
}

test('Teile: manuelle da, aus Sets leer — kein Leerzustand', async () => {
  const { w, d } = await teile({ '/v1/parts/manual': { success: true, parts: [ROT] } });
  try {
    assert.equal(d.querySelectorAll('#manual-parts-list .man-tile').length, 1);
    assert.ok(sichtbar(d.getElementById('manual-parts-box')));
    assert.ok(!text(d.getElementById('tab-parts')).includes('Keine Teile gefunden'),
      'Unter einer Liste mit Einträgen steht „Keine Teile gefunden"');
  } finally { w.close(); }
});

test('Teile: beide leer — genau ein Leerzustand, der leere Kasten verschwindet', async () => {
  const { w, d } = await teile({});
  try {
    const leer = d.querySelectorAll('#tab-parts .leer');
    assert.equal(leer.length, 1, `${leer.length} Leerzustände`);
    assert.ok(text(leer[0]).includes('Keine Teile gefunden'));
    assert.ok(leer[0].querySelector('[data-click="oeffneErfassen"][data-arg="part"]'), 'Der Leerzustand bietet das Erfassen an');
    // Dasselbe Symbol wie der Reiter „Teile" — kein Puzzleteil.
    assert.equal(leer[0].querySelector('.leer-ico use')?.getAttribute('href'),
      d.querySelector('.sammlung-wahl [data-arg="parts"] use')?.getAttribute('href'));
    assert.equal(sichtbar(d.getElementById('manual-parts-box')), false);
  } finally { w.close(); }
});

test('Teile: nur aus Sets — kein leerer Kasten für manuelle', async () => {
  const { w, d } = await teile({ '/v1/parts': { success: true, parts: [SETTEIL], total: 1 } });
  try {
    assert.equal(d.querySelectorAll('#parts-main .part-card').length, 1);
    assert.equal(sichtbar(d.getElementById('manual-parts-box')), false);
    assert.equal(d.querySelectorAll('#tab-parts .leer').length, 0);
  } finally { w.close(); }
});

test('Farbfilter steht über den Listen und wirkt auf beide Listen', async () => {
  const { w, d, aufrufe } = await teile({ '/v1/parts/manual': { success: true, parts: [ROT, BLAU] } });
  try {
    const wahl = d.getElementById('parts-color');
    assert.ok(sichtbar(wahl), 'Das Farbfeld ist verborgen, obwohl es zwei Farben gibt');
    assert.ok(wahl.compareDocumentPosition(d.getElementById('manual-parts-box')) & w.Node.DOCUMENT_POSITION_FOLLOWING,
      'Der Farbfilter steht nicht über den Listen');
    // Der Wert bleibt englisch (so steht er in den Daten), die Beschriftung ist übersetzt.
    assert.deepEqual([...wahl.options].map(o => o.value), ['', 'Red', 'Blue']);
    assert.deepEqual([...wahl.options].map(o => o.textContent), ['Alle Farben', 'Rot', 'Blau']);
    wahl.value = 'Blue';
    wahl.dispatchEvent(new w.Event('change', { bubbles: true }));
    await takt(100);
    const namen = [...d.querySelectorAll('#manual-parts-list .man-tile-name')].map(text);
    assert.deepEqual(namen, ['Brick 2 x 2'], 'Farbfilter wirkt auf beide Listen');
    assert.ok(aufrufe.some(a => a.url.includes('/v1/parts?') && a.url.includes('color=Blue')),
      'Die Teile aus Sets werden nicht nach der Farbe gefragt');
  } finally { w.close(); }
});

async function figuren(antworten) {
  const o = await oeffneOberflaeche(antworten);
  await reiter(o.w, 'minifigs');
  await takt(300);
  return o;
}

test('Figuren: manuelle da, aus Sets leer — kein Leerzustand', async () => {
  const { w, d } = await figuren({ '/v1/minifigs/manual': { success: true, figs: [FIGUR] } });
  try {
    assert.equal(d.querySelectorAll('#manual-figs-list .man-tile').length, 1);
    assert.ok(!text(d.getElementById('tab-minifigs')).includes('Keine Minifiguren'),
      'Unter einer Liste mit Einträgen steht „Keine Minifiguren"');
  } finally { w.close(); }
});

test('Figuren: beide leer — genau ein Leerzustand', async () => {
  const { w, d } = await figuren({});
  try {
    const leer = d.querySelectorAll('#tab-minifigs .leer');
    assert.equal(leer.length, 1, `${leer.length} Leerzustände`);
    assert.ok(text(leer[0]).includes('Keine Minifiguren'));
    assert.equal(sichtbar(d.getElementById('manual-figs-box')), false);
  } finally { w.close(); }
});
