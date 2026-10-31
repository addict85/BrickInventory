/**
 * Zahlen, Achsen und Zwischenzustände — am echten Bündel in jsdom.
 *
 *   - Die Kopfleiste zeigt 1300 Teile als „1’300“ (de-CH), nicht „1.3k“.
 *   - Das Wertdiagramm teilt die Werte nach 1-2-5, legt die Punkte auf eine
 *     Zeitachse (ein Monat ist breiter als ein Tag) und beschriftet sie
 *     einheitlich mit Monatsnamen — ohne „29.10“ neben „12/25“.
 *   - Solange Finanzen laden, stehen in den Kacheln Platzhalter (aria-busy)
 *     statt „—“.
 *   - Solange die Teile laden, steht die leere Box „Manuell erfasste Teile“
 *     nicht da.
 *   - Ohne E-Mail-Adresse steht im Konto nicht „verifiziert“.
 *   - Der Hinweis „Rebrickable-API-Schlüssel“ erscheint nicht über dem
 *     Einrichtungsassistenten, der genau ihn abfragt.
 *   - Das Konto wählt ein eigenes Design oder die Vorgabe des Verwalters.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  fmtBig wieder mit „k“ → rot: „Kennzahlen ohne k“ („1.3k“)
 *   B  in portfolioChartSVG wieder px(i) nach Index → rot: „Zeitachse“
 *      (Abstand Tag gleich Abstand Monat); schoeneTeilung durch fünf gleiche
 *      Teile ersetzt → rot: „1-2-5“ (4'219 …)
 *   C  WERT_SKELETT in loadFinance nicht gesetzt → rot: „Platzhalter beim
 *      Laden“ („—“)
 *   D  teileLeerAbgleichen wieder mit `_manuelleLeer ? 'none' : ''` → rot:
 *      „keine leere Box“
 *   E  die Prüfung `!u.email` in loadProfile entfernt → rot: „ohne E-Mail“
 *   F  die Prüfung auf den offenen Assistenten in checkRbKey entfernt → rot:
 *      „kein Hinweis über dem Assistenten“
 *   G  in setzeEigenesDesign applyTheme() entfernt → rot: „eigenes Design“
 *      (data-theme blieb classic)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, sicht, warte, takt } = require('./helpers/oberflaeche');

test('Kennzahlen ohne k: 1300 Teile stehen als volle Zahl da', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/stats': { success: true, stats: { total_sets: 14, total_parts: 1300, total_minifigs: 19, total_instructions: 0 } } });
  try {
    await warte(() => d.getElementById('bstat-parts').textContent !== '—');
    const text = d.getElementById('bstat-parts').textContent;
    assert.doesNotMatch(text, /k$/i);
    assert.match(text, /^1.300$/);
  } finally { w.close(); }
});

/** Zwölf Monate, dazwischen ein einzelner Tag — wie period=max sie liefert. */
const VERLAUF = (() => {
  const tage = ['2025-10-29', '2025-11-29', '2025-12-29', '2026-01-29', '2026-02-28', '2026-03-29', '2026-04-29',
                '2026-05-29', '2026-06-29', '2026-07-29', '2026-08-29', '2026-09-29', '2026-10-28', '2026-10-29'];
  const werte = tage.map((_, i) => 4219 + i * 63.7);
  return { success: true, currency: 'EUR', messpunkte: tage.length, period_change_pct: 15,
    points: werte.map((value, i) => ({ x_label: i % 3 ? '' : 'x', value, y_frac: 0.5 })), y_axis: [],
    chart: { x: tage, values: [{ name: 'total', firstRealIndex: 0, values: tage.map((x, i) => ({ x, y: werte[i] })) }] } };
})();

test('Wertdiagramm: Teilung nach 1-2-5, echte Zeitachse, Monatsnamen', async () => {
  const { w, d } = await oeffneOberflaeche({ '/v1/finance/portfolio-history': VERLAUF,
    '/v1/finance/pnl': { success: true, currency: 'EUR', sets: [], totals: { grand_total: String(4219 + 13 * 63.7) } } });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart svg'));
    const svg = d.querySelector('#portfolio-chart svg');
    const texte = [...svg.querySelectorAll('text')];
    const y = texte.filter(x => x.getAttribute('text-anchor') === 'end' && +x.getAttribute('x') < 80)
      .map(x => Number(x.textContent.replace(/\D/g, '')));
    assert.ok(y.length >= 3, `nur ${y.length} Werte an der Achse`);
    const schritt = y[1] - y[0];
    assert.ok(y.every((v, i) => i === 0 || v - y[i - 1] === schritt), `ungleiche Schritte: ${y}`);
    assert.match(String(schritt), /^[125]0*$/, `Schritt ${schritt} ist nicht 1, 2 oder 5 mal 10^k`);
    assert.ok(y.every(v => v % schritt === 0), `krumme Werte: ${y}`);
    const x = texte.filter(t => +t.getAttribute('y') > 160).map(t => t.textContent);
    assert.ok(x.length >= 3, `nur ${x.length} Beschriftungen an der Zeitachse`);
    assert.ok(x.every(t => /^[A-Za-zäÄ]{3,4}\.? \d{2}$/.test(t)), `uneinheitlich: ${x.join(' | ')}`);
    // Zwischen den letzten beiden Punkten liegt ein Tag, davor ein Monat.
    const cx = JSON.parse(svg.dataset.punkte).map(p => p.x);
    const tag = cx[13] - cx[12], monat = cx[12] - cx[11];
    assert.ok(monat > 10 * tag, `Zeitachse: ein Tag ${tag.toFixed(1)}, ein Monat ${monat.toFixed(1)}`);
  } finally { w.close(); }
});

