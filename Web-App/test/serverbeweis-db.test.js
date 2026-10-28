/**
 * Der Server beweist der App, dass er ihren Token kennt — ohne ihn zu senden.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  HMAC-Schlüssel auf eine feste Zeichenkette statt des Token-Hashs →
 *      rot: „der echte Server unterschreibt mit dem Token-Hash"
 *   B  die Ablaufprüfung `expires_at > NOW()` entfernt → rot: „ein
 *      abgelaufener Token gibt keinen Beweis"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const { createToken, hashToken } = _req('utils/auth.js');

test('Serverbeweis für Klartext-Verbindungen der App', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const NAME = `beweis-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const token = await createToken(uid, 'Test', true);
  const { base } = testServer(_req, { routen: { '/api/v1/auth': 'routes/auth.js' }, t });
  const frage = (body) => fetch(`${base}/api/v1/auth/serverbeweis`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const nonce = crypto.randomBytes(16).toString('hex');
  const kennung = hashToken(token).slice(0, 16);

  try {
    await t.test('der echte Server unterschreibt mit dem Token-Hash', async () => {
      const r = await frage({ kennung, nonce });
      assert.equal(r.status, 200);
      const erwartet = crypto.createHmac('sha256', hashToken(token)).update(nonce).digest('hex');
      assert.equal((await r.json()).beweis, erwartet);
    });

    await t.test('fremde Kennung und kaputte Eingaben', async () => {
      assert.equal((await frage({ kennung: '0'.repeat(16), nonce })).status, 404);
      assert.equal((await frage({ kennung: 'xyz', nonce })).status, 400);
      assert.equal((await frage({ kennung, nonce: 'kurz' })).status, 400);
    });

    await t.test('ein abgelaufener Token gibt keinen Beweis', async () => {
      await db.run(`UPDATE api_tokens SET expires_at = NOW() - INTERVAL '1 day' WHERE token=$1`, [hashToken(token)]);
      assert.equal((await frage({ kennung, nonce })).status, 404);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.pool.end().catch(() => {});
  }
});
