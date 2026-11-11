/**
 * Adresse und Verlauf in Chrome: Jede Ansicht hat ihre Adresse, „Zurück“
 * führt zur vorigen Ansicht und schliesst offene Dialoge, ein Neuladen oder
 * ein Link öffnet die genannte Ansicht, Filter stehen als Query darin.
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  meldeAnsicht(tab) in bindTabs entfernt → rot: „Reiter schreiben die
 *      Adresse“ (bleibt „#/sammlung“) und die drei folgenden
 *   B  beiDialogWechsel(dialogGewechselt) in router.js entfernt → rot:
 *      „Zurück schliesst den Dialog“ (Dialog bleibt, Ansicht wechselt)
 *   C  routeBeimStart() in showApp entfernt → rot: alle vier (der Router
 *      startet nie; „Neuladen“ zeigt die Sammlung statt der Finanzen)
 *   D  meldeFilter() im Ereignis der Filterfelder entfernt → rot: „Filter in
 *      der Adresse“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterSammlung } = require('./helpers/bestand');

const ZUSTAND = `({ url: location.hash, ansicht: document.querySelector('.tab.active')?.id,
  dialoge: [...document.querySelectorAll('.ovl.open')].map(o => o.id) })`;

test('Adresse und Verlauf', { timeout: 180_000 }, async (t) => {
  const app = await starteApp(t, { name: `verlauf_${process.pid}`, bestand: musterSammlung });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis, ruhig } = app;
  // Der Start lädt Einstellungen und Preise nach; erst danach ist der Zustand fest.
  await ruhig();
  const zustand = () => b.auswerten(ZUSTAND);
  const zurueck = async () => { await b.auswerten('history.back(); true'); await warte(400); };

  await t.test('Reiter schreiben die Adresse', async () => {
    await b.auswerten(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    await b.auswerten(`document.querySelector('.ntab[data-tab="wanted"]').click(); true`);
    assert.equal((await zustand()).url, '#/merkliste');
    await zurueck();
    assert.deepEqual(await zustand(), { url: '#/finanzen', ansicht: 'tab-finance', dialoge: [] });
  });

  await t.test('Zurück schliesst den Dialog', async () => {
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await bis(`!!document.querySelector('#gallery [data-click="openModal"]')`, 'Kacheln');
    await b.auswerten(`document.querySelector('#gallery [data-click="openModal"]').click(); true`);
    await ruhig();
    const offen = await zustand();
    assert.deepEqual(offen.dialoge, ['set-modal']);
    assert.match(offen.url, /^#\/sammlung\/set\/\d+-\d+$/);
    await zurueck();
    assert.deepEqual(await zustand(), { url: '#/sammlung', ansicht: 'tab-gallery', dialoge: [] });
    // Mit dem Knopf geschlossen: Der Eintrag des Dialogs fällt weg, Zurück führt zur vorigen Ansicht.
    await b.auswerten(`history.forward(); true`); await warte(800);
    assert.deepEqual((await zustand()).dialoge, ['set-modal']);
    await b.auswerten(`document.querySelector('#set-modal [data-dialog-zu]').click(); true`); await warte(400);
    await zurueck();
    assert.equal((await zustand()).ansicht, 'tab-finance');
  });

  await t.test('Filter in der Adresse', async () => {
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await b.auswerten(`const f = document.getElementById('gs'); f.value = 'Tree'; f.dispatchEvent(new Event('input', { bubbles: true })); true`);
    assert.equal((await zustand()).url, '#/sammlung?suche=Tree');
  });

  await t.test('Neuladen öffnet die Ansicht der Adresse', async () => {
    await b.auswerten(`location.hash = '#/finanzen'; location.reload(); true`);
    await ruhig();
    await bis(`getComputedStyle(document.getElementById('app')).display !== 'none' && !!document.querySelector('.tab.active')`, 'App nach Neuladen', 300);
    await bis(`document.querySelector('.tab.active')?.id === 'tab-finance'`, 'Finanzen nach Neuladen');
    await b.auswerten(`location.hash = '#/sammlung?suche=Tree'; location.reload(); true`);
    await ruhig();
    await bis(`document.querySelector('.tab.active')?.id === 'tab-gallery' && document.getElementById('gs').value === 'Tree'`, 'Suche nach Neuladen');
  });
});
