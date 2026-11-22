/**
 * The price run fetches per set exactly the conditions that the account carries or remembers
 * (statesPerSet in src/finances/priceRun.ts).
 *
 * Counter-checks (measured 09.11.2026):
 *   A  the wishlist no longer read in statesPerSet() → red: “a remembered used condition counts as well”
 *   B  ergebnis.set(sn, ['N', 'U']) for every set → red: “a pure set costs only one request”
 *   C  the hint skipped when capturing → red: “the condition of a not yet written entry counts”
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { catalogSet } = require('./helpers/inventory');
const { dataOrSkip } = require('./helpers/db');

test('conditions per set for the price run', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
      [`preislauf_${process.pid}`],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end();
  });
  const [MIXED, REIN, GEMERKT, FREMD] = ['91001-1', '91002-1', '91003-1', '91004-1'];
  for (const sn of [MIXED, REIN, GEMERKT]) await catalogSet(db, sn, { name: 'Probe' });
  const { bookEntry } = _req('src/sets/addSet.js');
  for (const [sn, z] of [
    [MIXED, 'N'],
    [MIXED, 'U'],
    [REIN, 'U'],
  ]) {
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2) ON CONFLICT DO NOTHING', [uid, sn]);
    await bookEntry(require('./helpers/sources').testContext('sets'), {
      account: uid,
      setNumber: sn,
      quantity: 1,
      purchasePrice: 10,
      condition: z,
    });
  }
  await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1, $2, 'U')`, [uid, GEMERKT]);
  const { statesPerSet, conditionsNeededFor } = _req('src/finances/priceRun.js');
  const sortiert = m => Object.fromEntries([...m].map(([k, v]) => [k, [...v].sort()]));

  const z = sortiert(await statesPerSet(uid, [MIXED, REIN, GEMERKT, FREMD]));

  await t.test('a mixed set needs both prices', () => assert.deepEqual(z[MIXED], ['N', 'U']));
  await t.test('a pure set costs only one request', () => assert.deepEqual(z[REIN], ['U']));
  await t.test('a remembered used condition counts as well', () => assert.deepEqual(z[GEMERKT], ['U']));
  await t.test('without an entry and pending item, new applies', () => assert.deepEqual(z[FREMD], ['N']));
  await t.test('the condition of a not yet written entry counts', async () => {
    assert.deepEqual((await conditionsNeededFor(REIN, uid, 'N')).sort(), ['N', 'U']);
  });
});
