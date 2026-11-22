/**
 * If the start waits for the process that is currently migrating, it does not abort at the
 * statement_timeout of the pool connection (57014) but waits until the
 * lock is free.
 *
 * Counter-check (measured on 07.11.2026): `SET statement_timeout = 0` before the
 * pg_advisory_lock removed in initSchemaOnce() → red: “waits longer than
 * statement_timeout” (abort with 57014 after about one second).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.PG_STMT_MS = '1000';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { bis } = require('./helpers/time');
const db = testData();
const { LOCKS } = _req('src/infra/lockNamespaces.js');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

test('schema lock: waiting takes longer than statement_timeout', async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const fremder = new Client({ connectionString: process.env.DATABASE_URL });
  await fremder.connect();
  t.after(async () => {
    await fremder.query('SELECT pg_advisory_unlock_all()').catch(() => {});
    await fremder.end().catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('waits longer than statement_timeout', async () => {
    await fremder.query('SELECT pg_advisory_lock($1)', [LOCKS.SCHEMA_INIT]);
    /** @type {any} */
    let ergebnis = 'offen';
    const start = db.initSchemaOnce().then(
      () => {
        ergebnis = 'fertig';
      },
      e => {
        ergebnis = e;
      },
    );
    // The waiting one has been standing at the lock for more than twice the statement_timeout.
    const waiting = await bis(
      async () =>
        (
          await fremder.query(
            `SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'
             AND query LIKE 'SELECT pg_advisory_lock(%' AND now() - query_start > interval '2 seconds'`,
          )
        ).rowCount > 0,
      8000,
    );
    assert.ok(waiting, `abgebrochen: ${ergebnis?.code ?? ergebnis} ${ergebnis?.message ?? ''}`);
    await fremder.query('SELECT pg_advisory_unlock($1)', [LOCKS.SCHEMA_INIT]);
    await start;
    assert.equal(ergebnis, 'fertig', String(ergebnis?.message ?? ergebnis));
  });

  await t.test('afterwards the statement_timeout of the pool connection applies again', async () => {
    const c = await db.pool.connect();
    try {
      const { rows } = await c.query('SHOW statement_timeout');
      assert.equal(rows[0].statement_timeout, '1s');
    } finally {
      c.release();
    }
  });
});
