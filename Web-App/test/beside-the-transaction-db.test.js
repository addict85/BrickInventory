/**
 * A context switch in the middle of a transaction (inSystemContext in one of the account,
 * asRequest in one of the system context) queried via the pool of the other role beside
 * it; db/database.ts rejects that (BesideTheTransaction). Chosen beforehand stays allowed.
 * Own system pool with the same role: what matters is the second connection.
 *
 * Counter-checks (measured 13.11.2026, each alone):
 *   A  in txStand() the line `throw new BesideTheTransaction(…)` deleted → red:
 *      “system context in an account transaction …” and “… and vice versa” (the
 *      query ran on another connection, pg_backend_pid differed)
 *   B  inTransaction back via txStand() (throws) → red: “inTransaction …”
 *   C  in redeemInvitation() (src/household/household.ts) inSystemContext again
 *      only around the two getSetting() inside k.transact → red in
 *      test/rows-protection-db.test.js “whoever joins a household …” (BesideTheTransaction)
 *   D  in txStand() the pool check deleted entirely → red: the first two
 *      (14.11.2026 again: now UnboundQuery instead of BesideTheTransaction)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
require('./helpers/sources').buildAndRequire();
const { noDb } = require('./helpers/db');
const mod = require(path.join(__dirname, '..', 'dist', 'db', 'database.js'));
const { inSystemContext, asRequest } = require(path.join(__dirname, '..', 'dist', 'src', 'infra', 'accountContext.js'));

const PID = 'SELECT pg_backend_pid() AS p';

test('queries next to a transaction', { concurrency: 1 }, async t => {
  const k = mod.dbConfigFromEnvironment();
  const db = mod.createDb({ ...k, system: { ...k.connection } });
  try {
    await db.get(PID);
  } catch (e) {
    await db.pool.end().catch(() => {});
    noDb(t, e);
    return;
  }
  t.after(() => db.pool.end());
  assert.notEqual(db.systemPool, db.pool, 'without its own system pool the test checked nothing');
  const account = f => asRequest({ tokenUserId: 1 }, f);

  await t.test('system frame within an account transaction is rejected', async () => {
    await account(() =>
      db.transaction(async tx => {
        const owned = (await tx.get(PID)).p;
        await assert.rejects(
          inSystemContext('probe', () => db.get(PID)),
          e => e instanceof mod.BesideTheTransaction && /vor der Transaktion/.test(String(e)),
        );
        await assert.rejects(
          inSystemContext('probe', () => db.transaction(inner => inner.get(PID))),
          mod.BesideTheTransaction,
        );
        assert.equal((await tx.get(PID)).p, owned, 'the transaction stays usable');
      }),
    );
  });

  await t.test('… and the other way round: a request within a transaction of the system frame', async () => {
    await inSystemContext('probe', () =>
      db.transaction(async () => {
        await assert.rejects(
          account(() => db.get(PID)),
          mod.BesideTheTransaction,
        );
      }),
    );
  });

  await t.test('frame chosen before the transaction: everything goes via tx, the unbound access throws', async () => {
    await inSystemContext('probe', () =>
      db.transaction(async tx => {
        const owned = (await tx.get(PID)).p;
        await assert.rejects(db.get(PID), mod.UnboundQuery);
        assert.equal((await tx.get(PID)).p, owned);
      }),
    );
  });

  await t.test('inTransaction tells the truth even after the switch, instead of throwing', async () => {
    assert.equal(db.inTransaction(), false);
    await account(() =>
      db.transaction(async () => {
        assert.equal(db.inTransaction(), true);
        assert.equal(
          inSystemContext('probe', () => db.inTransaction()),
          true,
        );
      }),
    );
  });
});
