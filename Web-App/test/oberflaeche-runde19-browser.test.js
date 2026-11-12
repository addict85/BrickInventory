/**
 * UX-Prüfung 19 im echten Chrome, im Haushalt (musterHaushalt).
 *   - Set-Detail (H1, H2, M1, M2): beide Konten in der Kopfzeile, Regler je
 *     Konto; „−“ beim Kind nimmt dessen Kauf, Toast mit Rückgängig, am Feld
 *     „Gespeichert ✓“, Diagramm danach mit 199,99 € statt 205 €.
 *
 * Gegenproben (12.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in mengenBlock() `if (!imHaushalt(set))` zu `if (true)` → rot:
 *      „Set-Detail im Haushalt“ (keine Zeile je Konto)
 *   B  in untertitel() wieder nur die fremden Konten → rot: ebenda
 *      („Konto: …_kind“ statt „Konten: ich, …_kind“)
 *   C  in frischeDetailAuf() ladeSetNachtraege(sn) entfernt → rot: ebenda
 *      (Diagramm nennt weiter 205,00 €)
 *   D  in mengeJeKonto() owner_user_id weggelassen → rot: ebenda (das eigene
 *      Exemplar fällt weg, das Kind behält seins)
 *   E  meldeAmFeld() in frischeDetailAuf() entfernt → rot: ebenda (kein
 *      „Gespeichert ✓“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

const SCHLIESSEN = `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); return true; })()`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;

async function setDetailImHaushalt(_t, a) {
  const { b, bis, ruhig } = a;
  const kind = `r19_${process.pid}_kind`;
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click();
    document.querySelector('#gallery [data-click="openModal"][data-arg="21318-1"]').click(); true`);
  await bis(`document.querySelectorAll('#m-menge .menge-konto').length === 2`, 'Regler je Konto');
  await bis(`/205,00/.test(${text('#m-sparkline-content')})`, 'Diagramm mit dem Mischpreis');
  assert.equal(await b.auswerten(text('#m-untertit')), `21318-1 · Konten: ich, ${kind}`);
  const zeilen = `[...document.querySelectorAll('#m-menge .menge-konto')].map(z => z.querySelector('.menge-name').textContent + ' ' + z.querySelector('.menge-zahl').textContent)`;
  assert.deepEqual(await b.auswerten(zeilen), ['ich 1', `${kind} 1`]);

  await b.auswerten(`document.querySelector('#m-menge .menge-konto:nth-child(2) [data-arg2="-1"]').click(); true`);
  await bis(`/Kauf vom 02\\.06\\.2026/.test(document.getElementById('toasts').textContent)`, 'Toast nennt den Kauf');
  await ruhig();
  assert.match(
    await b.auswerten(text('#toasts')),
    new RegExp(`Kauf vom 02\\.06\\.2026 \\(210,00 €\\) entfernt · ${kind}`),
  );
  assert.ok(await b.auswerten(`!!document.querySelector('#toasts .toast-aktion')`), 'kein Rückgängig');
  // Ohne das Kind gehört das Set nur noch dem Konto: wieder das eine Feld, die Kopfzeile ohne Konten.
  assert.deepEqual(await b.auswerten(zeilen), []);
  assert.equal(await b.auswerten(`document.getElementById('m-qty')?.value`), '1');
  assert.equal(await b.auswerten(text('#m-untertit')), '21318-1');
  assert.equal(await b.auswerten(text('#m-menge .feld-status')), 'Gespeichert ✓');
  assert.equal(await b.auswerten(`document.querySelector('#m-menge .feld-status').getAttribute('role')`), 'status');
  await bis(`/199,99/.test(${text('#m-sparkline-content')})`, 'Diagramm mit dem verbliebenen Kaufpreis', 50);

  await b.auswerten(`[...document.querySelectorAll('#toasts .toast-aktion')].at(-1).click(); true`);
  await bis(
    `JSON.stringify(${zeilen}) === ${JSON.stringify(JSON.stringify(['ich 1', `${kind} 1`]))}`,
    'Rückgängig bringt den Kauf zurück',
  );
  await bis(`/205,00/.test(${text('#m-sparkline-content')})`, 'Diagramm wieder mit dem Mischpreis', 50);
}

test('UX-Prüfung 19 im Browser', { concurrency: 1, timeout: 300_000 }, async t => {
  const a = await starteApp(t, { name: `r19_${process.pid}`, bestand: musterHaushalt });
  if (a.grund) {
    t.skip(a.grund);
    return;
  }
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object) => Promise<void>][]} */
  const pruefungen = [['Set-Detail im Haushalt', setDetailImHaushalt]];
  for (const [name, fn] of pruefungen) {
    await a.b.auswerten(SCHLIESSEN);
    await t.test(name, () => fn(t, a));
  }
});
