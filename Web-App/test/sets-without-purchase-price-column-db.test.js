/**
 * Since db/base.sql the state BEFORE this migration no longer exists: the
 * cases on bolt, addendum and intermediate state are dropped. What is checked is
 * the final state and the read paths.
 *
 * Counter-check: a condition column added to sets in db/base.sql → red “after the complete schema setup sets has no purchase price and no condition”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();

// Aftermath: leave a cleaned-up database behind
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  } catch (e) {
    // Do not swallow: if the database stays broken, the next files fail
    // on something that has nothing to do with them.
    console.error('[sets-ohne-kaufpreisspalte] cleanup failed:', e.message);
  }
  await db.pool.end().catch(() => {});
});

/** Column names of a table, from the catalog. */
const columnsOf = async tabelle =>
  (await db.all(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
    .map(r => r.column_name)
    .sort();

test('after the complete schema setup sets has no purchase price and no condition', {
  concurrency: 1,
}, async t => {
  try {
    await db.run('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }

  // From zero: exactly the path a new installation takes.
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // The state before the migrations no longer exists: an empty
  // database gets db/base.sql. What is checked is the final state.
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  const nachher = await columnsOf('sets');
  // `quantity` stood here too — until migration 0036 deleted it. What is checked
  // now is `user_id` and `set_number`: which account holds which set,
  // that is what remains of the row. (That quantity is ROUTE is checked by
  // test/set-quantity-from-entries-db.test.js.)
  assert.ok(
    nachher.includes('user_id') && nachher.includes('set_number'),
    `The column list of sets looks wrong: ${nachher.join(', ')}`,
  );
  for (const sp of ['purchase_price', 'condition']) {
    assert.ok(
      !nachher.includes(sp),
      `sets.${sp} is still there after all migrations — migration 0032 did not ` +
        'delete it, or something creates the column again afterwards.',
    );
  }

  // And they have not disappeared but moved.
  const erfassung = await columnsOf('set_acquisitions');
  for (const sp of ['purchase_price', 'condition', 'quantity', 'created_at']) {
    assert.ok(
      erfassung.includes(sp),
      `set_acquisitions.${sp} is missing — then the purchase price exists nowhere any more`,
    );
  }
});
