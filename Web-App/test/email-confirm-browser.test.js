/**
 * Der Link aus der Bestätigungsmail öffnet eine Seite mit Knopf; erst der Knopf
 * bestätigt (POST). Angemeldet geht es danach in die Anwendung, abgemeldet
 * steht die Erfolgsmeldung über der Anmeldung.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in der Startprüfung `&& !_verifyToken` gestrichen → rot: „angemeldet …“
 *      (die Anwendung öffnet sich, die Bestätigungsseite nie)
 *   B  im Knopf-Handler die Zeilen zu `verified-msg` gestrichen → rot:
 *      „abgemeldet …“ (Zeitüberschreitung: Erfolgsmeldung)
 *   C  der Knopf schickt `token: null` → rot: beide Teilfälle
 *      („Zeitüberschreitung: Anwendung“ bzw. „Erfolgsmeldung …“)
 *
 * Vor dem Knopf nennt die Seite das Konto des Links (Sicherheitsprüfung 14, H1).
 * Gegenproben (04.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   D  showConfirmationTarget() ohne Vorschau (Text wie zuvor aus dem Profil)
 *      → rot: beide Teilfälle („Zeitüberschreitung: eigenes Konto genannt“ bzw.
 *      „… Konto des Links genannt“)
 *   E  der Zweig `verify.fremdes_konto` gestrichen → rot: „ein fremder Link …“
 *   F  die Vorschau-Route löst den Link ein (verifyEmailToken) → rot: „das
 *      Öffnen des Links bestätigt nichts“
 *
 * Der Token steht im Fragment (#token=), das kein Browser an den Server schickt.
 * Gegenproben (13.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   G  sitzung.js liest den Token wieder nur aus location.search → rot:
 *      „angemeldet …“ (Zeitüberschreitung: Bestätigungsseite)
 *   H  den hashchange-Lauscher in sitzung.js gestrichen → rot: „abgemeldet …“
 *      (Zeitüberschreitung: Fehlertext bei falschem Link; ein zweiter Link im
 *      selben Tab ändert nur das Fragment)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startApp } = require('./helpers/app-browser');

const sichtbar = id => `getComputedStyle(document.getElementById('${id}')).display !== 'none'`;
const text = id => `(document.getElementById('${id}')?.textContent || '')`;
/** Der Knopf ist frei, sobald die Seite das Konto des Links nennt. */
const accountNamed =
  name => `!document.getElementById('btn-verify').disabled && ${text('verify-ziel')}.includes('„${name}“')
  && ${text('btn-verify')}.includes('„${name}“')`;

test('email confirmation via button', { timeout: 180_000 }, async t => {
  const app = await startApp(t, { name: `bestaetigen_${process.pid}` });
  if (app.grund) {
    t.skip(app.grund);
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
      await app.b.auswerten(text('verify-ziel')),
      new RegExp(`als „bestaetigen_${process.pid}“`),
      'ein fremder Link nennt beide Konten',
    );
    await app.b.auswerten(`fetch('/api/v1/auth/logout', { method: 'POST' }).then(() => true)`);
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
