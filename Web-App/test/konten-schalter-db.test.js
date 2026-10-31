/**
 * Die Schalter eines Kontos (is_admin, is_active, email_verified) sind 0 oder
 * 1 und nie leer, und eine E-Mail-Adresse gibt es nur einmal — ohne Rücksicht
 * auf Gross- und Kleinschreibung (Migration 0069). Der Code prüfte das schon
 * mit LOWER(email); die Datenbank kannte nur die genaue Schreibweise.
 *
 * Gegenproben (am 29.10.2026 gemessen, je auf frischer Datenbank):
 *   A  den Block mit users_email_lower aus 0069 entfernt → rot: „eine Adresse
 *      gibt es nur einmal, gleich in welcher Schreibweise“
 *   B  die CHECK-Schranken aus 0069 entfernt → rot: „ein Schalter ist 0 oder 1“
 *   C  `SET NOT NULL` für is_admin entfernt → rot: „ein Schalter ist nie leer“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('Kontoschalter und eindeutige Adresse', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  const K = `schalter${process.pid}`;
  const leeren = () => db.run('DELETE FROM users WHERE username LIKE $1', [`${K}%`]);
  const lege = (n, extra = '', werte = []) =>
    db.get(`INSERT INTO users (username, password_hash${extra ? ', ' + extra : ''})
            VALUES ($1, 'x'${werte.map((_, i) => `, $${i + 2}`).join('')}) RETURNING *`, [`${K}${n}`, ...werte]);
  await leeren();

  try {
    await t.test('ohne Angabe gelten die Vorgaben', async () => {
      const u = await lege('a');
      assert.deepEqual([u.is_admin, u.is_active, u.email_verified], [0, 1, 0]);
    });
    await t.test('ein Schalter ist nie leer', async () => {
      await assert.rejects(lege('b', 'is_admin', [null]), (e) => e.code === '23502');
      await assert.rejects(lege('c', 'is_active', [null]), (e) => e.code === '23502');
    });
    await t.test('ein Schalter ist 0 oder 1', async () => {
      await assert.rejects(lege('d', 'is_admin', [2]), (e) => e.code === '23514');
      await assert.rejects(lege('e', 'email_verified', [-1]), (e) => e.code === '23514');
    });
    await t.test('eine Adresse gibt es nur einmal, gleich in welcher Schreibweise', async () => {
      await lege('f', 'email', [`${K}@Beispiel.ch`]);
      await assert.rejects(lege('g', 'email', [`${K.toUpperCase()}@beispiel.CH`]), (e) => e.code === '23505');
      assert.ok(await lege('h', 'email', [null]));
      assert.ok(await lege('i', 'email', [null]), 'ohne Adresse dürfen es mehrere sein');
    });
  } finally {
    await leeren();
    await db.pool.end().catch(() => {});
  }
});
