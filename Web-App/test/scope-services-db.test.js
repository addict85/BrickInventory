/**
 * The services resolve the scope of a request, not the routes: a view
 * (who asks, which accounts he has selected) goes in, the rule of the
 * household applies inside. A further caller (job, new endpoint) does not have to
 * rebuild it.
 *
 * Counter-checks (measured 05.11.2026):
 *   A  in scopeFrom() `scopeKind(v.konten)` replaced by 'all' → red:
 *      “a view selects the accounts in the service”
 *   B  in deleteSetFor() the account selection skipped (`gewaehlt = writable`)
 *      → red: “deleting follows the account selection, in the write scope”
 *   C  in schreibziel() without fachfehler (null returned) → red: “a sub-account
 *      does not write for its main account”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');

test('services resolve the view', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const H = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const { readSets } = require('./helpers/sources').areaPage('sets');
  const { deleteSetFor } = require('./helpers/sources').areaPage('sets');
  const [MAIN, SUB] = [`haupt_${process.pid}`, `sub_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[MAIN, SUB]]);
  const main = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [MAIN])).id;
  const sub = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [SUB])).id;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [main, sub]);
  H.reportHouseholdChange();
  await holdsSet(db, main, '10179-1');
  await holdsSet(db, sub, '75192-1');
  const numbers = async view => (await readSets(view, {})).sets.map(s => s.set_number).sort();

  await t.test('a view selects the accounts in the service', async () => {
    assert.deepEqual(await numbers({ user: main }), ['10179-1', '75192-1']);
    assert.deepEqual(await numbers({ user: main, accounts: 'own' }), ['10179-1']);
    assert.deepEqual(await numbers({ user: main, accounts: 'subs' }), ['75192-1']);
    assert.deepEqual(
      await numbers({ user: sub, accounts: String(main) }),
      ['75192-1'],
      'a sub-account does not see into the main account via a foreign ID',
    );
  });

  await t.test('deleting follows the account selection, in the write scope', async () => {
    assert.equal(
      await deleteSetFor({ user: sub, accounts: String(main) }, '10179-1'),
      null,
      'the sub-account deleted a set of the main account',
    );
    assert.equal(
      await deleteSetFor({ user: main, accounts: 'subs' }, '10179-1'),
      null,
      'with „Unterkonten“ selected the deletion hit the own set',
    );
    assert.deepEqual(await numbers({ user: main, accounts: 'own' }), ['10179-1']);
    assert.ok(await deleteSetFor({ user: main, accounts: 'subs' }, '75192-1'));
    assert.deepEqual(await numbers({ user: main }), ['10179-1']);
  });

  await t.test('a sub-account does not write for its main account', async () => {
    assert.equal(await H.writeTarget(main, sub), sub);
    assert.equal(await H.writeTarget(sub, undefined), sub, 'without a request the own account');
    await assert.rejects(
      H.writeTarget(sub, main),
      (/** @type {any} */ e) => e.code === 'no_write_access' && e.kind === 'forbidden',
    );
  });
});
