/**
 * If the connection breaks in the middle of a request (08006), only a
 * read access is retried. When writing it is open whether the row had already been
 * committed — a retry would create it twice.
 *
 * Counter-checks (measured on 27.10.):
 *   A  08006 again in RETRYABLE_CODES → red: “a write access after a
 *      connection loss”
 *   B  isReading without the check for INSERT/UPDATE/DELETE → red: “INSERT …
 *      RETURNING is not a read access”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { queryWithRetry, isReading } = _req('db/database.js');

/** Fails on the first attempt with `code`, afterwards it succeeds. */
function onceAbort(code) {
  let versuche = 0;
  const fn = async () => {
    versuche++;
    if (versuche === 1) throw Object.assign(new Error('weg'), { code });
    return 'ok';
  };
  return { fn, versuche: () => versuche };
}

test('a read access after a connection loss is retried', async () => {
  const a = onceAbort('08006');
  assert.equal(await queryWithRetry(a.fn, true), 'ok');
  assert.equal(a.versuche(), 2);
});

test('a write access after a connection loss', async () => {
  const a = onceAbort('08006');
  await assert.rejects(queryWithRetry(a.fn, false), { code: '08006' });
  assert.equal(a.versuche(), 1, 'Die Zeile stünde sonst womöglich doppelt da');
});

test('deadlock and startup phase may retry once even when writing', async () => {
  for (const code of ['40001', '40P01', '57P03', '08001']) {
    const a = onceAbort(code);
    assert.equal(await queryWithRetry(a.fn, false), 'ok', code);
  }
});

test('INSERT … RETURNING is not a read access', () => {
  assert.equal(isReading('SELECT 1'), true);
  assert.equal(isReading('  -- Notiz\n  WITH x AS (SELECT 1) SELECT * FROM x'), true);
  assert.equal(isReading('INSERT INTO t (a) VALUES (1) RETURNING id'), false);
  assert.equal(isReading('WITH n AS (INSERT INTO t VALUES (1) RETURNING id) SELECT * FROM n'), false);
  assert.equal(isReading('SELECT * FROM t WHERE id = 1 FOR UPDATE'), false);
  assert.equal(isReading('UPDATE t SET a = 1'), false);
});
