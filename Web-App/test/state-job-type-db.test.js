/**
 * Migration 0109: the condition in wishlist, price alert and price stores is
 * 'N' or 'U', job kinds stand in job_types. The migration runs on
 * legacy data in its own schema (search_path); afterwards the test checks
 * the rules on the real database.
 *
 * Counter-checks (measured on 11.11.2026):
 *   A  the UPDATE wanted … of the migration removed → red: “wishlist: other
 *      spelling is corrected …” ('2-1' missing)
 *   B  in the UPDATE wanted the condition `w.id = (SELECT min(y.id) …)` removed →
 *      red: the migration fails on wanted_user_id_set_number_condition_key
 *   C  a kind 'neu' registered in startup/wiring.ts without a migration → red:
 *      “job_types knows exactly the registered kinds” (15.11.2026)
 *   D  the ALTER TABLE jobs ADD CONSTRAINT auftraege_art_fkey removed →
 *      red: “afterwards the schema rejects unknown values”
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
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'db/migrations/0109-zustand-und-auftragsart-pruefen.sql'),
  'utf8',
);
const SCHEMA = `probe0109_${process.pid}`;
const TABLES = [
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

test('migration 0109: condition and job kind', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const c = await db.pool.connect();
  t.after(async () => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    c.release();
    await db.pool.end().catch(() => {});
  });

  await t.test('on a legacy stock', async tt => {
    await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await c.query(`CREATE SCHEMA ${SCHEMA}`);
    await c.query(`SET search_path TO ${SCHEMA}, public`);
    // Without today's checks: defaults and indexes, no CHECKs.
    for (const tab of TABLES)
      await c.query(`CREATE TABLE ${tab} (LIKE public.${tab} INCLUDING DEFAULTS INCLUDING INDEXES)`);
    // State before 0124: migration 0109 only knows the names of back then.
    await c.query(`ALTER TABLE price_alerts RENAME COLUMN direction TO richtung;
                   ALTER TABLE price_alerts RENAME COLUMN threshold TO schwelle;
                   ALTER TABLE jobs RENAME TO auftraege; ALTER TABLE auftraege RENAME COLUMN type TO art;
                   ALTER TABLE job_pauses RENAME TO auftrag_pausen; ALTER TABLE auftrag_pausen RENAME COLUMN type TO art;
                   ALTER TABLE auftrag_pausen RENAME COLUMN until_at TO bis;
                   ALTER TABLE auftrag_pausen RENAME COLUMN reason TO grund;
                   ALTER TABLE auftrag_pausen RENAME COLUMN level TO stufe;`);
    await c.query(`INSERT INTO wanted (user_id, set_number, condition) VALUES
      (1, '1-1', 'n'), (1, '1-1', 'N'), (1, '2-1', 'u '), (1, '3-1', 'x'), (1, '4-1', 'n'), (1, '4-1', ' n')`);
    await c.query(`INSERT INTO price_alerts (user_id, set_number, condition, richtung, schwelle, currency_code)
                   VALUES (1, '1-1', 'u', 'below', 5, 'EUR'), (1, '2-1', '?', 'below', 5, 'EUR')`);
    await c.query(`INSERT INTO price_cache (set_number, condition, currency_code) VALUES
      ('1-1', 'N', 'EUR'), ('1-1', 'n', 'EUR')`);
    await c.query(`INSERT INTO auftraege (art) VALUES ('preise'), ('verschwunden')`);
    await c.query(`INSERT INTO auftrag_pausen (art, bis) VALUES ('preise', NOW()), ('weg', NOW())`);

    await c.query(MIGRATION);

    await tt.test('wishlist: other spelling is corrected, unusable items drop', async () => {
      const z = (await c.query('SELECT set_number, condition FROM wanted ORDER BY 1, 2')).rows;
      assert.deepEqual(z, [
        { set_number: '1-1', condition: 'N' },
        { set_number: '2-1', condition: 'U' },
        { set_number: '4-1', condition: 'N' },
      ]);
    });

    await tt.test('price alert and price store', async () => {
      assert.deepEqual((await c.query('SELECT set_number, condition FROM price_alerts')).rows, [
        { set_number: '1-1', condition: 'U' },
      ]);
      assert.deepEqual((await c.query('SELECT condition FROM price_cache')).rows, [{ condition: 'N' }]);
    });

    await tt.test('jobs and pauses of unknown kind drop', async () => {
      assert.deepEqual((await c.query('SELECT art AS kind FROM auftraege')).rows, [{ kind: 'preise' }]);
      assert.deepEqual((await c.query('SELECT art AS kind FROM auftrag_pausen')).rows, [{ kind: 'preise' }]);
    });

    await tt.test('afterwards the schema rejects unknown values', async () => {
      await assert.rejects(c.query(`INSERT INTO auftraege (art) VALUES ('gibt_es_nicht')`), /auftraege_art_fkey/);
      await assert.rejects(
        c.query(`INSERT INTO price_history (set_number, condition, currency_code) VALUES ('9-1', 'u', 'EUR')`),
        /price_history_zustand/,
      );
    });
    await c.query('SET search_path TO public');
  });

  await t.test('job_types knows exactly the registered kinds', async () => {
    const signedIn = require('./helpers/sources')
      .testServices()
      .jobQueue.signedInKinds()
      .map(a => a.kind);
    const inDb = (await db.all('SELECT type FROM job_types ORDER BY type')).map(z => z.type);
    assert.ok(signedIn.length > 15, `only ${signedIn.length} kinds registered`);
    assert.deepEqual(inDb, [...signedIn].sort());
  });

  await t.test('a condition other than N and U is rejected', async () => {
    for (const tab of ['wanted', 'price_cache']) {
      const sql =
        tab === 'wanted'
          ? `INSERT INTO wanted (user_id, set_number, condition) VALUES ((SELECT min(id) FROM users), '9-1', 'n')`
          : `INSERT INTO price_cache (set_number, condition, currency_code) VALUES ('9-1', 'n', 'EUR')`;
      await assert.rejects(db.run(sql), new RegExp(`${tab}_condition`));
    }
  });

  await t.test('an unknown job kind is rejected', async () => {
    await assert.rejects(db.run(`INSERT INTO jobs (type) VALUES ('gibt_es_nicht')`), /jobs_type_fkey/);
  });
});
