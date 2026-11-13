/**
 * Gleichzeitige Tausche desselben Tokens: Genau einer bekommt einen neuen
 * Token, die übrigen 409 tausch_laeuft; der ausgegebene gilt. Ein zweiter
 * Tausch aus einem anderen /24-Netz gilt als Kopie und beendet die Familie.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  in rotiereToken() die Zeile `if (offen && offen.alter_s < TAUSCH_SPERRE_S)`
 *      entfernt → rot: „sechs gleichzeitige Tausche …“ (6× 200, nur der
 *      letzte gilt)
 *   B  den Zweig zum anderen Netz entfernt → rot: „ein zweiter Tausch aus
 *      einem anderen Netz …“ (der alte Token tauschte weiter)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const auth = _req('src/konto/geraeteToken.js');
const tokenCache = _req('src/konto/tokenCache.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('Tausch desselben Tokens', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  const NAME = `tausch_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  const app = express();
  app.use(express.json());
  app.use('/api/v1', _req('routes/api_v1/middleware.js').anmeldungAmEingang);
  app.use('/api/v1', require('./helpers/sources').routerAus(_req, 'routes/api_v1/index.js'));
  app.use('/api/v1/auth', require('./helpers/sources').routerAus(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://127.0.0.1:${srv.address().port}`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const ruf = async (weg, token, method = 'GET') => {
    const r = await fetch(basis + '/api/v1' + weg, { method, headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  await t.test('sechs gleichzeitige Tausche: einer neu, die anderen 409', async () => {
    const alt = await auth.createToken(uid, 'Telefon', true, null, { scope: 'app', ip: '127.0.0.1' });
    const antworten = await Promise.all(Array.from({ length: 6 }, () => ruf('/auth/token-rotieren', alt, 'POST')));
    const stand = JSON.stringify(antworten.map(a => [a.status, a.body?.code]));
    const neu = antworten.filter(a => a.status === 200);
    assert.equal(neu.length, 1, stand);
    assert.ok(
      antworten.filter(a => a.status !== 200).every(a => a.status === 409 && a.body.code === 'tausch_laeuft'),
      stand,
    );
    tokenCache.leereTokenCache();
    assert.equal((await ruf('/stats', neu[0].body.token)).status, 200, 'der ausgegebene Token gilt');
  });

  await t.test('ein zweiter Tausch aus einem anderen Netz beendet die Familie', async () => {
    const alt = await auth.createToken(uid, 'Tablet', true, null, { scope: 'app', ip: '10.1.2.3' });
    const erster = await auth.rotiereToken(alt, '10.1.2.77');
    assert.ok(erster && typeof erster === 'object', 'Vorbedingung: der erste Tausch gelingt');
    await db.run(`UPDATE api_tokens SET rotiert_am = NOW() - INTERVAL '1 minute' WHERE token = $1`, [
      auth.hashToken(erster.token),
    ]);
    assert.equal(await auth.rotiereToken(alt, '192.0.2.5'), null);
    tokenCache.leereTokenCache();
    assert.equal(await auth.validateToken(erster.token), null, 'der Nachfolger ist weg');
    assert.equal(await auth.validateToken(alt), null, 'der alte ist weg');
  });
});
