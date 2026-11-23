/**
 * “Who asks” stands in one place: in the call context, whose account row security
 * also sets. A service that gets another account as requester throws (ForeignAccount)
 * instead of silently only seeing what the requester's row security shows.
 *
 * Counter-checks (14.11.2026):
 *   A  checkRequester() (src/infra/accountContext.ts) emptied → red: “a foreign account
 *      as requester throws” (the sub-account silently got only its own set).
 *   B  in householdOf() the call of checkRequester() deleted → red: the same.
 *   C  in checkRequester() the system context not excepted → red: “in the system context
 *      every account applies”.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, asAccount, areaPage } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');

test('a service only asks as the account of the row security', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { inSystemContext, ForeignAccount } = require(
    path.join(__dirname, '..', 'dist', 'src/infra/accountContext.js'),
  );
  const { readSets } = areaPage('sets');
  const [MAIN, SUB] = [`fk_haupt_${process.pid}`, `fk_sub_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[MAIN, SUB]]);
  const neu = async n =>
    (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [n])).id;
  const haupt = await neu(MAIN);
  const sub = await neu(SUB);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, sub]);
  require('./helpers/sources').testServices().household.reportHouseholdChange();
  await holdsSet(db, haupt, '10179-1');
  await holdsSet(db, sub, '75192-1');
  const nummern = async nutzer => (await readSets({ user: nutzer }, {})).sets.map(s => s.set_number).sort();

  await t.test('the own account sees its household', async () => {
    assert.deepEqual(await asAccount(haupt, () => nummern(haupt)), ['10179-1', '75192-1']);
  });

  await t.test('a foreign account as requester throws', async () => {
    await assert.rejects(
      asAccount(sub, () => nummern(haupt)),
      e => e instanceof ForeignAccount && /Konto \d+ unter dem Zeilenschutz von Konto \d+/.test(String(e)),
    );
  });

  await t.test('in the system frame every account applies', async () => {
    const gesehen = await asAccount(sub, () => inSystemContext('Test', () => nummern(haupt)));
    assert.deepEqual(gesehen, ['10179-1', '75192-1']);
  });
});
