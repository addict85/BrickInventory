/**
 * The context `t` of a transaction arises once per connection, not per transaction
 * (db/database.ts connectionAccess, src/infra/area.ts buildContext). That it is persistent
 * must redirect nothing: a straggler of an ended transaction whose connection
 * already carries the next one does not query into the foreign one. Pool with one connection.
 *
 * Counter-checks (14.11.2026, each on its own):
 *   A  in buildContext `fn(ueber(tx.db))` → `fn(buildContext(rebuild(a, tx.db), zugang))` → red:
 *      “two transactions on one connection share t”
 *   B  in newSpace the condition `runningTx() !== stand` deleted → red: “a straggler …”
 *      (its query ran in the second transaction)
 *   C  in connectionAccess `platz.stand = stand` deleted → red: “a straggler …”
 *      (TransactionEnded also for the second transaction itself)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
require('./helpers/sources').buildAndRequire();
const { noDb } = require('./helpers/db');
const DIST = path.join(__dirname, '..', 'dist');
const modul = require(path.join(DIST, 'db', 'database.js'));
const { buildServices } = require(path.join(DIST, 'startup', 'wiring.js'));
const { config } = require(path.join(DIST, 'src', 'infra', 'config.js'));
const { inSystemContext } = require(path.join(DIST, 'src', 'infra', 'accountContext.js'));

test('transaction context per connection', { concurrency: 1 }, async t => {
  const k0 = modul.dbConfigFromEnvironment();
  const db = modul.createDb({ ...k0, pool: { ...k0.pool, max: 1 } });
  try {
    await db.get('SELECT 1');
  } catch (e) {
    await db.pool.end().catch(() => {});
    noDb(t, e);
    return;
  }
  t.after(() => db.pool.end());
  /** @type {Record<string, any>} */
  const contexts = {};
  buildServices(db, { contexts, config: config() });
  const k = contexts.collection;
  const imSystem = (/** @type {() => Promise<any>} */ f) => inSystemContext('test', f);

  await t.test('two transactions on one connection share t and the services in it', async () => {
    const t1 = await imSystem(() => k.transact(async (/** @type {any} */ t) => t));
    const t2 = await imSystem(() => k.transact(async (/** @type {any} */ t) => t));
    assert.equal(t1, t2);
    assert.equal(t1.catalog, t2.catalog, 'the deeper areas are not created anew');
    assert.notEqual(t1, k);
  });

  await t.test('a straggler does not query into the next transaction of the connection', async () => {
    /** @type {Promise<unknown> | undefined} */
    let stragglers;
    /** @type {() => void} */
    let los = () => {};
    const secondRunning = new Promise(r => {
      los = /** @type {() => void} */ (r);
    });
    await imSystem(() =>
      k.transact(async (/** @type {any} */ t) => {
        stragglers = secondRunning.then(() => t.db.get('SELECT txid_current() AS id'));
        stragglers.catch(() => {});
      }),
    );
    await imSystem(() =>
      k.transact(async (/** @type {any} */ t) => {
        los();
        await assert.rejects(/** @type {Promise<unknown>} */ (stragglers), modul.TransactionEnded);
        assert.ok((await t.db.get('SELECT txid_current() AS id')).id, 'the second one itself keeps querying');
      }),
    );
  });
});
