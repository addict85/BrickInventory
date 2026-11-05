/**
 * Meldungen (Toasts), am echten Bündel in jsdom:
 *
 *   - Ein Fehler und eine Meldung mit Knopf („Rückgängig“) laufen nicht ab
 *     (Barrierefreiheit 17, M4: WCAG 2.2.1); sie schliessen über ihr ✕.
 *   - Eine Meldung ohne Knopf hält ihre Frist an, solange Maus oder Fokus
 *     darauf liegt.
 *   - Ein Klick auf die Meldung entfernt sie sofort.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  (05.11.2026 neu gemessen) `bleibt` in toast() immer false → rot:
 *      „Fehler und Knopf-Meldungen laufen nicht ab“
 *   B  der click-Handler am Toast entfernt → rot: „Klick räumt die Meldung weg“
 *   C  (30.10.) die Suche nach der gleichen Meldung in toast() entfernt → rot:
 *      „gleiche Fehler stapeln sich nicht“ (3 Meldungen statt 1)
 *   D  (05.11.2026) der mouseenter-Halt entfernt → rot: „Maus auf der Meldung
 *      hält die Frist an“
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

test('Fehler und Knopf-Meldungen laufen nicht ab', async () => {
  const { w, d } = await oeffneOberflaeche(FEHLER);
  try {
    const gefangen = zeitgeberFangen(w);
    await merkpostenAnlegen(w, d);
    await warte(() => d.querySelector('#toasts .toast.error'));
    const meldung = d.querySelector('#toasts .toast.error');
    assert.match(meldung.textContent, /Merkliste kaputt/);
    for (const z of gefangen) z.fn();
    assert.ok(meldung.isConnected, 'der Fehler lief nach seiner Frist ab');
    const zu = meldung.querySelector('.toast-zu');
    assert.equal(zu.getAttribute('aria-label'), 'Schliessen');
    zu.click();
    assert.equal(meldung.isConnected, false, 'das ✕ schliesst');
  } finally { w.close(); }
});

test('Maus auf der Meldung hält die Frist an', async () => {
  const { w, d } = await oeffneOberflaeche({ '/v1/wanted': (_u, o) => (o.method === 'POST'
    ? { success: true, war_neu: true } : { success: true, items: [] }) });
  try {
    // Wie zeitgeberFangen, aber clearTimeout nimmt einen gefangenen Zeitgeber wieder heraus.
    const offen = new Map(); let n = 1e6;
    const setzen = w.setTimeout, loeschen = w.clearTimeout;
    w.setTimeout = (fn, ms, ...rest) => (typeof fn === 'function' && ms >= 3000 ? (offen.set(++n, fn), n) : setzen.call(w, fn, ms, ...rest));
    w.clearTimeout = (id) => (offen.has(id) ? offen.delete(id) : loeschen.call(w, id));
    await merkpostenAnlegen(w, d);
    await warte(() => d.querySelector('#toasts .toast.success'));
    const meldung = d.querySelector('#toasts .toast.success');
    meldung.dispatchEvent(new w.MouseEvent('mouseenter'));
    for (const fn of [...offen.values()]) fn();
    assert.ok(meldung.isConnected, 'die Frist lief unter der Maus ab');
    meldung.dispatchEvent(new w.MouseEvent('mouseleave'));
    for (const fn of [...offen.values()]) fn();
    assert.equal(meldung.isConnected, false, 'nach dem Verlassen läuft die Frist wieder');
  } finally { w.close(); }
});

test('gleiche Fehler stapeln sich nicht', async () => {
  const { w, d } = await oeffneOberflaeche(FEHLER);
  try {
    for (let i = 0; i < 3; i++) { await merkpostenAnlegen(w, d); await warte(() => d.querySelectorAll('#toasts .toast.error').length > 0); }
    await warte(() => d.querySelector('#toasts .toast-anzahl:not([hidden])')?.textContent === '×3', 1000);
    const meldungen = d.querySelectorAll('#toasts .toast.error');
    assert.equal(meldungen.length, 1, `${meldungen.length} Meldungen`);
    assert.equal(meldungen[0].querySelector('.toast-anzahl').textContent, '×3');
  } finally { w.close(); }
});

test('Klick räumt die Meldung weg', async () => {
  const { w, d } = await oeffneOberflaeche(FEHLER);
  try {
    await merkpostenAnlegen(w, d);
    await warte(() => d.querySelector('#toasts .toast.error'));
    const meldung = d.querySelector('#toasts .toast.error');
    meldung.querySelector('.toast-text').click();
    assert.equal(meldung.isConnected, false);
  } finally { w.close(); }
});
