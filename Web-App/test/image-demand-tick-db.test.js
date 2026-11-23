/**
 * Every web worker writes its image notes away: preparing the database (as each worker does at
 * startup, startup/database.ts) starts the tick, and after ten seconds the buffer lands in
 * image_wanted — without a job process in this one.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  startImageDemand() removed from prepareDatabaseBefore → red (nothing written)
 *   B  the setInterval in setUpImageDemand removed → red (nothing written)
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testServices, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { bis } = require('./helpers/time');

test('a web worker writes its image notes away on its own', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const SN = `TK${process.pid}-1`;
  t.after(async () => {
    await testServices().images.stopImageDemand();
    await db.run('DELETE FROM image_wanted WHERE set_number = $1', [SN]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { prepareDatabaseBefore } = _req('startup/database.js');
  await prepareDatabaseBefore(testAccess(), testServices(), { jobs: false });
  testServices().images.rememberUsed(`https://cdn.rebrickable.com/media/sets/${SN}.jpg`, SN);
  t.mock.timers.tick(10_000);
  const count = async () => (await db.get('SELECT COUNT(*)::int AS n FROM image_wanted WHERE set_number = $1', [SN])).n;
  await bis(async () => (await count()) > 0, 3000);
  assert.equal(await count(), 1);
});
