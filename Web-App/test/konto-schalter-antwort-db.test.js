/**
 * Die Kontoschalter gehen als true/false hinaus, wie sie seit Migration 0085
 * in der Datenbank stehen: is_admin in der Kontenliste der Verwaltung,
 * email_verified im eigenen Profil (API-Fassung 2). Geprüft an den Routen,
 * damit auch der Vertrag (src/vertrag/) mitläuft.
 *
 * Gegenproben (31.10.2026, gemessen):
 *   a) in kontenListe() wieder `is_admin: k.is_admin ? 1 : 0` → rot: „die
 *      Kontenliste der Verwaltung“ (1 statt true; der Vertrag meldet 500)
 *   b) in profil() wieder `email_verified: p.email_verified ? 1 : 0` → rot:
 *      „das eigene Profil“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('Kontoschalter gehen als true/false hinaus', async t => {
  const db = testDaten();
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const n = `schalterzahl${process.pid}`;
  const chef = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, email_verified)
                               VALUES ($1, 'x', true, true) RETURNING id`,
      [`${n}a`],
    )
  ).id;
  const gast = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${n}b`]))
    .id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[chef, gast]]);
    await db.pool.end();
  });
  let als = chef;
  const sitzung = {};
  Object.defineProperty(sitzung, 'userId', { get: () => als, enumerable: true });
  Object.defineProperty(sitzung, 'isAdmin', { get: () => als === chef, enumerable: true });
  const { base } = testServer(_req, { sitzung, routen: { '/api/v1/auth': 'routes/auth.js' }, t });
  const hole = async pfad => {
    const r = await fetch(base + pfad);
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };

  await t.test('die Kontenliste der Verwaltung', async () => {
    als = chef;
    const liste = (await hole('/api/v1/auth/users')).users.filter(k => k.id === chef || k.id === gast);
    assert.deepEqual(
      liste.map(k => [k.id, k.is_admin]),
      [
        [chef, true],
        [gast, false],
      ],
    );
  });
  await t.test('das eigene Profil', async () => {
    als = chef;
    assert.equal((await hole('/api/v1/auth/profile')).user.email_verified, true);
    als = gast;
    assert.equal((await hole('/api/v1/auth/profile')).user.email_verified, false);
  });
});
