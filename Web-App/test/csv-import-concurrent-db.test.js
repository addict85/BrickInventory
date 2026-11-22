/**
 * @einzeln: writes data/<tabelle>.csv.tmp, which the other CSV import file
 * also uses; in parallel one cleared the file away from the other.
 *
 * Two concurrent catalog imports of the same table — against a real database.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The name of the shadow table (`<tabelle>_import`) derives solely from the
 * table name, so it is the same for ALL runs. Two concurrent
 * imports of the same table are reachable: the daily run calls csvSync.run(),
 * and an admin can trigger /admin/trigger-csv-sync in parallel — the latch
 * `_csvSyncRunning` in server.ts only protects the manual path against itself
 * and lives in the memory of ONE process anyway.
 *
 * Before an earlier round one of the two runs then failed at CREATE with
 * “duplicate key value violates unique constraint pg_type_typname_nsp_index" —
 * an error that reveals nothing about the cause. In csvSync.run() that aborts
 * the whole pass, the daily marker stays unset.
 *
 * Since then a Postgres advisory lock per table serializes: the second
 * run WAITS and then runs through cleanly. Different tables may
 * still be imported in parallel.
 *
 * What is checked is BEHAVIOR (both runs succeed, final stock complete), not
 * the wording of the code. Counter-check (performed): pg_advisory_lock removed
 * (today pg_advisory_xact_lock in src/catalog/repository/csvSwap.ts) → the test turns red, one run fails with
 * exactly the message above.
 *
 * Prerequisite: test DB (content is changed!) via TEST_DATABASE_URL.
 * Without DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();

test('two concurrent imports of the same table do not collide', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }

  const { TASKS } = _req('jobs/csvImportWorker.js');
  const DATA_DIR = _req('src/infra/appPaths.js').DATA_DIR;

  await db.run(`CREATE TABLE IF NOT EXISTS rb_colors (
    id INTEGER PRIMARY KEY, name TEXT, rgb TEXT, is_trans TEXT, bl_color_id INTEGER)`);
  await db.run(`DROP TABLE IF EXISTS rb_colors_import`);
  await db.run(`DELETE FROM rb_colors`);

  // Big enough that the two runs overlap in time — with a
  // handful of lines the first would be done before the second begins, and the
  // test would be green even without a lock.
  const ROWS = 30000;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const csv = ['id,name,rgb,is_trans'];
  for (let i = 1; i <= ROWS; i++) csv.push(`${i},farbe-${i},AABBCC,f`);
  fs.writeFileSync(path.join(DATA_DIR, 'colors.csv.tmp'), csv.join('\n') + '\n', 'utf8');

  try {
    const results = await Promise.allSettled([TASKS.colors(), TASKS.colors()]);

    const gescheitert = results.filter(r => r.status === 'rejected');
    assert.equal(
      gescheitert.length,
      0,
      `beide Läufe müssen durchlaufen — gescheitert: ${gescheitert.map(r => r.reason.message).join(' | ')}`,
    );

    for (const r of results) {
      assert.equal(r.status === 'fulfilled' && r.value, ROWS, 'jeder Lauf muss alle Zeilen gelesen haben');
    }

    // The final stock corresponds to exactly ONE run — no mixture, nothing missing.
    const n = (await db.get('SELECT count(*)::int AS n FROM rb_colors')).n;
    assert.equal(n, ROWS, `Endbestand unvollständig: ${n} statt ${ROWS} Zeilen`);
  } finally {
    await db.run(`DROP TABLE IF EXISTS rb_colors_import`).catch(() => {});
    await db.run(`DELETE FROM rb_colors`).catch(() => {});
    fs.rmSync(path.join(DATA_DIR, 'colors.csv.tmp'), { force: true });
    await db.pool.end().catch(() => {});
  }
});
