/**
 * Jede Klickfläche ist mit der Tastatur bedienbar (WCAG 2.1.1, Stufe A): Auf
 * allen Hauptseiten, in Karten- und Tabellenansicht und im Haushalt, hat jedes
 * sichtbare Element mit data-click, das kein Knopf, Link oder Feld ist,
 * tabindex="0" und eine Rolle (eine Tabellenzeile hat ihre eigene). Ausgenommen
 * sind nur aria-hidden-Abkürzungen in einer selbst bedienbaren Karte (der
 * Papierkorb der Kachel löscht, was ihr Dialog auch löscht) und stopEvent,
 * das nur den Klick der Zeile von ihren Knöpfen fernhält. Dazu der Befund
 * selbst: Die Figur aus einem Set wird mit Tab erreicht und öffnet mit Eingabe.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  Figurenkachel aus Sets wieder ohne tabindex und role (06-minifigs.js) →
 *      rot: „jede Klickfläche ist bedienbar“ (Minifiguren: DIV.part-card
 *      openSetItemDetail) und „Figur aus Set per Tastatur“
 *   B  Finanzzeile der Teile und Figuren wieder ohne tabindex (04-finance.js)
 *      → rot: „jede Klickfläche ist bedienbar“ (Finanzen: TR openManDetail)
 *   C  Tabellenzeile der Figuren wieder ohne tabindex → rot: „jede Klickfläche
 *      ist bedienbar“ (Minifiguren Tabelle: TR openSetItemDetail)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

const klick = (sel) => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
const reiter = (r) => klick(`.ntab[data-tab="${r}"]`);
const sicht = (s) => klick(`.umenu-item[data-arg="${s}"]`);
const ansicht = (id, wert) => klick(`[data-click="ansichtWaehlen"][data-arg="${id}"][data-arg2="${wert}"]`);

const SEITEN = [
  ['Sammlung', [reiter('gallery')]],
  ['Sammlung Tabelle', [reiter('gallery'), klick('#vl')]],
  ['Teile', [reiter('parts'), klick('#vg')]],
  ['Teile Tabelle', [reiter('parts'), ansicht('parts-view', 'table')]],
  ['Minifiguren', [reiter('minifigs'), ansicht('parts-view', 'grid')]],
  ['Minifiguren Tabelle', [reiter('minifigs'), ansicht('figs-view', 'table')]],
  ['Bauliste', [reiter('partslist'), ansicht('figs-view', 'grid')]],
  ['Finanzen', [reiter('finance')]],
  ['Merkliste', [reiter('wanted')]],
  ['Katalog', [reiter('catalog')]],
  ['Hintergrundarbeiten', [reiter('monitor')]],
  ['Einstellungen', [reiter('settings'), `document.querySelectorAll('#global-settings-grid > .ssec').forEach(a => a.classList.add('einst-aktiv')); true`]],
  ...['profil', 'gutscheine', 'alarme', 'lagerorte', 'haushalt', 'daten', 'app'].map(s => [`Sicht ${s}`, [sicht(s)]]),
  ['Set-Detail', [reiter('gallery'), klick('#gallery [data-click="openModal"]')]],
];

/** Klickflächen ohne Tastaturweg; eine Zeile je Art, damit die Meldung kurz bleibt. */
const UNBEDIENBAR = `(() => {
  const NATIV = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL', 'OPTION']);
  const bedienbar = (el) => NATIV.has(el.tagName) || (el.tabIndex >= 0 && el.hasAttribute('tabindex')
    && (el.tagName === 'TR' || !!el.getAttribute('role')));
  const funde = new Set();
  for (const el of document.querySelectorAll('[data-click]')) {
    if (!el.checkVisibility() || bedienbar(el) || el.dataset.click === 'stopEvent') continue;
    const huelle = el.parentElement?.closest('[data-click], button, a');
    if (el.getAttribute('aria-hidden') === 'true' && huelle && bedienbar(huelle)) continue;
    funde.add(el.tagName + '.' + [...el.classList].join('.') + ' ' + el.dataset.click);
  }
  return [...funde]; })()`;

test('Klickflächen mit der Tastatur', { timeout: 280_000 }, async (t) => {
  const app = await starteApp(t, { name: `kft_${process.pid}`, bestand: musterHaushalt });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis, ruhig } = app;
  // Der Start lädt Einstellungen und Preise nach; erst danach ist der Zustand fest.
  await ruhig();
  const ruhe = () => b.auswerten(`new Promise(r => setTimeout(() => requestAnimationFrame(() => r(true)), 700))`);

  await t.test('jede Klickfläche ist bedienbar', async () => {
    const funde = [];
    let geprueft = 0;
    for (const [seite, schritte] of SEITEN) {
      await b.auswerten(`document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); true`);
      for (const s of schritte) { await b.auswerten(s); await ruhe(); }
      geprueft += await b.auswerten(`[...document.querySelectorAll('[data-click]')].filter(e => e.checkVisibility()).length`);
      for (const f of await b.auswerten(UNBEDIENBAR)) funde.push(`${seite}: ${f}`);
    }
    assert.ok(geprueft > 200, `nur ${geprueft} Klickflächen gesehen — prüft der Test noch etwas?`);
    assert.deepEqual(funde, []);
  });

  await t.test('Figur aus Set per Tastatur', async () => {
    await b.auswerten(`document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); true`);
    await b.auswerten(reiter('minifigs'));
    for (const [wert, sel] of [['grid', '#figs-list .part-card[data-click="openSetItemDetail"]'], ['table', '#figs-list tr[data-click="openSetItemDetail"]']]) {
      await b.auswerten(ansicht('figs-view', wert));
      await bis(`!!document.querySelector(${JSON.stringify(sel)})`, `Figur aus Set (${wert})`);
      // Mit Tab hin, nicht mit focus(): Der Befund war, dass der Tab-Gang sie übersprang.
      await b.auswerten(`document.activeElement?.blur(); document.getElementById('fig-search').focus(); true`);
      let erreicht = false;
      for (let i = 0; i < 60 && !erreicht; i++) {
        await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        erreicht = await b.auswerten(`document.activeElement === document.querySelector(${JSON.stringify(sel)})`);
      }
      assert.ok(erreicht, `${wert}: Tab erreicht die Figur aus dem Set nicht`);
      await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await bis(`document.getElementById('setitem-modal')?.classList.contains('open')`, `${wert}: Eingabe öffnet den Dialog`);
      await bis(`/Marty McFly/.test(document.getElementById('setitem-modal').textContent)`, `${wert}: Dialog der Figur`);
      await b.auswerten(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
      await bis(`!document.getElementById('setitem-modal').classList.contains('open')`, 'Dialog zu');
    }
    await b.auswerten(ansicht('figs-view', 'grid'));
  });
});
