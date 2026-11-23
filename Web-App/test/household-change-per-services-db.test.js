/**
 * The household memory and its dependents belong to one set of services: a
 * new set attaches nothing to a list of the process, and another set
 * (like a second process) learns of a change via NOTIFY.
 *
 * Counter-checks (measured 14.11.2026):
 *   A  atHouseholdChange() back into a list of the module → red: “a set
 *      only clears its own dependents” (the other set's callback ran along)
 *   B  listenOnChanges() without clearing (callback empty) → red: “another
 *      set learns of the change via NOTIFY” (old view)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { createDb, dbConfigFromEnvironment } = _req('db/database.js');
const { until } = require('./helpers/time');

test('household changes per set of services', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const db = testData();
  const { buildServices } = _req('startup/wiring.js');
  // Two accesses like two processes (web and jobs).
  const accesses = [createDb(dbConfigFromEnvironment()), createDb(dbConfigFromEnvironment())];
  const [a, b] = accesses.map(z => buildServices(z));
  const names = [`hhd_h_${process.pid}`, `hhd_u_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [names]);
  const ids = [];
  for (const n of names)
    ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [n])).id);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]);
    for (const z of accesses) {
      await z.notification.close();
      await z.pool.end();
    }
    await db.pool.end().catch(() => {});
  });

  await t.test('a set only clears its dependents', () => {
    const called = [];
    a.household.atHouseholdChange(() => called.push('a'));
    b.household.atHouseholdChange(() => called.push('b'));
    a.household.reportHouseholdChange();
    assert.deepEqual(called, ['a']);
  });

  await t.test('another set learns about the change via NOTIFY', async () => {
    await b.household.listenOnChanges();
    // Under the account's row security: the runtime role does not see foreign links (0121).
    const view = () => asAccount(ids[0], () => b.household.scopeIds(ids[0]));
    assert.deepEqual(await view(), [ids[0]]);
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [ids[0], ids[1]]);
    a.household.reportHouseholdChange();
    const fresh = async () => (await view()).length === 2;
    assert.ok(await until(fresh, 3000), 'old view: the change did not arrive');
  });
});
