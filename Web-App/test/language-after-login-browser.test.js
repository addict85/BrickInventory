/**
 * An account with language English sees English immediately after login,
 * even if the login mask was loaded in German (only the active language is
 * delivered). Real app in Chrome.
 *
 * Counter-check (measured 02.11.2026): in showApp again `srvLang && I18N[srvLang]`
 * → red: “English UI without reloading” (“Bauliste” instead of “Build list”).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

test('English UI without reloading', { timeout: 120_000 }, async t => {
  // Without administrator role: the administrator path loaded the dictionary on the side and hid the bug.
  const app = await startApp(t, {
    name: `sprache_${process.pid}`,
    sprache: 'en',
    bestand: (db, uid) => db.run('UPDATE users SET is_admin = false WHERE id = $1', [uid]),
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  // Like a visitor with a German browser: log out, remember German, reload
  // (the page then only brings the German dictionary) and log in again.
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
