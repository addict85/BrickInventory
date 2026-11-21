/**
 * Runtime state of the jobs stands in run_state, not in global_settings:
 * migration 0063 moves the keys, the image counter stays exact even under
 * concurrent calls. The tiles of the administration read the state
 * of a run from the job table, not from a second store.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  in the migration `starts_with(key, 'job_monitor_')` left out (in the
 *      INSERT and in the DELETE) → red: “migration 0063 separates state from
 *      configuration”
 *   B  countState() as read-then-write (liesZustand + setzeZustand)
 *      → red: “the image counter counts concurrent calls exactly”
 * Counter-check (05.11.2026): in letzteJeArt() `ORDER BY type, updated_at DESC`
 *   → red: „die Kachel zeigt den laufenden Auftrag“ (the younger open one won)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db/migrations/0063-laufzustand.sql'), 'utf8');
const SCHEMA = `probe0063_${process.pid}`;

test('run state separate from the configuration', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const vorher = await db.get(`SELECT value FROM run_state WHERE key = 'imgdl_pending_count'`);
  t.after(async () => {
    if (vorher) await db.run(`UPDATE run_state SET value = $1 WHERE key = 'imgdl_pending_count'`, [vorher.value]);
    else await db.run(`DELETE FROM run_state WHERE key = 'imgdl_pending_count'`);
    await db.run(`DELETE FROM run_state WHERE key = 'job_monitor_probe'`);
    await db.pool.end().catch(() => {});
  });

  await t.test('migration 0063 separates state from configuration', async () => {
    const c = await db.pool.connect();
    try {
      await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await c.query(`CREATE SCHEMA ${SCHEMA}`);
      await c.query(`SET search_path TO ${SCHEMA}, public`);
      await c.query(`CREATE TABLE global_settings (LIKE public.global_settings INCLUDING ALL)`);
      await c.query(`INSERT INTO global_settings (key, value) VALUES
        ('currency', 'CHF'), ('job_monitor_priceJob', '{"status":"running"}'),
        ('rb_csv_last_sync', '2026-10-28'), ('instr_queue_trigger', 'jetzt')`);
      await c.query(MIGRATION);
      // Migration 0063 is history and still creates the table under its
      // old name and with its old columns (laufzustand.schluessel);
      // 0124 (applied long ago) would otherwise have renamed it right afterwards, as
      // with a real order of the migrations.
      const zustand = (await c.query(`SELECT schluessel AS key FROM laufzustand ORDER BY 1`)).rows.map(r => r.key);
      const konfig = (await c.query(`SELECT key FROM global_settings ORDER BY 1`)).rows.map(r => r.key);
      assert.deepEqual(zustand, ['instr_queue_trigger', 'job_monitor_priceJob', 'rb_csv_last_sync']);
      assert.deepEqual(konfig, ['currency']);
    } finally {
      await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
      await c.query('SET search_path TO public').catch(() => {});
      c.release();
    }
  });

  const jm = _req('src/management/tiles.js');
  const { jobQueue: auftraege } = require('./helpers/sources').testServices();
  const imgDlAdd = n => auftraege.countState('imgdl_pending_count', n);

  await t.test('the tiles read the state from the job table', async () => {
    await db.run("DELETE FROM jobs WHERE type = 'preise'");
    await db.run(`INSERT INTO jobs (type, payload, status, locked_by, deadline_at, progress, updated_at)
                  VALUES ('preise', '{}', 'laeuft', 'p', NOW() + INTERVAL '1 min', '{"erledigt": 3, "gesamt": 9, "text": "10001-1"}',
                          NOW() - INTERVAL '1 min')`);
    // The next scheduled run is younger, but not the one that is currently working.
    await db.run(`INSERT INTO jobs (type, payload, dedupe_key) VALUES ('preise', '{}', 'plan:preise')`);
    const k = (await jm.tiles()).priceJob;
    assert.deepEqual(
      { status: k.status, progress: k.progress, total: k.total, sub: k.sub },
      { status: 'running', progress: 3, total: 9, sub: '10001-1' },
      'die Kachel zeigt den laufenden Auftrag',
    );
    await db.run("DELETE FROM jobs WHERE type = 'preise'");
  });

  await t.test('the image counter counts concurrent calls exactly', async () => {
    await jm.imgDlReset();
    await Promise.all(Array.from({ length: 20 }, () => imgDlAdd(1)));
    assert.equal(await jm.imgDlPending(), 20);
    await imgDlAdd(-50);
    assert.equal(await jm.imgDlPending(), 0, 'nie unter 0');
  });
});
