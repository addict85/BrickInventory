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

const sichtbar = id => `getComputedStyle(document.getElementById('${id}')).display !== 'none'`;
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
    const roh = crypto.randomBytes(32).toString('hex');
    await app.db.run(
      `UPDATE users SET new_email = $3, new_email_token = $2, new_email_until = NOW() + INTERVAL '1 day' WHERE id = $1`,
      [uid, crypto.createHash('sha256').update(roh).digest('hex'), `neu${uid}_${process.pid}@example.org`],
    );
    return `http://127.0.0.1:${app.port}/verify#token=${roh}`;
  };
  const bestaetigt = async uid =>
    (
      await app.db.get(
        'SELECT new_email IS NULL AND email IS NOT NULL AND email_verified AS ok FROM users WHERE id = $1',
        [uid],
      )
    ).ok;

  await t.test('logged in (new address in the profile): first the button, then the application', async () => {
    await app.b.tab('Page.navigate', { url: await newLink(app.uid) });
    await app.bis(`${sichtbar('login-screen')} && ${sichtbar('panel-verify')}`, 'Bestätigungsseite');
    await app.bis(accountNamed(`bestaetigen_${process.pid}`), 'eigenes Konto genannt');
    assert.equal(await bestaetigt(app.uid), false, 'das Öffnen des Links bestätigt nichts');
    assert.equal(
      await app.b.auswerten(`location.search + location.hash`),
      '',
      'das Token bleibt nicht in der Adresszeile',
    );
    await app.b.auswerten(`document.getElementById('btn-verify').click(); true`);
    await app.bis(`location.pathname === '/' && ${sichtbar('app')} && !${sichtbar('login-screen')}`, 'Anwendung', 300);
    assert.equal(await bestaetigt(app.uid), true);
  });

  await t.test('logged out: the success message stands above the login', async st => {
    const zweiter = (
      await app.db.get(
        `INSERT INTO users (username, password_hash, is_active, registration_pending)
      VALUES ($1, 'x', true, true) RETURNING id`,
        [`bestaetigen2_${process.pid}`],
      )
    ).id;
    st.after(() => app.db.run('DELETE FROM users WHERE id = $1', [zweiter]));
    const link = await newLink(zweiter);
    await app.b.tab('Page.navigate', { url: link });
    await app.bis(accountNamed(`bestaetigen2_${process.pid}`), 'Konto des Links genannt');
    assert.match(
      await app.b.auswerten(text('verify-target')),
      new RegExp(`als „bestaetigen_${process.pid}“`),
      'ein fremder Link nennt beide Konten',
    );
    await app.b.auswerten(`fetch('/api/v2/auth/logout', { method: 'POST' }).then(() => true)`);
    await app.b.tab('Page.navigate', { url: link.replace(/token=[0-9a-f]+/, 'token=falsch') });
    await app.bis(sichtbar('panel-verify'), 'Bestätigungsseite');
    await app.bis(`/ungültig/.test(document.getElementById('verify-err').textContent)`, 'Fehlertext bei falschem Link');
    assert.equal(
      await app.b.auswerten(`document.getElementById('btn-verify').disabled`),
      true,
      'ein falscher Link lässt sich nicht bestätigen',
    );
    await app.b.tab('Page.navigate', { url: link });
    await app.bis(accountNamed(`bestaetigen2_${process.pid}`), 'Konto des Links genannt');
    assert.equal(await bestaetigt(zweiter), false);
    await app.b.auswerten(`document.getElementById('btn-verify').click(); true`);
    await app.bis(`${sichtbar('panel-login')} && ${sichtbar('verified-msg')}`, 'Erfolgsmeldung über der Anmeldung');
    assert.equal(await bestaetigt(zweiter), true);
  });
});
