/**
 * Whoever logs in while the start question „bin ich angemeldet?“ is still
 * on its way stays logged in: the late answer „nein“ must not throw the app
 * back to the login form.
 *
 * Counter-check (measured 31.10.2026): in checkAuth() the line `if (angemeldetesKonto) return;`
 * removed → red: „die App bleibt sichtbar“ (#app has display: none, the
 * login form stands there again). On 11.11.2026 repeated with ruhig() instead of a 5 s pause:
 * red as well.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

test('a late startup response "not logged in" does not end the fresh login', {
  timeout: 120_000,
}, async t => {
  const app = await startApp(t, {
    name: `ueberholt_${process.pid}`,
    intercept: [
      {
        muster: '*/api/v2/auth/me*',
        contains: '/api/v2/auth/me',
        response: { success: true, loggedIn: false, user: null },
        delay: 4000,
      },
    ],
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  // startApp returns shortly after the login; the start response comes
  // 4 s after loading the page. ruhig() waits until it is there.
  await app.ruhig(15_000);
  const state = await app.b.auswerten(`({
    app: getComputedStyle(document.getElementById('app')).display,
    mask: getComputedStyle(document.getElementById('login-screen')).display })`);
  assert.notEqual(state.app, 'none', 'the app stays visible');
  assert.equal(state.mask, 'none', 'the sign-in form stays hidden');
});
