/**
 * Rules of the login on the real route (routes/auth.ts) and test DB: the
 * QR access is a one-time nonce with the duration the server states; the
 * profile checks the username like login and registration; if storing
 * the token fails, the app gets an error instead of a half success.
 *
 * Counter-checks (measured 08.11.2026, each on its own):
 *   A  in loeseQrTokenEin `AND used_at IS NULL` deleted → red: “QR access:
 *      one-time …” (today melde() in src/account/repository/qrPairing.ts)
 *   B  in POST /qr-token `expires_in: 1800` → red: the same check
 *   C  in PUT /profile the check with USERNAME_RE deleted → red:
 *      “profile: username …”; nameTaken() without LOWER() → red: there
 *   D  in signedInResponses `if (!token) return sendError(…)` deleted
 *      → red: “no half success without a stored token”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
const { pairQr } = require('./helpers/qr');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test('rules of the login', { concurrency: 1, timeout: 60_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `regeln_${process.pid}`,
    NEIGHBOR = `Nachbar_${process.pid}`,
    PASS = 'Regeln-Passwort-1';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, NEIGHBOR]]);
  const anlegen = async n =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
        [n, `${n.toLowerCase()}@example.org`, await bcrypt.hash(PASS, 4)],
      )
    ).id;
  const uid = await anlegen(NAME);
  await anlegen(NEIGHBOR);
  t.after(async () => {
    await db.run('DROP TRIGGER IF EXISTS regeln_token_sperre ON api_tokens').catch(() => {});
    await db.run('DROP FUNCTION IF EXISTS regeln_token_sperre()').catch(() => {});
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, NEIGHBOR]]);
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME }, t });
  const callFn = async (methode, path, body) => {
    const r = await fetch(`${base}/api/v2/auth${path}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  await t.test("QR access: one-time, without password material, with the server's duration", async () => {
    const qr = await callFn('POST', '/qr-token', { password: PASS });
    assert.equal(qr.status, 200, JSON.stringify(qr.body));
    assert.equal(qr.body.expires_in, 300, 'Die Oberfläche zählt von dieser Dauer herunter');
    assert.doesNotMatch(JSON.stringify(qr.body), /\$2[aby]\$/, 'Ein bcrypt-Hash im QR-Code ist offline knackbar');
    const erst = await pairQr((p, body) => callFn('POST', p, body), qr.body);
    assert.equal(erst.status, 200, JSON.stringify(erst.body));
    assert.equal(erst.body.userId, uid);
    const zweit = await callFn('POST', '/qr-login', { token: qr.body.token });
    assert.equal(zweit.status, 401, 'Derselbe Code öffnet das Konto ein zweites Mal');
  });

  await t.test('profile: username by the same rule and regardless of case', async () => {
    const ungueltig = await callFn('PUT', '/profile', { username: 'a b', password_current: PASS });
    assert.deepEqual([ungueltig.status, ungueltig.body.code], [400, 'username_invalid']);
    const mail = await callFn('PUT', '/profile', { username: 'x@example.org', password_current: PASS });
    assert.equal(mail.status, 400, 'Eine E-Mail-Adresse als Benutzername — der Login sucht beides');
    const vergeben = await callFn('PUT', '/profile', { username: NEIGHBOR.toLowerCase(), password_current: PASS });
    assert.deepEqual([vergeben.status, vergeben.body.code], [400, 'username_taken']);
    assert.equal((await db.get('SELECT username FROM users WHERE id = $1', [uid])).username, NAME);
  });

  await t.test('no half success without a stored token', async () => {
    await db.run(`CREATE OR REPLACE FUNCTION regeln_token_sperre() RETURNS trigger AS $$
      BEGIN IF NEW.user_id = ${Number(uid)} THEN RAISE EXCEPTION 'gesperrt im Test'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await db.run(
      `CREATE TRIGGER regeln_token_sperre BEFORE INSERT ON api_tokens FOR EACH ROW EXECUTE FUNCTION regeln_token_sperre()`,
    );
    try {
      const r = await callFn('POST', '/login', { username: NAME, password: PASS });
      assert.deepEqual([r.status, r.body.code, 'token' in r.body], [500, 'token_not_issued', false]);
    } finally {
      await db.run('DROP TRIGGER regeln_token_sperre ON api_tokens');
    }
  });
});
