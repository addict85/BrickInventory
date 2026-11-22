/**
 * The contract is the only input check and delivers the domain format: what it accepts,
 * the route accepts, as it has transformed it (src/contract/base.ts, z.transform).
 * Checked via the real routes against the database.
 *
 * Counter-checks (measured 14.11.2026, each alone, reverted):
 *   A  ZUSTAND without `.transform(v => v.toUpperCase() …)` → red: “lower-case condition
 *      counts like upper case” (400 instead of 200: 'n' passes unchanged and breaks the response contract)
 *   B  KENNUNG without `.transform(Number)` → `npm run typecheck` red (settings.ts, parts.ts:
 *      string | number is not a number); the services read text like a number, the run would not see it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('the contract delivers the domain format to the route', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const namen = [`fachformat_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [n])).id);
  const [a] = ids;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const basis = testServer(_req, { sitzung: { userId: a }, t }).base;
  const rufe = async (methode, path, rumpf) => {
    const r = await fetch(`${basis}/api/v2${path}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      ...(rumpf ? { body: JSON.stringify(rumpf) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };

  await t.test('a lower-case condition counts as upper case', async () => {
    const r = await rufe('POST', '/settings/user/default-condition', { condition: 'n' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.condition, 'N');
    assert.equal((await rufe('GET', '/settings/user/default-condition')).body.condition, 'N');
    const u = await rufe('POST', '/settings/user/default-condition', { condition: 'u' });
    assert.equal(u.body.condition, 'U');
    // What the contract does not know it rejects; the route never sees it.
    assert.equal((await rufe('POST', '/settings/user/default-condition', { condition: 'x' })).status, 400);
  });
});
