/**
 * Kacheln und Merklistenzeilen: Der Papierkorb ist eine Abkürzung für die
 * Maus und steht nicht in der Tab-Folge (gelöscht wird per Tastatur im
 * Detail-Dialog); eine Merkposten-Zeile ohne Namen nennt die Setnummer einmal
 * und lässt rechts Platz für den Papierkorb. Am echten Bündel in jsdom.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  tabindex="-1" am Papierkorb der Set-Kachel entfernt → rot: „Galerie:
 *      der Papierkorb steht nicht in der Tab-Folge“
 *   B  die Setnummer wieder immer in die Unterzeile → rot: „Merkliste: …
 *      Nummer einmal“ (2-mal)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const TABBAR = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]';
const tabbar = (wurzel) => [...wurzel.querySelectorAll(TABBAR)]
  .filter(el => el.getAttribute('tabindex') !== '-1');

test('Galerie: der Papierkorb steht nicht in der Tab-Folge', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/sets': { success: true, total: 2, themes: [], sets: [
      { set_number: '10294-1', name: 'Titanic', quantity: 1, year: 2021 },
      { set_number: '42143-1', name: 'Ferrari', quantity: 1, year: 2022 },
    ] },
  });
  try {
    await warte(() => d.querySelectorAll('#gallery .sc').length === 2);
    const galerie = d.getElementById('gallery');
    assert.equal(galerie.querySelectorAll('.delbtn').length, 2, 'die Kacheln tragen keinen Papierkorb');
    const imTab = tabbar(galerie);
    assert.deepEqual(imTab.filter(el => el.classList.contains('delbtn')).length, 0,
      'ein Papierkorb steht in der Tab-Folge');
    assert.equal(imTab.length, 2, 'je Kachel genau ein Halt');
    for (const b of galerie.querySelectorAll('.delbtn'))
      assert.equal(b.getAttribute('aria-hidden'), 'true', 'der Papierkorb steckt als zweite Schaltfläche in der Kachel');
  } finally { w.close(); }
});

test('Merkliste: ohne Namen steht die Nummer einmal, rechts bleibt Platz', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/wanted': { success: true, merkposten: [
      { set_number: '99999-1', name: null, condition: 'N', user_id: 1, marktpreis: 12.5, waehrung: 'EUR' },
    ] },
  });
  try {
    await reiter(w, 'wanted');
    await warte(() => d.querySelector('.mk-zeile'));
    const zeile = d.querySelector('.mk-zeile');
    const n = (zeile.textContent.match(/99999-1/g) || []).length;
    assert.equal(n, 1, `Merkliste: Nummer einmal — steht ${n}-mal da`);
    assert.equal(zeile.style.paddingRight, '44px', 'rechts kein Platz für den Papierkorb');
    assert.equal(tabbar(zeile).filter(el => el !== zeile).length, 0, 'der Papierkorb steht in der Tab-Folge');
  } finally { w.close(); }
});
