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
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { starteApp } = require('./helpers/app-browser');

const sichtbar = (id) => `getComputedStyle(document.getElementById('${id}')).display !== 'none'`;

test('E-Mail-Bestätigung per Knopf', { timeout: 180_000 }, async (t) => {
  const app = await starteApp(t, { name: `bestaetigen_${process.pid}` });
  if (app.grund) { t.skip(app.grund); return; }
  const neuerLink = async (uid) => {
    const roh = crypto.randomBytes(32).toString('hex');
    await app.db.run(`UPDATE users SET email_verified = false, verification_token = $2,
      token_expires = NOW() + INTERVAL '1 day' WHERE id = $1`, [uid, crypto.createHash('sha256').update(roh).digest('hex')]);
    return `http://127.0.0.1:${app.port}/verify?token=${roh}`;
  };
  const bestaetigt = async (uid) => (await app.db.get('SELECT email_verified FROM users WHERE id = $1', [uid])).email_verified;

  await t.test('angemeldet (neue Adresse im Profil): erst der Knopf, dann die Anwendung', async () => {
    await app.b.tab('Page.navigate', { url: await neuerLink(app.uid) });
    await app.bis(`${sichtbar('login-screen')} && ${sichtbar('panel-verify')}`, 'Bestätigungsseite');
    assert.equal(await bestaetigt(app.uid), false, 'das Öffnen des Links bestätigt nichts');
    assert.equal(await app.b.auswerten(`location.search`), '', 'das Token bleibt nicht in der Adresszeile');
    await app.b.auswerten(`document.getElementById('btn-verify').click(); true`);
    await app.bis(`location.pathname === '/' && ${sichtbar('app')} && !${sichtbar('login-screen')}`, 'Anwendung', 300);
    assert.equal(await bestaetigt(app.uid), true);
  });

  await t.test('abgemeldet: die Erfolgsmeldung steht über der Anmeldung', async (st) => {
    const zweiter = (await app.db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified)
      VALUES ($1, $2, 'x', true, false) RETURNING id`, [`bestaetigen2_${process.pid}`, `b2_${process.pid}@example.org`])).id;
    st.after(() => app.db.run('DELETE FROM users WHERE id = $1', [zweiter]));
    await app.b.auswerten(`fetch('/api/v1/auth/logout', { method: 'POST' }).then(() => true)`);
    const link = await neuerLink(zweiter);
    await app.b.tab('Page.navigate', { url: link.replace(/token=[0-9a-f]+/, 'token=falsch') });
    await app.bis(sichtbar('panel-verify'), 'Bestätigungsseite');
    await app.b.auswerten(`document.getElementById('btn-verify').click(); true`);
    await app.bis(`/ungültig/.test(document.getElementById('verify-err').textContent)`, 'Fehlertext bei falschem Link');
    await app.b.tab('Page.navigate', { url: link });
    await app.bis(sichtbar('panel-verify'), 'Bestätigungsseite');
    assert.equal(await bestaetigt(zweiter), false);
    await app.b.auswerten(`document.getElementById('btn-verify').click(); true`);
    await app.bis(`${sichtbar('panel-login')} && ${sichtbar('verified-msg')}`, 'Erfolgsmeldung über der Anmeldung');
    assert.equal(await bestaetigt(zweiter), true);
  });
});
