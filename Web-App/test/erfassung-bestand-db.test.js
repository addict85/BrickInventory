/**
 * Eine Set-Erfassung gehört zu einer Bestandszeile — die Datenbank prüft es
 * (Migration 0045), nicht mehr nur die drei Löschstellen.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  den Fremdschlüssel in 0045 weggelassen → rot: „eine Erfassung ohne
 *      Bestandszeile scheitert beim COMMIT"
 *   B  den Fremdschlüssel ohne DEFERRABLE → rot: „innerhalb einer Transaktion
 *      darf die Erfassung vor dem Bestand kommen"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const NAME = `erfbest_${process.pid}`, SET = '99074-1';

test('Erfassung und Bestand', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', 1, 1) RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM set_acquisitions WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const erfassung = (tx, menge = 1) => tx.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, condition) VALUES ($1, $2, $3, 'N')`, [uid, SET, menge]);

  await t.test('eine Erfassung ohne Bestandszeile scheitert beim COMMIT', async () => {
    await assert.rejects(db.transaction(tx => erfassung(tx)), /set_acquisitions_bestand_fkey/);
    assert.equal((await db.get('SELECT count(*)::int AS n FROM set_acquisitions WHERE user_id = $1', [uid])).n, 0);
  });

  await t.test('innerhalb einer Transaktion darf die Erfassung vor dem Bestand kommen', async () => {
    await db.transaction(async (tx) => {
      await erfassung(tx);
      await tx.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, SET]);
    });
    assert.equal((await db.get('SELECT count(*)::int AS n FROM set_acquisitions WHERE user_id = $1', [uid])).n, 1);
  });

  await t.test('Menge null oder unbekannter Zustand werden abgewiesen', async () => {
    await assert.rejects(db.transaction(tx => erfassung(tx, 0)), /set_acquisitions_menge_positiv/);
    await assert.rejects(db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, condition) VALUES ($1, $2, 1, 'X')`, [uid, SET]),
      /set_acquisitions_zustand/);
  });

  await t.test('den Bestand löschen, solange Erfassungen da sind, scheitert', async () => {
    await assert.rejects(db.run('DELETE FROM sets WHERE user_id = $1 AND set_number = $2', [uid, SET]),
      /set_acquisitions_bestand_fkey/);
  });
});
