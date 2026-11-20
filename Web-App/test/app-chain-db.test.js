/**
 * Die echte Kette vor /api/v1 (startup/app.ts, apiInbox) in einem Prozess:
 * Anmeldepflicht und Rumpflimit hängen voneinander ab — unangemeldet gibt es
 * nur 16 KB, angemeldet 256 KB, und eine abgewiesene Anfrage liest ihren Rumpf nicht.
 *
 * Gegenproben (am 11.11.2026 gemessen):
 *   A  in apiInbox() `readBody` vor `loginAtInbox` gehängt → rot:
 *      „unangemeldet: 401 vor dem Rumpf“ (413 statt 401, der Rumpf wurde gelesen)
 *   B  in routes/api_v1/middleware.ts das Limit für Unangemeldete auf 256kb → rot:
 *      „unangemeldet: mehr als 16 KB sind zu viel“
 *   C  in apiInbox() `loginAtInbox` nicht eingehängt → rot:
 *      „unangemeldet: 401 vor dem Rumpf“ (die Route antwortete selbst)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

const json = n => JSON.stringify({ username: 'x', password: 'y', fill: 'a'.repeat(n) });
const post = (base, pfad, rumpf) =>
  fetch(base + pfad, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: rumpf });

test('login and body limit in the real chain', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const name = `kette_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [name])).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}));

  const ohne = testServer(_req, { sitzung: {}, t });
  const mit = testServer(_req, { sitzung: { userId: uid, username: name }, t });

  await t.test('unauthenticated: 401 before the body', async () => {
    const r = await post(ohne.base, '/api/v1/sets', json(300 * 1024));
    assert.equal(r.status, 401);
  });

  await t.test('unauthenticated: more than 16 KB is too much', async () => {
    assert.equal((await post(ohne.base, '/api/v1/auth/login', json(20 * 1024))).status, 413);
    assert.notEqual(
      (await post(ohne.base, '/api/v1/auth/login', json(1024))).status,
      413,
      'ein kleiner Rumpf muss durchkommen, sonst bewiese die 413 oben nichts',
    );
  });

  await t.test('authenticated: 20 KB go through, 300 KB do not', async () => {
    const klein = await post(mit.base, '/api/v1/sets', json(20 * 1024));
    assert.notEqual(klein.status, 413);
    assert.notEqual(klein.status, 401, 'die gestellte Sitzung kam nicht an');
    assert.equal((await post(mit.base, '/api/v1/sets', json(300 * 1024))).status, 413);
  });
});
