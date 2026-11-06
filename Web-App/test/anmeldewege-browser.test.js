/**
 * Die Anmeldemaske fragt den Server, welche Wege er anbietet
 * (/v1/auth/registration-status). Fragt sie zweimal, gilt die jüngste Antwort,
 * auch wenn die ältere später ankommt. Geprüft im echten Browser: Zweimal
 * „Abmelden“, die erste Antwort kommt 1,2 s nach der zweiten und sagt das
 * Gegenteil.
 *
 * Gegenproben (05.11.2026 gemessen, Bündel neu gebaut):
 *   A  in checkRegistrationEnabled die Prüfung `lauf !== _anmeldewegeLauf`
 *      entfernt → rot: „die jüngste Antwort gilt“ (link-forgot verborgen)
 *   B  `dataset.anmeldewege = 'geladen'` entfernt → rot: Zeitüberschreitung
 *      „Anmeldewege eingetragen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');

test('Anmeldewege: die jüngste Antwort gilt', { timeout: 120_000 }, async (t) => {
  const app = await starteApp(t, { name: `aw_${process.pid}` });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis, ruhig } = app;
  await ruhig();
  // Die erste Abfrage antwortet spät und verneint „Passwort vergessen?“, die zweite sofort und bejaht.
  await b.auswerten(`(() => {
    const echt = window.fetch.bind(window); let n = 0;
    window.fetch = (url, o) => {
      if (!String(url).includes('/v1/auth/registration-status')) return echt(url, o);
      const erste = ++n === 1;
      const antwort = () => new Response(JSON.stringify({ success: true, enabled: true, passkey: true,
        passwort_vergessen: !erste }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Promise(r => setTimeout(() => r(antwort()), erste ? 1200 : 0));
    };
    return true; })()`);
  await b.auswerten(`document.getElementById('btn-logout').click(); true`);
  await bis(`getComputedStyle(document.getElementById('login-screen')).display !== 'none'`, 'Anmeldemaske');
  await b.auswerten(`document.getElementById('btn-logout').click(); true`);
  await bis(`document.getElementById('login-screen').dataset.anmeldewege === 'geladen'`, 'Anmeldewege eingetragen');
  // Die späte erste Antwort abwarten.
  await ruhig();
  assert.equal(await b.auswerten(`document.getElementById('link-forgot').hidden`), false, 'die jüngste Antwort gilt');
  assert.equal(await b.auswerten(`document.getElementById('login-screen').dataset.anmeldewege`), 'geladen');
});
