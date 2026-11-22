'use strict';
/**
 * The test database of a test: schema, migrations on request. Without a
 * database the test is skipped — under REQUIRE_DB=1 (CI) that is
 * an error, otherwise the suite would be green there where nobody looks.
 *
 *   const db = await dataOrSkip(t, _req);
 *   if (!db) return;
 *
 * @param {import('node:test').TestContext} t
 * @param {(path: string) => any} _req  buildAndRequire() of the test file
 * @param {{ migrieren?: boolean }} [o]
 * @returns {Promise<any>} the access for test data (sources testData()), or null if skipped
 */
async function dataOrSkip(t, _req, { migrieren = true } = {}) {
  const db = require('./sources').testData();
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return null;
  }
  if (migrieren) {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  return db;
}

/** Like dataOrSkip, but delivers the access of the code under test (helpers/sources
 * testAccess), which queries as runtime role; the same methods (all, get, run, transaction, pool).
 * @param {import('node:test').TestContext} t @param {(path: string) => any} _req
 * @param {{ migrieren?: boolean }} [o] */
async function accessOrSkip(t, _req, o) {
  if (!(await dataOrSkip(t, _req, o))) return null;
  return require('./sources').testAccess();
}

/** For tests that check reachability themselves. @param {any} t @param {unknown} [e] */
function keineDb(t, e) {
  const reason = e === undefined ? '' : `: ${e instanceof Error ? e.message : e}`;
  missingPrecondition(t, 'Test-DB nicht erreichbar', `die Test-DB ist nicht erreichbar${reason}`);
}

/**
 * What cannot be checked without a database (or pg_dump, superuser …) is
 * skipped — under REQUIRE_DB=1 it is an error so that CI is not
 * green where it checked nothing.
 * @param {any} t @param {string} reason @param {string} [meldung]
 */
function missingPrecondition(t, reason, meldung = reason) {
  if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber ${meldung}`);
  t.skip(reason);
}

module.exports = { dataOrSkip, accessOrSkip, keineDb, missingPrecondition };
