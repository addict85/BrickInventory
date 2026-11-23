/**
 * Cross-process job locks against a REAL database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

/** Hold a lock on its own connection — plays the second worker. */
async function holdAs(fremder, ns) {
  const client = await db.pool.connect();
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [ns]);
  assert.equal(rows[0].ok, true, `${fremder}: lock ${ns} was already taken`);
  return async () => {
    await client.query('SELECT pg_advisory_unlock($1, 0)', [ns]).catch(() => {});
    client.release();
  };
}

const REDOWNLOAD_LOCK = 57;

test('job locks work across process boundaries', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // And the MIGRATIONS, not only the schema
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }

  await t.test('the image follow-up run does not start twice', async () => {
    const enrich = _req('src/catalog/partsEnrichment.js');
    // Counter-check: without a foreign lock it runs through (empty catalog → 0 missing).
    const free = await enrich.redownloadMissingImages();
    assert.equal(free.alreadyRunning, undefined, 'Run was rejected without a foreign lock');

    const release = await holdAs('zweiter Worker', REDOWNLOAD_LOCK);
    try {
      const locked = await enrich.redownloadMissingImages();
      assert.equal(
        locked.alreadyRunning,
        true,
        'second run started — the same images would be loaded twice from the CDN',
      );
    } finally {
      await release();
    }
  });

  await db.pool.end().catch(() => {});
});
