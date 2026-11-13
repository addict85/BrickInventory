/**
 * testServer (test/helpers/server.js) baut die App über baueApp wie server.ts: Was ein
 * Test dort prüft, läuft durch dieselbe Middleware-Kette wie im Betrieb, nicht durch
 * nachgebaute Router.
 *
 * Gegenproben (13.11.2026 gemessen, je einzeln):
 *   A  in startup/app.ts `app.use(nurEigeneHerkunft)` entfernt → rot:
 *      „fremde Herkunft mit Sitzungskeks: 403“ (200 statt 403)
 *   B  testServer wieder mit eigenen Routern (routerServer statt baueApp) → rot:
 *      alle drei Fälle (kein CSP-Kopf, keine Absage am Eingang, keine fremde Herkunft)
 *   C  in startup/app.ts die Eingangssperre (anmeldungAmEingang) aus apiEingang() entfernt
 *      → rot: „ein Verwalter ohne zweiten Faktor wird am Eingang abgewiesen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { verwalterMitFaktor } = require('./helpers/verwalter');

test('testServer läuft durch die echte Kette', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  const NAME = `kette_echt_${process.pid}`;
  await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
  const anlegen = async (/** @type {string} */ n) =>
    (await db.get(`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, 'x', true) RETURNING id`, [n])).id;
  const mit = await anlegen(NAME);
  const ohne = await anlegen(`${NAME}_ohne`);
  await verwalterMitFaktor(_req, mit);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('Sicherheitsköpfe und Anfragekennung aus grundschutz()', async () => {
    const { base } = testServer(_req, { sitzung: {}, t });
    const r = await fetch(`${base}/api/v1/health/live`);
    assert.match(String(r.headers.get('content-security-policy')), /default-src 'self'/);
    assert.match(String(r.headers.get('x-request-id')), /\S/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  await t.test('fremde Herkunft mit Sitzungskeks: 403', async () => {
    const { base } = testServer(_req, { sitzung: { userId: mit, isAdmin: true }, t });
    const sende = (/** @type {string} */ herkunft) =>
      fetch(`${base}/api/v1/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'bim.sid=x', Origin: herkunft },
        body: '{}',
      });
    const fremd = await sende('https://boese.example');
    assert.equal(fremd.status, 403, 'fremde Herkunft mit Sitzungskeks: 403');
    assert.equal((await fremd.json()).code, 'fremde_herkunft');
    assert.notEqual(
      (await (await sende(base)).json().catch(() => ({}))).code,
      'fremde_herkunft',
      'die eigene Herkunft kommt durch, sonst bewiese die 403 oben nichts',
    );
  });

  await t.test('ein Verwalter ohne zweiten Faktor wird am Eingang abgewiesen', async () => {
    const jobs = async (/** @type {number} */ id) =>
      fetch(`${testServer(_req, { sitzung: { userId: id, isAdmin: true }, t }).base}/api/v1/admin/jobs`);
    const r = await jobs(ohne);
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'zweiter_faktor_pflicht');
    assert.equal((await jobs(mit)).status, 200, 'mit zweitem Faktor kommt er durch');
  });
});
