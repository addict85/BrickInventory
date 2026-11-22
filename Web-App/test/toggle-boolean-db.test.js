/**
 * Yes/no columns are BOOLEAN — checked against the real database
 * (information_schema and pg_constraint), not against the migrations.
 * The search is twofold: for column names that are a flag
 * (is_…, has_…, must_…, never_…, …_verified), and for constraints that restrict a
 * number to 0 and 1. Both lists must be empty.
 *
 * Counter-checks (31.10.2026, measured):
 *   a) in db/migrations/0085-schalter-als-boolean.sql the block for
 *      catalog_cache.is_gear removed → red („catalog_cache.is_gear: integer“).
 *   b) there the constraints of users not removed and is_admin not converted
 *      → red (column and constraint users_is_admin_schalter).
 * The part „the search applies“ creates a 0/1 column itself and must find it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');

const FLAG = '^(is|has|must|never)_|_verified$';

/** Flag columns that are not BOOLEAN, and constraints on 0/1 — in the schema `schema`. */
async function numbersFlags(db, schema) {
  const spalten = await db.all(
    `SELECT table_name || '.' || column_name || ': ' || data_type AS z FROM information_schema.columns
      WHERE table_schema = $1 AND column_name ~ $2 AND data_type <> 'boolean'
        AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE')
      ORDER BY 1`,
    [schema, FLAG],
  );
  const schranken = await db.all(
    `SELECT conname AS z FROM pg_constraint
      WHERE connamespace = $1::regnamespace AND contype = 'c'
        AND pg_get_constraintdef(oid) ~ 'ARRAY\\[0, 1\\]|IN \\(0, ?1\\)'
      ORDER BY 1`,
    [schema],
  );
  return [...spalten, ...schranken].map(r => r.z);
}

test('no yes/no column carries 0/1', async t => {
  const db = testData();
  try {
    await db.initSchemaOnce();
  } catch (e) {
    noDb(t, e);
    return;
  }
  try {
    await t.test('the search takes effect', async () => {
      const booleans = await db.get(
        `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ~ $1 AND data_type = 'boolean'`,
        [FLAG],
      );
      assert.ok(booleans.n >= 10, `nur ${booleans.n} Flaggen-Spalten gefunden — greift das Muster noch?`);
      await db.exec(`DROP SCHEMA IF EXISTS schalter_probe CASCADE; CREATE SCHEMA schalter_probe;
        CREATE TABLE schalter_probe.p (is_probe integer NOT NULL DEFAULT 0, CONSTRAINT p_probe_null_eins CHECK (is_probe IN (0, 1)))`);
      try {
        assert.deepEqual(await numbersFlags(db, 'schalter_probe'), ['p.is_probe: integer', 'p_probe_null_eins']);
      } finally {
        await db.exec('DROP SCHEMA schalter_probe CASCADE');
      }
    });

    await t.test('in the application schema each of them is BOOLEAN', async () => {
      assert.deepEqual(await numbersFlags(db, 'public'), []);
    });
  } finally {
    await db.pool.end();
  }
});