test('Finanzen: Platzhalter beim Laden statt „—“', async () => {
  let freigeben;
  const spaeter = new Promise(r => { freigeben = r; });
  const { w, d } = await oeffneOberflaeche({ '/v1/finance/valuation': () => spaeter.then(() => (
    { success: true, currency: 'EUR', sets: [], totals: { min: '0', avg: '0', max: '0', qty_avg: '0' } })) });
  try {
    await reiter(w, 'finance');
    await takt(30);
    assert.equal(d.getElementById('fin-sum').getAttribute('aria-busy'), 'true');
    assert.ok(d.querySelector('#fin-einstand .skelett-wert'), `Einstand: „${d.getElementById('fin-einstand').textContent}“`);
    assert.ok(d.querySelector('#fin-wert .skelett-wert'), 'Gesamtwert ohne Platzhalter');
    freigeben();
    await warte(() => !d.getElementById('fin-sum').hasAttribute('aria-busy'));
    assert.equal(d.querySelector('#fin-sum .skelett-wert'), null, 'der Platzhalter bleibt stehen');
  } finally { w.close(); }
});

test('Teile: Solange sie laden, keine leere Box „Manuell erfasste Teile“', async () => {
  let freigeben;
  const spaeter = new Promise(r => { freigeben = r; });
  const { w, d } = await oeffneOberflaeche({ '/v1/parts/manual': () => spaeter.then(() => ({ success: true, parts: [
    { part_number: '3001', part_name: 'Brick 2 x 4', color_name: 'Red', color_id: 4, quantity: 3 }] })) });
  try {
    await reiter(w, 'parts');
    await takt(30);
    const box = d.getElementById('manual-parts-box');
    assert.equal(box.style.display, 'none', 'die leere Box steht beim Laden da');
    freigeben();
    await warte(() => box.style.display !== 'none');
    assert.equal(box.style.display, '', 'mit manuellen Teilen erscheint die Box nicht');
  } finally { w.close(); }
});

test('Konto: ohne E-Mail steht nicht „verifiziert“', async () => {
  const { w, d } = await oeffneOberflaeche({ '/v1/auth/profile': { success: true,
    user: { username: 'anna', email: '', email_verified: 1, first_name: '', last_name: '' } } });
  try {
    await sicht(w, 'profil');
    await warte(() => d.getElementById('prof-user').value === 'anna');
    assert.equal(d.getElementById('prof-email-verified').textContent.trim(), '');
  } finally { w.close(); }
});

test('kein Hinweis zum Rebrickable-Schlüssel über dem Einrichtungsassistenten', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/settings/raw': { success: true, settings: { currency: 'EUR', language: 'de', rebrickable_api_key: '' } },
    '/v1/settings/einrichtung': { success: true, offen: true, passwort_aendern: false, quellen: { rebrickable: false } },
  });
  try {
    await warte(() => d.getElementById('einrichtung-modal').classList.contains('open'));
    await takt(700);
    assert.ok(d.getElementById('einrichtung-modal').classList.contains('open'), 'der Assistent ist zu');
    const hinweise = [...d.querySelectorAll('#toasts .toast')].map(t => t.textContent).filter(t => /Rebrickable/.test(t));
    assert.deepEqual(hinweise, []);
  } finally { w.close(); }
});

test('Konto: eigenes Design oder Vorgabe des Verwalters', async () => {
  const aufrufe = [];
  let eigenes = null;
  const { w, d } = await oeffneOberflaeche({
    '/v1/auth/profile': { success: true, user: { username: 'anna', email: 'anna@example.org', email_verified: 1 } },
    '/v1/settings/theme': () => ({ success: true, theme: eigenes || 'noppe', vorgabe: 'noppe', eigenes }),
    '/v1/settings/user/theme': (_url, o) => { aufrufe.push(JSON.parse(o.body)); eigenes = JSON.parse(o.body).theme || null;
      return { success: true, theme: eigenes || 'noppe', vorgabe: 'noppe', eigenes }; },
  });
  try {
    // Das Boot-Skript steht im <head>, das der Helfer nicht ausführt; es stellt applyTheme bereit.
    w.eval(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'js', '00-theme-boot.js'), 'utf8'));
    await sicht(w, 'profil');
    const sel = d.getElementById('design-wahl');
    await warte(() => /Noppe/.test(sel.options[0].textContent));
    assert.equal(sel.options[0].textContent, 'Vorgabe: Noppe (poppig)');
    assert.equal(sel.value, '');
    sel.value = 'werkbank';
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    await warte(() => d.documentElement.getAttribute('data-theme') === 'werkbank');
    assert.deepEqual(aufrufe, [{ theme: 'werkbank' }]);
    assert.equal(d.documentElement.getAttribute('data-theme'), 'werkbank', 'eigenes Design nicht angewendet');
    sel.value = '';
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    await warte(() => d.documentElement.getAttribute('data-theme') === 'noppe');
    assert.deepEqual(aufrufe.at(-1), { theme: '' });
  } finally { w.close(); }
});
