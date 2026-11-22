/**
 * Three indexes for queries that would read the whole table in the request path without them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testData();

// idx_parts_blnum stood here and is gone: it was a partial index on
// parts.bl_part_number, and migration 0037 deleted the column (the
// BrickLink number now stands in bl_mapping). Postgres removes
// dependent indexes itself on DROP COLUMN.
const EXPECTED = ['idx_set_minifigs_fig', 'idx_sets_set_num'];

/**
 * Fetch the plan of a query — without the table scan escape.
 *
 * Its OWN connection because `SET enable_seqscan` depends on the session: via
 * the pool the next query may land on another connection, and
 * the setting would never be set there.
 */
async function plan(sql) {
  const c = await db.ownConnection();
  try {
    await c.query('SET enable_seqscan = off');
    const r = await c.query(`EXPLAIN ${sql}`);
    return r.rows.map(z => z['QUERY PLAN']).join('\n');
  } finally {
    await c.end().catch(() => {});
  }
}

test('request path: the three indexes exist and the planner can take them', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('no test database reachable');
  }

  try {
    // initSchema() directly, not initSchemaOnce(): the latter skips the
    // work if schema_meta already holds this deployment's version
    // (see db/database.ts). For the test exactly that is wrong — it wants
    // to know what the schema setup CREATES, not what it may save itself.
    await db.initSchema();

    // ── 1. Created ─────────────────────────────────────────────────────────
    const da = (
      await db.all('SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2)', [
        'public',
        EXPECTED,
      ])
    )
      .map(r => r.indexname)
      .sort();
    assert.deepEqual(
      da,
      [...EXPECTED].sort(),
      `db/database.ts does not create all expected indexes — found: ${da.join(', ') || '(none)'}`,
    );

    // COUNTER-CHECK: the query must not simply confirm everything.
    const invented = await db.all('SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2)', [
      'public',
      ['idx_gibt_es_nicht'],
    ]);
    assert.equal(invented.length, 0, 'Counter-check: the index query also reports invented names as present');

    // ── 2. The planner can take them ───────────────────────────────────────
    //
    // The BrickLink lookup first, and for that the
    // MIGRATIONS are needed: bl_mapping is created in 0037, not in
    // db/base.sql (a table belongs in exactly one place,
    // scripts/check-schema-at-start.js checks that).
    const c0 = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c0);
    } finally {
      c0.release();
    }

    // Character for character the query from src/catalog/blMapping.ts (blFetchNumber).
    const blPlan = await plan(
      `SELECT COALESCE(bl_id, rb_id) AS nr FROM bl_mapping
        WHERE type = 'part' AND rb_id = 'x'`,
    );
    assert.match(
      blPlan,
      /Index (Only )?Scan.* on bl_mapping/,
      `The BrickLink lookup does not run via an index:\n${blPlan}`,
    );

    const minifigPlan = await plan(`SELECT set_number FROM set_minifigs_catalog WHERE fig_number = 'x' LIMIT 1`);
    assert.match(minifigPlan, /idx_set_minifigs_fig/, `Plan:\n${minifigPlan}`);

    const setPlan = await plan(`SELECT user_id FROM sets WHERE set_number = 'x' ORDER BY user_id`);
    assert.match(setPlan, /idx_sets_set_num/, `Plan:\n${setPlan}`);

    // COUNTER-CHECK for the BrickLink lookup: a column with NO index on it
    // must lead to a table scan. Otherwise the
    // assertion above would be blind to whether the planner distinguishes
    // between the two at all.
    const withoutIndex = await plan(`SELECT rb_id FROM bl_mapping WHERE fetched_at < NOW()`);
    assert.match(
      withoutIndex,
      /Seq Scan on bl_mapping/,
      `Counter-check: even without an index there was no table scan:\n${withoutIndex}`,
    );
  } finally {
    await db.pool.end().catch(() => {});
  }
});
