/**
 * After logging out and after the end of the session no password stands in the
 * login field any more, and the expiry reports exactly once: as a hint in the
 * login card, without an error toast of the lists behind it.
 *
 * Counter-checks (measured 04.11.2026, each on its own):
 *   A  the clearing of #lp removed in showLogin() → red: both subcases
 *      („das Passwort steht noch im Feld“)
 *   B  in listLoadError() the line for status 401 removed and in toast()
 *      the filter for 401 messages → red: “session expired” (error toast
 *      „Nicht angemeldet …“ next to the hint)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternCollection } = require('./helpers/inventory');

const felder = `({ lu: document.getElementById('lu').value, lp: document.getElementById('lp').value,
  lc: document.getElementById('lc').value, mask: getComputedStyle(document.getElementById('login-screen')).display,
  hinweis: document.getElementById('login-hint').hidden ? '' : document.getElementById('login-hint').textContent,
  fehler: [...document.querySelectorAll('#toasts .toast.error')].map(t => t.textContent) })`;

test('login fields after the session expired and after logout', { timeout: 180_000 }, async t => {
  const app = await startApp(t, { name: `ablauf_${process.pid}`, holding: patternCollection });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const mask = `getComputedStyle(document.getElementById('login-screen')).display !== 'none'`;

  await t.test('session expired: name stays, password gone, exactly one message', async () => {
    assert.notEqual(await app.b.auswerten(`document.getElementById('lp').value`), '', 'Vorbedingung: Passwort im Feld');
    await app.db.run(`DELETE FROM user_sessions`);
    // Two views in the same beat: the collection reloads while the parts already get 401.
    await app.b.auswerten(`document.querySelector('.ntab[data-tab="finance"]').click();
      document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await app.bis(mask, 'Anmeldemaske nach 401');
    // The second 401 is answered too and its hint drawn.
    await app.ruhig();
    const f = await app.b.auswerten(felder);
    assert.equal(f.lp, '', 'das Passwort steht noch im Feld');
    assert.match(f.lu, /^ablauf_/, 'der Name bleibt zum schnellen Wiederanmelden');
    assert.match(f.hinweis, /Sitzung abgelaufen/);
    assert.deepEqual(f.fehler, [], 'Fehler-Toast neben dem Hinweis');
  });

  await t.test('logout clears name, password and code', async () => {
    // Admins need the second factor; the first code went to the first login.
    await app.b.auswerten(`document.getElementById('lp').value = 'app-Passwort-1';
      document.getElementById('lc').value = ${JSON.stringify(app.furtherCodes[0])};
      document.getElementById('btn-login').click(); true`);
    await app.bis(`getComputedStyle(document.getElementById('app')).display !== 'none'`, 'wieder angemeldet', 300);
    assert.equal(
      await app.b.auswerten(`document.getElementById('login-hint').hidden`),
      true,
      'Hinweis verschwindet mit der Anmeldung',
    );
    await app.b.auswerten(`document.getElementById('lp').value = 'app-Passwort-1'; document.getElementById('lc').value = '123456';
      window.__alt = true; document.getElementById('btn-logout').click(); true`);
    await app.bis(`!window.__alt && ${mask}`, 'Anmeldemaske');
    const f = await app.b.auswerten(felder);
    assert.equal(f.lp, '', 'das Passwort steht noch im Feld');
    assert.equal(f.lc, '', 'der Code steht noch im Feld');
    assert.equal(f.lu, '', 'der Name steht noch im Feld');
    assert.equal(f.hinweis, '', 'nach eigenem Abmelden kein Ablauf-Hinweis');
  });
});
