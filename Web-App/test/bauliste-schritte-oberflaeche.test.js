/**
 * Bauliste im echten Bündel (jsdom): Hauptknopf ist der nächste Schritt, gesperrt
 * mit sichtbarem Grund; „Zurücksetzen“ nicht rot; Feld und Zustandswahl beschriftet.
 * Export und Optionen erst mit Teilen; das leere Ergebnis nennt den Grund, eine
 * Nummer, die der Katalog nicht kennt, steht als solche da und zählt nicht als Set.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  plExportStand() mit box.hidden = _plParts === null (der alte Stand) →
 *      rot: „leeres Ergebnis“ (Export bei 0 Teilen sichtbar)
 *   D  in plAddSet das Setzen von eintrag.unbekannt entfernt → rot:
 *      „unbekannte Nummer“ (Chip ohne Hinweis, „aus 2 Sets“)
 *   B  plRenderTable() wieder mit „Keine Teile gefunden“ → rot: „leeres
 *      Ergebnis“ (kein Grund genannt)
 *   C  Zurücksetzen wieder class="btn bd" → rot: „Aufbau“
 *   E  (05.11.2026, UI-Prüfung 17 M14) Farbgruppe wieder ohne colorName() →
 *      rot: „Farbgruppen deutsch, Zusammenfassung nennt Sorten“ („Red“)
 *   F  (12.11.2026) plSchritt() in plRenderSets nicht gerufen → rot: „ein
 *      Hauptknopf …“; in plGenerate die getippte Nummer nicht übernommen →
 *      rot: ebenda (Fehler am Feld statt Liste)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const TEIL = {
  part_number: '3001',
  part_name: 'Brick 2 x 4',
  color_id: 4,
  color_name: 'Red',
  color_hex: 'C91A09',
  quantity: 6,
};

async function erstelle(teile, nummern = '10294') {
  const o = await oeffneOberflaeche({
    '/v1/sets/10294-1/parts-list': { success: true, parts: teile },
    '/v1/sets/10294-1/minifigs-list': { success: true, figs: [] },
    '/v1/sets/info/10294-1': { success: true, name: 'Titanic', im_katalog: true },
    '/v1/sets/info/99999-1': { success: true, name: '99999-1', im_katalog: false },
    '/v1/sets/99999-1/parts-list': { success: true, parts: [] },
    '/v1/sets/99999-1/minifigs-list': { success: true, figs: [] },
    '/v1/parts/bl-color-map': { success: true, map: { 4: 5 } },
  });
  await reiter(o.w, 'partslist');
  o.d.getElementById('pl-setnr').value = nummern;
  o.d.querySelector('[data-click="plAddSet"]').click();
  await warte(() => o.d.querySelector('#pl-sets .pl-chip-name')?.textContent.trim(), 3000);
  o.d.getElementById('btn-pl-gen').click();
  assert.ok(
    await warte(() => / aus \d+ Set/.test(o.d.getElementById('pl-status').textContent), 3000),
    'Liste erstellt',
  );
  return o;
}

test('Aufbau: Beschriftungen, Zurücksetzen nicht rot', async () => {
  const { w, d } = await oeffneOberflaeche();
  try {
    assert.equal(text(d.querySelector('label[for="pl-setnr"]')), 'Setnummern (mehrere mit Komma trennen)');
    assert.equal(text(d.querySelector('label[for="pl-bl-condition"]')), 'Zustand für BrickLink');
    assert.equal(text(d.getElementById('btn-pl-gen')), 'Bauliste erstellen');
    assert.equal(d.getElementById('btn-pl-reset').classList.contains('bd'), false, 'Zurücksetzen ist rot');
    assert.equal(d.getElementById('pl-export').hidden, true, 'Exportieren vor dem ersten Ergebnis');
  } finally {
    w.close();
  }
});

test('ein Hauptknopf: erst Hinzufügen, dann Erstellen; gesperrt mit sichtbarem Grund', async () => {
  const o = await oeffneOberflaeche({
    '/v1/sets/info/10294-1': { success: true, name: 'Titanic', im_katalog: true },
    '/v1/sets/10294-1/parts-list': { success: true, parts: [TEIL] },
    '/v1/sets/10294-1/minifigs-list': { success: true, figs: [] },
    '/v1/parts/bl-color-map': { success: true, map: { 4: 5 } },
  });
  const { w, d } = o;
  try {
    await reiter(w, 'partslist');
    const haupt = () => [...d.querySelectorAll('#tab-partslist .btn.bp')].map(text);
    const gen = d.getElementById('btn-pl-gen'),
      hinweis = d.getElementById('pl-gen-hinweis');
    assert.deepEqual(haupt(), ['Hinzufügen'], 'ohne Sets');
    assert.equal(gen.getAttribute('aria-disabled'), 'true');
    assert.equal(hinweis.hidden, false, 'der Grund steht nicht da');
    assert.match(text(hinweis), /Setnummer eintragen/);
    assert.ok(gen.getAttribute('aria-describedby').split(' ').includes('pl-gen-hinweis'));
    assert.equal(d.querySelector('#pl-sets button'), null, 'der Leerzustand hat einen eigenen Knopf');

    // Getippt, aber nicht hinzugefügt: „Erstellen“ nimmt die Nummer mit.
    d.getElementById('pl-setnr').value = '10294';
    gen.click();
    assert.ok(await warte(() => / aus 1 Set/.test(d.getElementById('pl-status').textContent), 3000), 'keine Liste');
    assert.deepEqual(haupt(), ['Bauliste erstellen'], 'mit Set');
    assert.equal(gen.hasAttribute('aria-disabled'), false);
    assert.equal(hinweis.hidden, true);
    assert.equal((gen.getAttribute('aria-describedby') || '').includes('pl-gen-hinweis'), false);
  } finally {
    w.close();
  }
});

test('leeres Ergebnis: Grund, keine Exporte', async () => {
  const { w, d } = await erstelle([]);
  try {
    assert.equal(d.getElementById('pl-optionen').hidden, true, 'Export und Optionen bei 0 Teilen');
    assert.equal(d.getElementById('btn-pl-pdf').disabled, true, 'PDF bei 0 Teilen');
    assert.match(text(d.getElementById('pl-result')), /noch keine Teileliste vor.*Rebrickable/);
    assert.equal(text(d.getElementById('pl-status')), '0 Sorten (0 Teile) aus 1 Set');
  } finally {
    w.close();
  }
});

test('unbekannte Nummer: im Chip genannt, nicht mitgezählt', async () => {
  const { w, d } = await erstelle([TEIL], '10294, 99999-1');
  try {
    const chips = [...d.querySelectorAll('#pl-sets .pl-chip')].map(c => ({
      text: text(c),
      unbekannt: c.classList.contains('unbekannt'),
    }));
    assert.deepEqual(chips, [
      { text: '10294-1 — Titanic', unbekannt: false },
      { text: '99999-1 — nicht im Katalog', unbekannt: true },
    ]);
    assert.equal(
      text(d.getElementById('pl-status')),
      '1 Sorte (6 Teile) aus 1 Set · 1 Nummer nicht im Katalog: 99999-1',
    );
  } finally {
    w.close();
  }
});

test('Ergebnis mit Teilen: Exporte frei, Eingabefelder beschriftet', async () => {
  const { w, d } = await erstelle([TEIL]);
  try {
    assert.equal(d.getElementById('pl-optionen').hidden, false);
    assert.equal(d.getElementById('btn-pl-pdf').disabled, false);
    assert.equal(text(d.getElementById('pl-status')), '1 Sorte (6 Teile) aus 1 Set');
    assert.equal(d.querySelector('.pl-have-input').getAttribute('aria-label'), 'Vorhanden: 3001 Red');
  } finally {
    w.close();
  }
});

test('Farbgruppen deutsch, Zusammenfassung nennt Sorten', async () => {
  const { w, d } = await erstelle([TEIL, { ...TEIL, part_number: '3003', part_name: 'Brick 2 x 2', quantity: 10 }]);
  try {
    assert.match(text(d.getElementById('pl-result')), /^Rot \(2 Sorten\)/, 'Farbgruppe in der Sprache der Oberfläche');
    assert.doesNotMatch(text(d.getElementById('pl-result')), /\bRed\b/);
    assert.equal(text(d.getElementById('pl-status')), '2 Sorten (16 Teile) aus 1 Set');
  } finally {
    w.close();
  }
});
