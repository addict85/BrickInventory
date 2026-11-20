/**
 * Wer sich anmeldet, während die Startfrage „bin ich angemeldet?“ noch
 * unterwegs ist, bleibt angemeldet: Die späte Antwort „nein“ darf die App
 * nicht zurück auf die Anmeldemaske werfen.
 *
 * Gegenprobe (31.10.2026 gemessen): in checkAuth() die Zeile `if (angemeldetesKonto) return;`
 * entfernt → rot: „die App bleibt sichtbar“ (#app hat display: none, die
 * Anmeldemaske steht wieder da). Am 11.11.2026 mit ruhig() statt 5 s Pause
 * wiederholt: ebenso rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

test('eine späte Startantwort „nicht angemeldet“ beendet die frische Anmeldung nicht', {
  timeout: 120_000,
}, async t => {
  const app = await startApp(t, {
    name: `ueberholt_${process.pid}`,
    intercept: [
      {
        muster: '*/api/v1/auth/me*',
        contains: '/api/v1/auth/me',
        antwort: { success: true, loggedIn: false, user: null },
        delay: 4000,
      },
    ],
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  // startApp kehrt kurz nach der Anmeldung zurück; die Startantwort kommt
  // 4 s nach dem Laden der Seite. ruhig() wartet, bis sie da ist.
  await app.ruhig(15_000);
  const stand = await app.b.auswerten(`({
    app: getComputedStyle(document.getElementById('app')).display,
    mask: getComputedStyle(document.getElementById('login-screen')).display })`);
  assert.notEqual(stand.app, 'none', 'die App bleibt sichtbar');
  assert.equal(stand.mask, 'none', 'die Anmeldemaske bleibt verborgen');
});
