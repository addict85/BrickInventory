/**
 * Die Idempotenz-Middleware antwortet aus dem Speicher, bevor die Route ihren
 * Verwalter-Wächter (requireApiAdmin) prüft. Eine gespeicherte Verwalter-Antwort
 * darf deshalb nicht einem App-Token desselben Kontos ausgeliefert werden.
 * Geprüft an der echten Kette vor /api/v1 (apiEingang) mit echten Tokens.
 *
 * Gegenprobe (13.11.2026 gemessen):
 *   A  in middleware.ts die Rolle nicht an fingerabdruck() übergeben → rot:
 *      „ein App-Token bekommt die Verwalter-Antwort nicht“ (200 mit
 *      Idempotent-Replay statt 422)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { zugangOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { verwalterMitFaktor } = require('./helpers/verwalter');

const ROUTEN = { '/api/v1': 'routes/api_v1/index.js' };

test('Idempotenz: Verwalter-Antworten nur für die Verwalterrolle', { concurrency: 1 }, async t => {
  const db = await zugangOderSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const name = `idem_rolle_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified, is_admin)
       VALUES ($1, 'x', true, true, true) RETURNING id`,
      [name],
    )
  ).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}));
  await verwalterMitFaktor(_req, uid);
  const appToken = await _req('src/konto/geraeteToken.js').createToken(uid, 'Rollen-Probe', false, null, {
    scope: 'app',
  });

  const sitzung = { userId: uid, username: name, isAdmin: true, mussPasswortAendern: false };
  const verwalter = testServer(_req, { sitzung, routen: ROUTEN, t, kette: true });
  const ohne = testServer(_req, { sitzung: {}, routen: ROUTEN, t, kette: true });

  const schluessel = `rolle-${process.pid}-${Date.now()}`;
  const senden = (base, kopf = {}) =>
    fetch(`${base}/api/v1/admin/default-condition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': schluessel, ...kopf },
      body: JSON.stringify({ condition: 'U' }),
    });

  const erst = await senden(verwalter.base);
  assert.equal(erst.status, 200, 'die Verwalter-Anfrage selbst geht durch');
  assert.equal((await erst.json()).condition, 'U');

  const nochmal = await senden(verwalter.base);
  assert.equal(nochmal.headers.get('idempotent-replay'), 'true', 'dieselbe Rolle bekommt die Wiederholung');

  const app = await senden(ohne.base, { Authorization: `Bearer ${appToken}` });
  assert.notEqual(app.headers.get('idempotent-replay'), 'true', 'ein App-Token bekommt die Verwalter-Antwort nicht');
  assert.equal(app.status, 422, 'ein App-Token bekommt die Verwalter-Antwort nicht');
  assert.equal((await app.json()).code, 'idempotenz_schluessel_anders');
});
