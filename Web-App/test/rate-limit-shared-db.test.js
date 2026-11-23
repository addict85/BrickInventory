/**
 * Quotas and brute-force counters live in the database, so every worker sees the same state: the
 * Rebrickable daily quota counts in the shared table and reads its limit on every call, the login
 * counter counts atomically and restarts an expired window, and without a database it falls back
 * to process memory instead of failing.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  consumeRebrickableDaily returns true without checkAndCountQuota → red “the daily quota …”
 *   B  limitTheSource remembers the first limit per process → red “a limit changed elsewhere …”
 *   C  countAttempt increments in JS (read, then write) instead of the upsert → red “parallel attempts …”
 *   D  the CASE on first_at removed from the upsert → red “an expired window starts at 1”
 *   E  the catch in countAttempt removed → red “without a database the counter keeps counting”
 *   F  the catch in counterState removed → red the same test
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testContext } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('quota and counters across workers', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const RL = _req('src/externalSources/rateLimiter.js');
  const Q = _req('src/externalSources/apiQuota.js');
  const C = _req('src/throttle/counter.js');
  const setLimit = n =>
    db.run(
      `INSERT INTO global_settings (key, value) VALUES ('api_limit_rebrickable', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(n)],
    );
  const KEY = `rl-test-${process.pid}`;
  t.after(async () => {
    await db.run(`DELETE FROM global_settings WHERE key = 'api_limit_rebrickable'`).catch(() => {});
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`${KEY}%`]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('the daily quota counts in the shared table', async () => {
    const before = (await Q.quotaOverview('rebrickable')).count;
    await setLimit(before + 3);
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await RL.consumeRebrickableDaily());
    assert.deepEqual(r, [true, true, true, false]);
    assert.equal((await Q.quotaOverview('rebrickable')).count, before + 3);
  });

  await t.test('a limit changed elsewhere applies at once', async () => {
    const used = (await Q.quotaOverview('rebrickable')).count;
    assert.equal(await RL.consumeRebrickableDaily(), false, 'precondition: exhausted');
    // As another worker's PUT would write it: straight into the table.
    await setLimit(used + 1);
    assert.equal(await RL.consumeRebrickableDaily(), true);
  });

  await t.test('parallel attempts all count', async () => {
    const key = `${KEY}-par`;
    await Promise.all(Array.from({ length: 10 }, () => C.countAttempt(key, 15)));
    assert.equal((await C.counterState(key, 15)).count, 10);
  });

  await t.test('an expired window starts at 1', async () => {
    const key = `${KEY}-old`;
    await C.countAttempt(key, 15);
    await C.countAttempt(key, 15);
    await db.run(`UPDATE rate_limit_attempts SET first_at = NOW() - interval '1 hour' WHERE key = $1`, [key]);
    assert.equal(await C.countAttempt(key, 15), 1);
  });

  await t.test('without a database the counter keeps counting', async t2 => {
    const counter = testContext('throttle').counter;
    const down = async () => {
      throw new Error('connection terminated');
    };
    for (const n of ['read', 'increase', 'deleteCounter']) t2.mock.method(counter, n, down);
    t2.mock.method(console, 'warn', () => {});
    const key = `${KEY}-down`;
    assert.equal(await C.countAttempt(key, 15), 1);
    assert.equal(await C.countAttempt(key, 15), 2);
    assert.equal((await C.counterState(key, 15))?.count, 2);
    await C.forgetCounter(key);
    assert.equal(await C.counterState(key, 15), null);
  });
});
