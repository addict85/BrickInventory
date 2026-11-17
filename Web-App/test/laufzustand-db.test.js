/**
 * Laufzeitzustand der Jobs steht in run_state, nicht in global_settings:
 * Migration 0063 zieht die Schlüssel um, der Bildzähler bleibt auch unter
 * gleichzeitigen Aufrufen genau. Die Kacheln der Verwaltung lesen den Stand
 * eines Laufs aus der Auftragstabelle, nicht aus einem zweiten Speicher.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in der Migration `starts_with(key, 'job_monitor_')` weggelassen (im
 *      INSERT und im DELETE) → rot: „Migration 0063 trennt Zustand von
 *      Konfiguration“
 *   B  zaehleZustand() als Lesen-dann-Schreiben (liesZustand + setzeZustand)
 *      → rot: „der Bildzähler zählt gleichzeitige Aufrufe genau“
 * Gegenprobe (05.11.2026): in letzteJeArt() `ORDER BY type, updated_at DESC`
 *   → rot: „die Kachel zeigt den laufenden Auftrag“ (der jüngere offene gewann)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db/migrations/0063-run_state.sql'), 'utf8');
const SCHEMA = `probe0063_${process.pid}`;

test('Laufzustand getrennt von der Konfiguration', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;
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
    if (vorher)
      await db.run(`UPDATE run_state SET value = $1 WHERE key = 'imgdl_pending_count'`, [vorher.value]);
    else await db.run(`DELETE FROM run_state WHERE key = 'imgdl_pending_count'`);
    await db.run(`DELETE FROM run_state WHERE key = 'job_monitor_probe'`);
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
      const zustand = (await c.query(`SELECT key FROM run_state ORDER BY 1`)).rows.map(r => r.key);
      const konfig = (await c.query(`SELECT key FROM global_settings ORDER BY 1`)).rows.map(r => r.key);
      assert.deepEqual(zustand, ['instr_queue_trigger', 'job_monitor_priceJob', 'rb_csv_last_sync']);
      assert.deepEqual(konfig, ['currency']);
    } finally {
      await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
      await c.query('SET search_path TO public').catch(() => {});
      c.release();
    }
  });

  const jm = _req('src/verwaltung/kacheln.js');
  const { jobs } = require('./helpers/sources').testDienste();
  const imgDlAdd = n => jobs.zaehleZustand('imgdl_pending_count', n);

  await t.test('die Kacheln lesen den Stand aus der Auftragstabelle', async () => {
    await db.run("DELETE FROM jobs WHERE type = 'preise'");
    await db.run(`INSERT INTO jobs (type, payload, status, locked_by, deadline_at, progress, updated_at)
                  VALUES ('preise', '{}', 'laeuft', 'p', NOW() + INTERVAL '1 min', '{"erledigt": 3, "gesamt": 9, "text": "10001-1"}',
                          NOW() - INTERVAL '1 min')`);
    // Der nächste geplante Lauf ist jünger, aber nicht der, der gerade arbeitet.
    await db.run(`INSERT INTO jobs (type, payload, dedupe_key) VALUES ('preise', '{}', 'plan:preise')`);
    const k = (await jm.kacheln()).priceJob;
    assert.deepEqual(
      { status: k.status, progress: k.progress, total: k.total, sub: k.sub },
      { status: 'running', progress: 3, total: 9, sub: '10001-1' },
      'die Kachel zeigt den laufenden Auftrag',
    );
    await db.run("DELETE FROM jobs WHERE type = 'preise'");
  });

  await t.test('der Bildzähler zählt gleichzeitige Aufrufe genau', async () => {
    await jm.imgDlReset();
    await Promise.all(Array.from({ length: 20 }, () => imgDlAdd(1)));
    assert.equal(await jm.imgDlPending(), 20);
    await imgDlAdd(-50);
    assert.equal(await jm.imgDlPending(), 0, 'nie unter 0');
  });
});
