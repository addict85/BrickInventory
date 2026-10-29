/**
 * Laufzeitzustand der Jobs steht in laufzustand, nicht in global_settings:
 * Migration 0063 zieht die Schlüssel um, der Jobmonitor schreibt dorthin, und
 * der Bildzähler bleibt auch unter gleichzeitigen Aufrufen genau.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in der Migration `starts_with(key, 'job_monitor_')` weggelassen (im
 *      INSERT und im DELETE) → rot: „Migration 0063 trennt Zustand von
 *      Konfiguration“
 *   B  zaehleZustand() als Lesen-dann-Schreiben (liesZustand + setzeZustand)
 *      → rot: „der Bildzähler zählt gleichzeitige Aufrufe genau“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0063-laufzustand.sql'), 'utf8');
const SCHEMA = `probe0063_${process.pid}`;

test('Laufzustand getrennt von der Konfiguration', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  {
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  }
  const vorher = await db.get(`SELECT wert FROM laufzustand WHERE schluessel = 'imgdl_pending_count'`);
  t.after(async () => {
    if (vorher) await db.run(`UPDATE laufzustand SET wert = $1 WHERE schluessel = 'imgdl_pending_count'`, [vorher.wert]);
    else await db.run(`DELETE FROM laufzustand WHERE schluessel = 'imgdl_pending_count'`);
    await db.run(`DELETE FROM laufzustand WHERE schluessel = 'job_monitor_probe'`);
    await db.pool.end().catch(() => {});
  });

  await t.test('Migration 0063 trennt Zustand von Konfiguration', async () => {
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
      const zustand = (await c.query(`SELECT schluessel FROM laufzustand ORDER BY 1`)).rows.map(r => r.schluessel);
      const konfig = (await c.query(`SELECT key FROM global_settings ORDER BY 1`)).rows.map(r => r.key);
      assert.deepEqual(zustand, ['instr_queue_trigger', 'job_monitor_priceJob', 'rb_csv_last_sync']);
      assert.deepEqual(konfig, ['currency']);
    } finally {
      await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
      await c.query('SET search_path TO public').catch(() => {});
      c.release();
    }
  });

  const jm = _req('utils/jobMonitor.js');

  await t.test('der Jobmonitor schreibt in laufzustand', async () => {
    await jm.update('probe', { status: 'running', progress: 3 });
    for (let i = 0; i < 40 && !(await db.get(`SELECT 1 FROM laufzustand WHERE schluessel = 'job_monitor_probe'`)); i++)
      await new Promise(r => setTimeout(r, 25));
    assert.equal((await jm.all()).probe.progress, 3);
    assert.equal(await db.get(`SELECT 1 FROM global_settings WHERE key LIKE 'job_monitor_%'`), undefined);
  });

  await t.test('der Bildzähler zählt gleichzeitige Aufrufe genau', async () => {
    await jm.imgDlReset();
    await Promise.all(Array.from({ length: 20 }, () => jm.imgDlAdd(1)));
    assert.equal(await jm.imgDlPending(), 20);
    await jm.imgDlAdd(-50);
    assert.equal(await jm.imgDlPending(), 0, 'nie unter 0');
  });
});
