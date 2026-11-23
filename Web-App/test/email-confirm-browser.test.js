/**
 * The link from the confirmation mail opens a page with a button; only the button
 * confirms (POST). Logged in it then goes into the application, logged out
 * the success message stands above the login.
 *
 * Counter-checks (measured 04.11.2026, each alone, bundle rebuilt):
 *   A  in the startup check `&& !_verifyToken` deleted → red: “logged in …”
 *      (the application opens, the confirmation page never)
 *   B  in the button handler the lines for `verified-msg` deleted → red:
 *      “logged out …” (timeout: success message)
 *   C  the button sends `token: null` → red: both subcases
 *      (“timeout: application” and “success message …”)
 *
 * Before the button the page names the link's account (security review 14, H1).
 * Counter-checks (measured 04.11.2026, each alone, bundle rebuilt):
 *   D  showConfirmationTarget() without preview (text from the profile as before)
 *      → red: both subcases (“timeout: own account named” and
 *      “… link's account named”)
 *   E  the branch `verify.fremdes_account` deleted → red: “a foreign link …”
 *   F  the preview route redeems the link (verifyEmailToken) → red: “opening
 *      the link confirms nothing”
 *
 * The token stands in the fragment (#token=), which no browser sends to the server.
 * Counter-checks (measured 13.11.2026, each alone, bundle rebuilt):
 *   G  sitzung.js reads the token only from location.search again → red:
 *      “logged in …” (timeout: confirmation page)
 *   H  the hashchange listener in sitzung.js deleted → red: “logged out …”
 *      (timeout: error text on a wrong link; a second link in the
 *      same tab only changes the fragment)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startApp } = require('./helpers/app-browser');

const visible = id => `getComputedStyle(document.getElementById('${id}')).display !== 'none'`;
const text = id => `(document.getElementById('${id}')?.textContent || '')`;
/** The button is enabled as soon as the page names the link's account. */
const accountNamed =
  name => `!document.getElementById('btn-verify').disabled && ${text('verify-target')}.includes('„${name}“')
  && ${text('btn-verify')}.includes('„${name}“')`;

test('email confirmation via button', { timeout: 180_000 }, async t => {
  const app = await startApp(t, { name: `bestaetigen_${process.pid}` });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const newLink = async uid => {
    const raw = crypto.randomBytes(32).toString('hex');
    await app.db.run(
      `UPDATE users SET new_email = $3, new_email_token = $2, new_email_until = NOW() + INTERVAL '1 day' WHERE id = $1`,
      [uid, crypto.createHash('sha256').update(raw).digest('hex'), `neu${uid}_${process.pid}@example.org`],
    );
    return `http://127.0.0.1:${app.port}/verify#token=${raw}`;
  };
  const confirmed = async uid =>
    (
      await app.db.get(
        'SELECT new_email IS NULL AND email IS NOT NULL AND email_verified AS ok FROM users WHERE id = $1',
        [uid],
      )
    ).ok;

  await t.test('logged in (new address in the profile): first the button, then the application', async () => {
    await app.b.tab('Page.navigate', { url: await newLink(app.uid) });
    await app.until(`${visible('login-screen')} && ${visible('panel-verify')}`, 'Confirmation page');
    await app.until(accountNamed(`bestaetigen_${process.pid}`), 'own account named');
    assert.equal(await confirmed(app.uid), false, 'opening the link confirms nothing');
    assert.equal(
      await app.b.evaluate(`location.search + location.hash`),
      '',
      'the token does not stay in the address bar',
    );
    await app.b.evaluate(`document.getElementById('btn-verify').click(); true`);
    await app.until(`location.pathname === '/' && ${visible('app')} && !${visible('login-screen')}`, 'Anwendung', 300);
    assert.equal(await confirmed(app.uid), true);
  });

  await t.test('logged out: the success message stands above the login', async st => {
    const secondOne = (
      await app.db.get(
        `INSERT INTO users (username, password_hash, is_active, registration_pending)
      VALUES ($1, 'x', true, true) RETURNING id`,
        [`bestaetigen2_${process.pid}`],
      )
    ).id;
    st.after(() => app.db.run('DELETE FROM users WHERE id = $1', [secondOne]));
    const link = await newLink(secondOne);
    await app.b.tab('Page.navigate', { url: link });
    await app.until(accountNamed(`bestaetigen2_${process.pid}`), 'account of the link named');
    assert.match(
      await app.b.evaluate(text('verify-target')),
      new RegExp(`als „bestaetigen_${process.pid}“`),
      'a foreign link names both accounts',
    );
    await app.b.evaluate(`fetch('/api/v2/auth/logout', { method: 'POST' }).then(() => true)`);
    await app.b.tab('Page.navigate', { url: link.replace(/token=[0-9a-f]+/, 'token=falsch') });
    await app.until(visible('panel-verify'), 'Confirmation page');
    await app.until(
      `/ungültig/.test(document.getElementById('verify-err').textContent)`,
      'Error text for a wrong link',
    );
    assert.equal(
      await app.b.evaluate(`document.getElementById('btn-verify').disabled`),
      true,
      'a wrong link cannot be confirmed',
    );
    await app.b.tab('Page.navigate', { url: link });
    await app.until(accountNamed(`bestaetigen2_${process.pid}`), 'account of the link named');
    assert.equal(await confirmed(secondOne), false);
    await app.b.evaluate(`document.getElementById('btn-verify').click(); true`);
    await app.until(`${visible('panel-login')} && ${visible('verified-msg')}`, 'Success message above the sign-in');
    assert.equal(await confirmed(secondOne), true);
  });
});
