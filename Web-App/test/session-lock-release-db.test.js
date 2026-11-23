/**
 * If releasing a session lock fails (e.g. statement_timeout), the
 * connection does not go back into the pool with the lock held, and the
 * result of the run is preserved.
 *
 * Counter-checks (measured on 08.11.2026):
 *   A  client.release(defekt) again client.release() (withSessionLock)
 *      → red: “withSessionLock: the lock is free after a release error” and “… error of the run”
 *   B  the release without .catch (error covers the result)
 *      → red: “withSessionLock: the result of the run stays” (and the two other withSessionLock cases)
 *   C  in receiptsSessionLock again client.release() without an error
 *      → red: “receiptsSessionLock: the lock is free after a release error”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { withSessionLock, receiptsSessionLock } = _req('db/txLock.js');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

const SCHLUESSEL = 7_654_321;

/** The next borrowed connection makes pg_advisory_unlock fail. */
function unlockFailsOnce() {
  const echt = testAccess().pool.connect.bind(testAccess().pool);
  const incident = { releaseWithError: /** @type {unknown} */ (undefined), released: false };
  testAccess().pool.connect = async () => {
    const c = await echt();
    const query = c.query.bind(c);
    const release = c.release.bind(c);
    c.query = (/** @type {any} */ sql, /** @type {any} */ p) =>
      typeof sql === 'string' && sql.includes('pg_advisory_unlock')
        ? Promise.reject(new Error('statement timeout (Attrappe)'))
        : query(sql, p);
    c.release = (/** @type {any} */ err) => {
      incident.released = true;
      incident.releaseWithError = err;
      testAccess().pool.connect = echt;
      return release(err);
    };
    return c;
  };
  return incident;
}

/** Does any connection still hold the lock? Asked from a fresh session. */
async function lockFree() {
  const c = await testAccess().pool.connect();
  try {
    const { rows } = await c.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [SCHLUESSEL]);
    if (rows[0].ok) await c.query('SELECT pg_advisory_unlock($1, 0)', [SCHLUESSEL]);
    return !!rows[0].ok;
  } finally {
    c.release();
  }
}

test('Sitzungssperre: Freigabefehler', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  // The pool should have exactly one connection, otherwise the check would get a different one
  // than the one holding the lock, and would find it "free".
  const maxBefore = testAccess().pool.options.max;
  testAccess().pool.options.max = 1;
  t.after(() => {
    testAccess().pool.options.max = maxBefore;
  });

  await t.test('withSessionLock: the result of the run stays', async () => {
    const incident = unlockFailsOnce();
    const r = await withSessionLock(
      testAccess(),
      SCHLUESSEL,
      async () => 'ergebnis',
      () => {
        throw new Error('belegt');
      },
    );
    assert.equal(r, 'ergebnis', 'the release error masks the result');
    assert.equal(incident.released, true);
  });

  await t.test('withSessionLock: the lock is free after a release error', async () => {
    const incident = unlockFailsOnce();
    await withSessionLock(
      testAccess(),
      SCHLUESSEL,
      async () => 1,
      () => {
        throw new Error('belegt');
      },
    );
    assert.ok(incident.releaseWithError instanceof Error, 'the connection was returned without an error');
    assert.equal(await lockFree(), true, 'the lock hangs on a connection in the pool');
  });

  await t.test('withSessionLock: an error of the run stays the error', async () => {
    unlockFailsOnce();
    await assert.rejects(
      withSessionLock(
        testAccess(),
        SCHLUESSEL,
        async () => {
          throw new Error('lauf kaputt');
        },
        () => {
          throw new Error('belegt');
        },
      ),
      /lauf kaputt/,
    );
    assert.equal(await lockFree(), true);
  });

  await t.test('receiptsSessionLock: the lock is free after a release error', async () => {
    const incident = unlockFailsOnce();
    const frei = await receiptsSessionLock(testAccess(), SCHLUESSEL);
    assert.ok(frei, 'the lock was already taken');
    await frei();
    assert.ok(incident.releaseWithError instanceof Error, 'the connection was returned without an error');
    assert.equal(await lockFree(), true, 'the lock hangs on a connection in the pool');
  });
});
