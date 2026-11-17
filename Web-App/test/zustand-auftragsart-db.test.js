/**
 * Migration 0109: Zustand ist in Merkliste, Preisalarm und Preisspeichern
 * 'N' oder 'U', Auftragsarten stehen in job_types. Die Migration läuft auf
 * einem Altbestand in einem eigenen Schema (search_path); danach prüft der Test
 * die Regeln an der echten Datenbank.
 *
 * Gegenproben (am 11.11.2026 gemessen):
 *   A  das UPDATE wanted … der Migration entfernt → rot: „Merkliste: andere
 *      Schreibweise wird berichtigt …“ ('2-1' fehlt)
 *   B  im UPDATE wanted die Bedingung `w.id = (SELECT min(y.id) …)` entfernt →
 *      rot: die Migration scheitert an wanted_user_id_set_number_condition_key
 *   C  in startup/verdrahtung.ts eine Art 'neu' ohne Migration angemeldet → rot:
 *      „job_types kennt genau die angemeldeten Arten“ (15.11.2026)
 *   D  das ALTER TABLE jobs ADD CONSTRAINT auftraege_art_fkey entfernt →
 *      rot: „danach weist das Schema Unbekanntes ab“
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
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'db/migrations/0109-zustand-und-auftragsart-pruefen.sql'),
  'utf8',
);
const SCHEMA = `probe0109_${process.pid}`;
const TABELLEN = [
  'wanted',
  'price_alerts',
  'price_cache',
  'price_history',
  'part_price_cache',
  'part_price_history',
  'minifig_price_cache',
  'minifig_price_history',
  'jobs',
  'job_pauses',
];

test('Migration 0109: Zustand und Auftragsart', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const c = await db.pool.connect();
  t.after(async () => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    c.release();
    await db.pool.end().catch(() => {});
  });

  await t.test('auf einem Altbestand', async tt => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await c.query(`CREATE SCHEMA ${SCHEMA}`);
    await c.query(`SET search_path TO ${SCHEMA}, public`);
    // Ohne die Prüfungen von heute: Standardwerte und Indizes, keine CHECKs.
    for (const tab of TABELLEN)
      await c.query(`CREATE TABLE ${tab} (LIKE public.${tab} INCLUDING DEFAULTS INCLUDING INDEXES)`);
    await c.query(`INSERT INTO wanted (user_id, set_number, condition) VALUES
      (1, '1-1', 'n'), (1, '1-1', 'N'), (1, '2-1', 'u '), (1, '3-1', 'x'), (1, '4-1', 'n'), (1, '4-1', ' n')`);
    await c.query(`INSERT INTO price_alerts (user_id, set_number, condition, richtung, schwelle, currency_code)
                   VALUES (1, '1-1', 'u', 'unter', 5, 'EUR'), (1, '2-1', '?', 'unter', 5, 'EUR')`);
    await c.query(`INSERT INTO price_cache (set_number, condition, currency_code) VALUES
      ('1-1', 'N', 'EUR'), ('1-1', 'n', 'EUR')`);
    await c.query(`INSERT INTO jobs (type) VALUES ('preise'), ('verschwunden')`);
    await c.query(`INSERT INTO job_pauses (type, until_at) VALUES ('preise', NOW()), ('weg', NOW())`);

    await c.query(MIGRATION);

    await tt.test('Merkliste: andere Schreibweise wird berichtigt, Unbrauchbares fällt', async () => {
      const z = (await c.query('SELECT set_number, condition FROM wanted ORDER BY 1, 2')).rows;
      assert.deepEqual(z, [
        { set_number: '1-1', condition: 'N' },
        { set_number: '2-1', condition: 'U' },
        { set_number: '4-1', condition: 'N' },
      ]);
    });

    await tt.test('Preisalarm und Preisspeicher', async () => {
      assert.deepEqual((await c.query('SELECT set_number, condition FROM price_alerts')).rows, [
        { set_number: '1-1', condition: 'U' },
      ]);
      assert.deepEqual((await c.query('SELECT condition FROM price_cache')).rows, [{ condition: 'N' }]);
    });

    await tt.test('Aufträge und Pausen unbekannter Art fallen', async () => {
      assert.deepEqual((await c.query('SELECT type FROM jobs')).rows, [{ type: 'preise' }]);
      assert.deepEqual((await c.query('SELECT type FROM job_pauses')).rows, [{ type: 'preise' }]);
    });

    await tt.test('danach weist das Schema Unbekanntes ab', async () => {
      await assert.rejects(c.query(`INSERT INTO jobs (type) VALUES ('gibt_es_nicht')`), /auftraege_art_fkey/);
      await assert.rejects(
        c.query(`INSERT INTO price_history (set_number, condition, currency_code) VALUES ('9-1', 'u', 'EUR')`),
        /price_history_zustand/,
      );
    });
    await c.query('SET search_path TO public');
  });

  await t.test('job_types kennt genau die angemeldeten Arten', async () => {
    const angemeldet = require('./helpers/sources')
      .testDienste()
      .jobs.angemeldeteArten()
      .map(a => a.type);
    const inDb = (await db.all('SELECT type FROM job_types ORDER BY type')).map(z => z.type);
    assert.ok(angemeldet.length > 15, `nur ${angemeldet.length} Arten angemeldet`);
    assert.deepEqual(inDb, [...angemeldet].sort());
  });

  await t.test('ein Zustand ausser N und U wird abgewiesen', async () => {
    for (const tab of ['wanted', 'price_cache']) {
      const sql =
        tab === 'wanted'
          ? `INSERT INTO wanted (user_id, set_number, condition) VALUES ((SELECT min(id) FROM users), '9-1', 'n')`
          : `INSERT INTO price_cache (set_number, condition, currency_code) VALUES ('9-1', 'n', 'EUR')`;
      await assert.rejects(db.run(sql), new RegExp(`${tab}_zustand`));
    }
  });

  await t.test('eine unbekannte Auftragsart wird abgewiesen', async () => {
    await assert.rejects(db.run(`INSERT INTO jobs (type) VALUES ('gibt_es_nicht')`), /auftraege_art_fkey/);
  });
});
