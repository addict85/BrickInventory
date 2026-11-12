/**
 * Ein Konto mit Sprache Englisch sieht nach der Anmeldung sofort Englisch,
 * auch wenn die Anmeldemaske deutsch geladen war (nur die aktive Sprache wird
 * ausgeliefert). Echte App in Chrome.
 *
 * Gegenprobe (02.11.2026 gemessen): in showApp wieder `srvLang && I18N[srvLang]`
 * → rot: „englische Oberfläche ohne Neuladen“ („Bauliste“ statt „Build list“).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');

test('englische Oberfläche ohne Neuladen', { timeout: 120_000 }, async t => {
  // Ohne Verwalterrolle: Der Verwalterpfad lud das Wörterbuch nebenbei und verdeckte den Fehler.
  const app = await starteApp(t, {
    name: `sprache_${process.pid}`,
    sprache: 'en',
    bestand: (db, uid) => db.run('UPDATE users SET is_admin = false WHERE id = $1', [uid]),
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  // Wie ein Besucher mit deutschem Browser: abmelden, Deutsch merken, neu laden
  // (die Seite bringt dann nur das deutsche Wörterbuch mit) und wieder anmelden.
  const { b, bis } = app;
  await b.auswerten(`document.getElementById('btn-logout').click(); true`);
  await bis(`getComputedStyle(document.getElementById('login-screen')).display !== 'none'`, 'abgemeldet');
  await b.auswerten(`localStorage.setItem('bim_lang', 'de'); location.reload(); true`);
  await app.warte(500);
  await bis(
    `typeof document.getElementById('btn-login')?.onclick === 'function' && !window.I18N_EN`,
    'Anmeldemaske nur deutsch',
  );
  await b.auswerten(`document.getElementById('lu').value = ${JSON.stringify(`sprache_${process.pid}`)};
    document.getElementById('lp').value = 'app-Passwort-1'; document.getElementById('btn-login').click(); true`);
  await bis(`getComputedStyle(document.getElementById('app')).display !== 'none'`, 'angemeldet', 300);
  await app.warte(1500);
  assert.equal(
    await app.b.auswerten(`document.querySelector('.ntab[data-tab="partslist"] .tab-label').textContent.trim()`),
    'Build list',
  );
  assert.equal(await app.b.auswerten(`document.documentElement.lang`), 'en');
});
