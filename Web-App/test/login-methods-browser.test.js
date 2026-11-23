/**
 * The login form asks the server which methods it offers
 * (/v2/auth/registration-status). If it asks twice, the most recent response applies,
 * even if the older one arrives later. Since logging out reloads the page,
 * a page asks twice like this: at the start without a session, and after logging in and
 * an expired session. The start question answers 8 s late and says the opposite.
 *
 * Counter-checks (measured 14.11.2026, bundle rebuilt):
 *   A  in checkRegistrationEnabled the check `lauf !== _loginMethodsRun`
 *      removed → red: „die jüngste Antwort gilt“ (link-forgot hidden)
 *   B  `dataset.loginMethods = 'loaded'` removed → red: timeout
 *      „Anmeldewege eingetragen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

test('login methods: the most recent response applies', { timeout: 120_000 }, async t => {
  const name = `aw_${process.pid}`;
  const app = await startApp(t, {
    name,
    holding: (db, uid) => db.run('UPDATE users SET is_admin = false WHERE id = $1', [uid]),
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  await settle();
  // On every new page: the first query answers late and denies „Passwort vergessen?“, every further one immediately.
  await b.tab('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
    const original = window.fetch.bind(window); let n = 0;
    window.fetch = (url, o) => {
      if (!String(url).includes('/v2/auth/registration-status')) return original(url, o);
      const first = ++n === 1;
      const antwort = () => new Response(JSON.stringify({ success: true, enabled: true, passkey: true,
        passwort_vergessen: !first }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Promise(r => setTimeout(() => { r(antwort()); if (first) window.__spaet = true; }, first ? 8000 : 0));
    }; })();`,
  });
  await b.evaluate(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
  await until(
    `!window.__alt && typeof document.getElementById('btn-login')?.onclick === 'function'`,
    'Sign-in form after the reload',
    200,
  );
  await b.evaluate(`document.getElementById('lu').value = ${JSON.stringify(name)};
    document.getElementById('lp').value = 'app-Passwort-1'; document.getElementById('btn-login').click(); true`);
  await until(`getComputedStyle(document.getElementById('app')).display !== 'none'`, 'signed in', 300);
  // The session ends at the server; the next call of the app gets 401 and shows the form again.
  await b.evaluate(`fetch('/api/v2/auth/logout', { method: 'POST' }).then(() => {
    document.querySelector('.ntab[data-tab="finance"]').click(); return true; })`);
  await until(`getComputedStyle(document.getElementById('login-screen')).display !== 'none'`, 'Session expired');
  await until(`document.getElementById('login-screen').dataset.loginMethods === 'loaded'`, 'Anmeldewege eingetragen');
  // Wait for the late first response.
  await until('window.__spaet === true', 'late first response', 150);
  await settle();
  assert.equal(await b.evaluate(`document.getElementById('link-forgot').hidden`), false, 'the latest response applies');
  assert.equal(await b.evaluate(`document.getElementById('login-screen').dataset.loginMethods`), 'loaded');
});
