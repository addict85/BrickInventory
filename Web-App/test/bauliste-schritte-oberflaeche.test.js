/**
 * Bauliste: „Teileliste erstellen“ ist der Hauptknopf, „Zurücksetzen“ nicht
 * rot; das Set-Feld hat eine sichtbare Beschriftung, die Zustandswahl auch.
 * Exportieren erscheint erst mit einem Ergebnis und ist bei 0 Teilen gesperrt;
 * das leere Ergebnis nennt den Grund. Echtes Bündel in jsdom.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  plExportStand() sperrt nie (disabled = false) → rot: „leeres Ergebnis“
 *      (PDF bei 0 Teilen auslösbar)
 *   B  plRenderTable() wieder mit „Keine Teile gefunden“ → rot: „leeres
 *      Ergebnis“ (kein Grund genannt)
 *   C  Zurücksetzen wieder class="btn bd" → rot: „Aufbau“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const TEIL = { part_number: '3001', part_name: 'Brick 2 x 4', color_id: 4, color_name: 'Red', color_hex: 'C91A09', quantity: 6 };

async function erstelle(teile) {
  const o = await oeffneOberflaeche({
    '/v1/sets/10294-1/parts-list': { success: true, parts: teile },
    '/v1/sets/10294-1/minifigs-list': { success: true, figs: [] },
    '/v1/sets/info/10294-1': { success: true, name: 'Titanic' },
    '/v1/parts/bl-color-map': { success: true, map: { 4: 5 } },
  });
  await reiter(o.w, 'partslist');
  o.d.getElementById('pl-setnr').value = '10294';
  o.d.querySelector('[data-click="plAddSet"]').click();
  o.d.getElementById('btn-pl-gen').click();
  await warte(() => !o.d.getElementById('pl-export').hidden, 3000);
  return o;
}

test('Aufbau: Hauptknopf, Beschriftungen, Zurücksetzen nicht rot', async () => {
  const { w, d } = await oeffneOberflaeche();
  try {
    assert.equal(text(d.querySelector('label[for="pl-setnr"]')), 'Set-Nummern (mehrere mit Komma trennen)');
    assert.equal(text(d.querySelector('label[for="pl-bl-condition"]')), 'Zustand für BrickLink');
    assert.ok(d.getElementById('btn-pl-gen').classList.contains('bp'), 'Erstellen ist der Hauptknopf');
    assert.equal(text(d.getElementById('btn-pl-gen')), 'Teileliste erstellen');
    assert.equal(d.getElementById('btn-pl-reset').classList.contains('bd'), false, 'Zurücksetzen ist rot');
    assert.equal(d.getElementById('pl-export').hidden, true, 'Exportieren vor dem ersten Ergebnis');
  } finally { w.close(); }
});

test('leeres Ergebnis: Grund und gesperrte Exporte', async () => {
  const { w, d } = await erstelle([]);
  try {
    assert.equal(d.getElementById('btn-pl-pdf').disabled, true, 'PDF bei 0 Teilen');
    assert.equal(d.getElementById('btn-pl-bl').disabled, true, 'BrickLink bei 0 Teilen');
    assert.match(text(d.getElementById('pl-result')), /noch keine Teileliste vor.*Rebrickable/);
    assert.equal(text(d.getElementById('pl-status')), '0 Teile aus 1 Set');
  } finally { w.close(); }
});

test('Ergebnis mit Teilen: Exporte frei, Eingabefelder beschriftet', async () => {
  const { w, d } = await erstelle([TEIL]);
  try {
    assert.equal(d.getElementById('btn-pl-pdf').disabled, false);
    assert.equal(text(d.getElementById('pl-status')), '1 Teil aus 1 Set');
    assert.equal(d.querySelector('.pl-have-input').getAttribute('aria-label'), 'Vorhanden: 3001 Red');
  } finally { w.close(); }
});
