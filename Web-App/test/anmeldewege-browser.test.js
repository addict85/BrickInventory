/**
 * Die Anmeldemaske fragt den Server, welche Wege er anbietet
 * (/v1/auth/registration-status). Fragt sie zweimal, gilt die jüngste Antwort,
 * auch wenn die ältere später ankommt. Seit das Abmelden die Seite neu lädt,
 * fragt eine Seite zweimal so: beim Start ohne Sitzung, und nach Anmelden und
 * abgelaufener Sitzung. Die Startfrage antwortet 8 s spät und sagt das Gegenteil.
 *
 * Gegenproben (14.11.2026 gemessen, Bündel neu gebaut):
 *   A  in checkRegistrationEnabled die Prüfung `lauf !== _anmeldewegeLauf`
 *      entfernt → rot: „die jüngste Antwort gilt“ (link-forgot verborgen)
 *   B  `dataset.anmeldewege = 'geladen'` entfernt → rot: Zeitüberschreitung
 *      „Anmeldewege eingetragen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');

test('Anmeldewege: die jüngste Antwort gilt', { timeout: 120_000 }, async t => {
  const name = `aw_${process.pid}`;
  const app = await starteApp(t, {
    name,
    bestand: (db, uid) => db.run('UPDATE users SET is_admin = false WHERE id = $1', [uid]),
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, ruhig } = app;
  await ruhig();
  // Auf jeder neuen Seite: Die erste Abfrage antwortet spät und verneint „Passwort vergessen?“, jede weitere sofort.
  await b.tab('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
    const echt = window.fetch.bind(window); let n = 0;
    window.fetch = (url, o) => {
      if (!String(url).includes('/v1/auth/registration-status')) return echt(url, o);
      const erste = ++n === 1;
      const antwort = () => new Response(JSON.stringify({ success: true, enabled: true, passkey: true,
        passwort_vergessen: !erste }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Promise(r => setTimeout(() => { r(antwort()); if (erste) window.__spaet = true; }, erste ? 8000 : 0));
    }; })();`,
  });
  await b.auswerten(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
  await bis(
    `!window.__alt && typeof document.getElementById('btn-login')?.onclick === 'function'`,
    'Anmeldemaske nach dem Neuladen',
    200,
  );
  await b.auswerten(`document.getElementById('lu').value = ${JSON.stringify(name)};
    document.getElementById('lp').value = 'app-Passwort-1'; document.getElementById('btn-login').click(); true`);
  await bis(`getComputedStyle(document.getElementById('app')).display !== 'none'`, 'angemeldet', 300);
  // Die Sitzung endet am Server; der nächste Aufruf der App bekommt 401 und zeigt die Maske erneut.
  await b.auswerten(`fetch('/api/v1/auth/logout', { method: 'POST' }).then(() => {
    document.querySelector('.ntab[data-tab="finance"]').click(); return true; })`);
  await bis(`getComputedStyle(document.getElementById('login-screen')).display !== 'none'`, 'Sitzung abgelaufen');
  await bis(`document.getElementById('login-screen').dataset.anmeldewege === 'geladen'`, 'Anmeldewege eingetragen');
  // Die späte erste Antwort abwarten.
  await bis('window.__spaet === true', 'späte erste Antwort', 150);
  await ruhig();
  assert.equal(await b.auswerten(`document.getElementById('link-forgot').hidden`), false, 'die jüngste Antwort gilt');
  assert.equal(await b.auswerten(`document.getElementById('login-screen').dataset.anmeldewege`), 'geladen');
});
