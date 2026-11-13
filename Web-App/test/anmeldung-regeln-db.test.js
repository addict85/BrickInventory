/**
 * Regeln der Anmeldung an der echten Route (routes/auth.ts) und Test-DB: Der
 * QR-Zugang ist eine einmalige Nonce mit der Dauer, die der Server nennt; das
 * Profil prüft den Benutzernamen wie Login und Registrierung; scheitert das
 * Speichern des Tokens, bekommt die App einen Fehler statt eines halben Erfolgs.
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln):
 *   A  in loeseQrTokenEin `AND used_at IS NULL` gestrichen → rot: „QR-Zugang:
 *      einmalig …“ (heute melde() in src/konto/repository/qrKopplung.ts)
 *   B  in POST /qr-token `expires_in: 1800` → rot: dieselbe Prüfung
 *   C  in PUT /profile die Prüfung mit USERNAME_RE gestrichen → rot:
 *      „Profil: Benutzername …“; nameVergeben() ohne LOWER() → rot: dort
 *   D  in angemeldetAntworten `if (!token) return sendeFehler(…)` gestrichen
 *      → rot: „ohne gespeicherten Token kein halber Erfolg“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
const { qrKoppeln } = require('./helpers/qr');
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testDaten();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test('Regeln der Anmeldung', { concurrency: 1, timeout: 60_000 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const NAME = `regeln_${process.pid}`,
    NACHBAR = `Nachbar_${process.pid}`,
    PASS = 'Regeln-Passwort-1';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, NACHBAR]]);
  const anlegen = async n =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
        [n, `${n.toLowerCase()}@example.org`, await bcrypt.hash(PASS, 4)],
      )
    ).id;
  const uid = await anlegen(NAME);
  await anlegen(NACHBAR);
  t.after(async () => {
    await db.run('DROP TRIGGER IF EXISTS regeln_token_sperre ON api_tokens').catch(() => {});
    await db.run('DROP FUNCTION IF EXISTS regeln_token_sperre()').catch(() => {});
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, NACHBAR]]);
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, {
    sitzung: { userId: uid, username: NAME },
    routen: { '/api/v1/auth': 'routes/auth.js' },
    t,
  });
  const ruf = async (methode, pfad, body) => {
    const r = await fetch(`${base}/api/v1/auth${pfad}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  await t.test('QR-Zugang: einmalig, ohne Passwort-Material, mit der Dauer des Servers', async () => {
    const qr = await ruf('POST', '/qr-token', { password: PASS });
    assert.equal(qr.status, 200, JSON.stringify(qr.body));
    assert.equal(qr.body.expires_in, 300, 'Die Oberfläche zählt von dieser Dauer herunter');
    assert.doesNotMatch(JSON.stringify(qr.body), /\$2[aby]\$/, 'Ein bcrypt-Hash im QR-Code ist offline knackbar');
    const erst = await qrKoppeln((p, body) => ruf('POST', p, body), qr.body);
    assert.equal(erst.status, 200, JSON.stringify(erst.body));
    assert.equal(erst.body.userId, uid);
    const zweit = await ruf('POST', '/qr-login', { token: qr.body.token });
    assert.equal(zweit.status, 401, 'Derselbe Code öffnet das Konto ein zweites Mal');
  });

  await t.test('Profil: Benutzername nach derselben Regel und ohne Rücksicht auf Gross/Klein', async () => {
    const ungueltig = await ruf('PUT', '/profile', { username: 'a b', password_current: PASS });
    assert.deepEqual([ungueltig.status, ungueltig.body.code], [400, 'benutzername_ungueltig']);
    const mail = await ruf('PUT', '/profile', { username: 'x@example.org', password_current: PASS });
    assert.equal(mail.status, 400, 'Eine E-Mail-Adresse als Benutzername — der Login sucht beides');
    const vergeben = await ruf('PUT', '/profile', { username: NACHBAR.toLowerCase(), password_current: PASS });
    assert.deepEqual([vergeben.status, vergeben.body.code], [400, 'benutzername_vergeben']);
    assert.equal((await db.get('SELECT username FROM users WHERE id = $1', [uid])).username, NAME);
  });

  await t.test('ohne gespeicherten Token kein halber Erfolg', async () => {
    await db.run(`CREATE OR REPLACE FUNCTION regeln_token_sperre() RETURNS trigger AS $$
      BEGIN IF NEW.user_id = ${Number(uid)} THEN RAISE EXCEPTION 'gesperrt im Test'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await db.run(
      `CREATE TRIGGER regeln_token_sperre BEFORE INSERT ON api_tokens FOR EACH ROW EXECUTE FUNCTION regeln_token_sperre()`,
    );
    try {
      const r = await ruf('POST', '/login', { username: NAME, password: PASS });
      assert.deepEqual([r.status, r.body.code, 'token' in r.body], [500, 'token_nicht_ausgestellt', false]);
    } finally {
      await db.run('DROP TRIGGER regeln_token_sperre ON api_tokens');
    }
  });
});
