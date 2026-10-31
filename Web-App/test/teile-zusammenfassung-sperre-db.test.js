/**
 * Der Neuaufbau der Teile-Zusammenfassung weicht einer Datenbank-Sperre aus,
 * die ein anderer Prozess für dasselbe Konto hält — er schreibt dann nichts.
 * Ohne die Sperre stiessen zwei Prozesse mit DELETE + INSERT auf denselben
 * Primärschlüssel (parts_summary_pkey).
 *
 * Gegenproben (31.10.2026, gemessen):
 *   a) in rebuild() die Prüfung `if (!(await repo.sperreKonto(…)))` entfernt
 *      → rot: Die fremde Zeile ist weg und der Stand steht auf 7.
 *   b) in sperreKonto() LOCKS.TEILE_KATALOG statt LOCKS.TEILE_SUMMARY → rot (wie a).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();

test('rebuild weicht einer gehaltenen Kontosperre aus', async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const PS = _req('src/teile/partsSummary.js');
  const { LOCKS } = _req('src/infra/lockNamespaces.js');
  const u = (await db.get(`INSERT INTO users (username, password_hash) VALUES ('sperre_'||floor(random()*1e9),'x') RETURNING id`)).id;
  const stand = async () => ({
    zeilen: (await db.get('SELECT COUNT(*)::int AS n FROM parts_summary WHERE user_id = $1', [u])).n,
    version: (await db.get('SELECT built_version::int AS built_version FROM parts_summary_state WHERE user_id = $1', [u]))?.built_version ?? null,
  });
  const halter = await db.pool.connect();
  try {
    await db.run(`INSERT INTO parts_summary (user_id, part_key, color_id, total_quantity) VALUES ($1, 'fremd', 1, 3)`, [u]);
    await halter.query('BEGIN');
    await halter.query('SELECT pg_advisory_xact_lock($1, $2)', [LOCKS.TEILE_SUMMARY, u]);
    await PS.rebuild(u, { v: 7 });
    assert.deepEqual(await stand(), { zeilen: 1, version: null }, 'Bei gehaltener Sperre darf nichts geschrieben werden');
    await halter.query('COMMIT');

    await PS.rebuild(u, { v: 7 });
    assert.deepEqual(await stand(), { zeilen: 0, version: 7 }, 'Ohne Sperre baut rebuild neu');
  } finally {
    await halter.query('ROLLBACK').catch(() => {});
    halter.release();
    await db.run('DELETE FROM users WHERE id = $1', [u]);
    await db.pool.end();
  }
});
