/**
 * The rebuild of the parts summary avoids a database lock
 * that another process holds for the same account — it then writes nothing.
 * Without the lock two processes with DELETE + INSERT collided on the same
 * primary key (parts_summary_pkey).
 *
 * Counter-checks (31.10.2026, measured):
 *   a) in rebuild() the check `if (!(await repo.lockAccount(…)))` removed
 *      → red: the foreign row is gone and the state stands at 7.
 *   b) in lockAccount() LOCKS.PARTS_CATALOG instead of LOCKS.PARTS_SUMMARY → red (like a).
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');

test('rebuild gives way to a held account lock', async t => {
  const db = testData();
  try {
    await db.initSchemaOnce();
  } catch (e) {
    noDb(t, e);
    return;
  }
  const PS = _req('src/parts/summary.js');
  const { LOCKS } = _req('src/infra/lockNamespaces.js');
  const u = (
    await db.get(`INSERT INTO users (username, password_hash) VALUES ('sperre_'||floor(random()*1e9),'x') RETURNING id`)
  ).id;
  const state = async () => ({
    zeilen: (await db.get('SELECT COUNT(*)::int AS n FROM parts_summary WHERE user_id = $1', [u])).n,
    version:
      (await db.get('SELECT built_version::int AS built_version FROM parts_summary_state WHERE user_id = $1', [u]))
        ?.built_version ?? null,
  });
  const halter = await db.pool.connect();
  try {
    await db.run(`INSERT INTO parts_summary (user_id, part_key, color_id, total_quantity) VALUES ($1, 'fremd', 1, 3)`, [
      u,
    ]);
    await halter.query('BEGIN');
    await halter.query('SELECT pg_advisory_xact_lock($1, $2)', [LOCKS.PARTS_SUMMARY, u]);
    await PS.rebuildSummary(u, { v: 7 });
    assert.deepEqual(await state(), { zeilen: 1, version: null }, 'While the lock is held nothing may be written');
    await halter.query('COMMIT');

    await PS.rebuildSummary(u, { v: 7 });
    assert.deepEqual(await state(), { zeilen: 0, version: 7 }, 'Without a lock rebuild builds anew');
  } finally {
    await halter.query('ROLLBACK').catch(() => {});
    halter.release();
    await db.run('DELETE FROM users WHERE id = $1', [u]);
    await db.pool.end();
  }
});
