/**
 * Die Kontoschalter sind seit Migration 0085 BOOLEAN; nach aussen gehen sie
 * bis zum gemeinsamen API-Schema unverändert als 0/1 (die App liest
 * email_verified als Int). Geprüft an den Antwortformern in src/konto/konten.ts.
 *
 * Gegenproben (31.10.2026, gemessen):
 *   a) in kontenListe() die Abbildung weggelassen (`return repo.alleKonten()`)
 *      → rot: is_admin kommt als true/false.
 *   b) in profil() die Abbildung weggelassen → rot: email_verified kommt als false.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();

test('Kontoschalter gehen als 0/1 hinaus', async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const K = _req('src/konto/konten.js');
  const n = `schalterzahl${process.pid}`;
  const chef = (await db.get(`INSERT INTO users (username, password_hash, is_admin, email_verified)
                               VALUES ($1, 'x', true, true) RETURNING id`, [`${n}a`])).id;
  const gast = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${n}b`])).id;
  try {
    await t.test('die Kontenliste der Verwaltung', async () => {
      const liste = (await K.kontenListe()).filter(k => k.id === chef || k.id === gast);
      assert.deepEqual(liste.map(k => [k.id, k.is_admin]), [[chef, 1], [gast, 0]]);
    });
    await t.test('das eigene Profil', async () => {
      assert.equal((await K.profil(chef))?.email_verified, 1);
      assert.equal((await K.profil(gast))?.email_verified, 0);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[chef, gast]]);
    await db.pool.end();
  }
});
