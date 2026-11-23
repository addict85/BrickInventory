/**
 * Two throttles with the same rhythm also keep the distance between each other —
 * the way two processes do it via the table api_cadence.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  the call of waitOnTick removed in waitForSlot() → red: “two
 *      throttles share the rhythm”
 *   B  in the UPDATE of waitOnTick GREATEST(api_cadence.next_at, …) replaced by
 *      clock_timestamp() → red: the same test
 *   (measured again on 30.10.2026 with the check „not before k beats“: A and B red)
 *
 * Separate instances stand here for separate processes: they share nothing
 * except the database, just like a web worker and the background process.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('shared rhythm via the database', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));

  const { RateLimiter } = _req('src/externalSources/rateLimiter.js');
  const API = `test-${process.pid}`;
  const GAP = 250;
  await db.run('DELETE FROM api_cadence WHERE api = $1', [API]);

  await t.test('two throttles share the rhythm', async () => {
    // The own throttle lets through immediately (window 0) — every distance that
    // shows comes from the shared rhythm.
    const apiTick = require('./helpers/sources').testContext('externalSources').apiTick;
    const a = new RateLimiter(1, 0, { api: API, gapMs: GAP, apiTick, disruptedUntil: 0 });
    const b = new RateLimiter(1, 0, { api: API, gapMs: GAP, apiTick, disruptedUntil: 0 });
    const times = [];
    const start = Date.now();
    await Promise.all([a, b, a, b, a, b].map(d => d.waitForSlot().then(() => times.push(Date.now() - start))));
    times.sort((x, y) => x - y);
    // The k-th pass does not come before k beats. Late waking under load
    // is allowed; distances between wake times would not be, because a
    // late participant shortens the distance to the next punctual one.
    const tooEarly = times.filter((z, k) => z < k * GAP - 40);
    assert.deepEqual(tooEarly, [], `passes after start: ${times.join(', ')} ms`);
  });

  await db.run('DELETE FROM api_cadence WHERE api = $1', [API]);
});
