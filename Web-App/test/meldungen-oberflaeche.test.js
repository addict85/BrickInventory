/**
 * Meldungen (Toasts): Fehler bleiben länger stehen, ein Klick räumt weg — am
 * echten Bündel in jsdom.
 *
 *   - Eine Fehlermeldung steht nach allen Zeitgebern unter 8 s noch da und
 *     ist erst nach dem langen weg. Vorher verschwand jede Meldung ohne Knopf
 *     nach 4,5 s, auch ein Fehler, den man lesen will.
 *   - Ein Klick auf die Meldung entfernt sie sofort.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  TOAST_DAUER.error auf 4500 → rot: „Fehler bleibt länger stehen“
 *   B  der click-Handler am Toast entfernt → rot: „Klick räumt die Meldung weg“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

// Seit dem 29.10. zeigt eine Liste ihren Ladefehler selbst (fehlerZustand);
// eine Meldung kommt von einer Handlung — hier „Auf die Merkliste“.
const FEHLER = { '/v1/wanted': { success: false, error: 'Merkliste kaputt' } };
async function merkpostenAnlegen(w, d) {
  await reiter(w, 'wanted');
  d.getElementById('mk-num').value = '10294-1';
  d.getElementById('mk-add').click();
}

/** Zeitgeber ab jetzt mitschreiben, statt sie laufen zu lassen. */
function zeitgeberFangen(w) {
  const gefangen = [];
  const echt = w.setTimeout;
  w.setTimeout = (fn, ms, ...rest) => {
    if (typeof fn === 'function' && ms >= 3000) { gefangen.push({ fn, ms }); return 0; }
    return echt.call(w, fn, ms, ...rest);
  };
  return gefangen;
}

test('Fehler bleibt länger stehen', async () => {
  const { w, d } = await oeffneOberflaeche(FEHLER);
  try {
    const gefangen = zeitgeberFangen(w);
    await merkpostenAnlegen(w, d);
    await warte(() => d.querySelector('#toasts .toast.error'));
    const meldung = d.querySelector('#toasts .toast.error');
    assert.match(meldung.textContent, /Merkliste kaputt/);
    for (const z of gefangen.filter(z => z.ms < 8000)) z.fn();
    assert.ok(meldung.isConnected, `nach ${gefangen.filter(z => z.ms < 8000).map(z => z.ms).join(', ')} ms schon weg`);
    for (const z of gefangen.filter(z => z.ms >= 8000)) z.fn();
    assert.equal(meldung.isConnected, false, 'Die Meldung bleibt für immer stehen');
  } finally { w.close(); }
});

test('Klick räumt die Meldung weg', async () => {
  const { w, d } = await oeffneOberflaeche(FEHLER);
  try {
    await merkpostenAnlegen(w, d);
    await warte(() => d.querySelector('#toasts .toast.error'));
    const meldung = d.querySelector('#toasts .toast.error');
    meldung.querySelector('span:last-child').click();
    assert.equal(meldung.isConnected, false);
  } finally { w.close(); }
});
