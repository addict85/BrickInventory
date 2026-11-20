/**
 * Der Kontext `t` einer Transaktion entsteht je Verbindung einmal, nicht je Transaktion
 * (db/database.ts connectionAccess, src/infra/bereich.ts buildContext). Dass er beständig
 * ist, darf nichts umleiten: Ein Nachzügler einer beendeten Transaktion, deren Verbindung
 * schon die nächste trägt, fragt nicht in die fremde hinein. Pool mit einer Verbindung.
 *
 * Gegenproben (14.11.2026, je einzeln):
 *   A  in buildContext `fn(ueber(tx.db))` → `fn(buildContext(rebuild(a, tx.db), zugang))` → rot:
 *      „zwei Transaktionen auf einer Verbindung teilen t“
 *   B  in newSpace die Bedingung `runningTx() !== stand` gestrichen → rot: „ein Nachzügler …“
 *      (seine Abfrage lief in der zweiten Transaktion)
 *   C  in connectionAccess `platz.stand = stand` gestrichen → rot: „ein Nachzügler …“
 *      (TransactionEnded auch für die zweite Transaktion selbst)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const DIST = path.join(__dirname, '..', 'dist');
const modul = require(path.join(DIST, 'db', 'database.js'));
const { buildServices } = require(path.join(DIST, 'startup', 'verdrahtung.js'));
const { konfig } = require(path.join(DIST, 'src', 'infra', 'konfig.js'));
const { inSystemContext } = require(path.join(DIST, 'src', 'infra', 'kontoKontext.js'));

test('Transaktionskontext je Verbindung', { concurrency: 1 }, async t => {
  const k0 = modul.dbKonfigFromEnvironment();
  const db = modul.createDb({ ...k0, pool: { ...k0.pool, max: 1 } });
  try {
    await db.get('SELECT 1');
  } catch (e) {
    await db.pool.end().catch(() => {});
    keineDb(t, e);
    return;
  }
  t.after(() => db.pool.end());
  /** @type {Record<string, any>} */
  const contexts = {};
  buildServices(db, { contexts, konfig: konfig() });
  const k = contexts.collection;
  const imSystem = (/** @type {() => Promise<any>} */ f) => inSystemContext('test', f);

  await t.test('zwei Transaktionen auf einer Verbindung teilen t und die Dienste darin', async () => {
    const t1 = await imSystem(() => k.transaktion(async (/** @type {any} */ t) => t));
    const t2 = await imSystem(() => k.transaktion(async (/** @type {any} */ t) => t));
    assert.equal(t1, t2);
    assert.equal(t1.catalog, t2.catalog, 'die tieferen Bereiche entstehen nicht neu');
    assert.notEqual(t1, k);
  });

  await t.test('ein Nachzügler fragt nicht in die nächste Transaktion der Verbindung', async () => {
    /** @type {Promise<unknown> | undefined} */
    let stragglers;
    /** @type {() => void} */
    let los = () => {};
    const secondRunning = new Promise(r => {
      los = /** @type {() => void} */ (r);
    });
    await imSystem(() =>
      k.transaktion(async (/** @type {any} */ t) => {
        stragglers = secondRunning.then(() => t.db.get('SELECT txid_current() AS id'));
        stragglers.catch(() => {});
      }),
    );
    await imSystem(() =>
      k.transaktion(async (/** @type {any} */ t) => {
        los();
        await assert.rejects(/** @type {Promise<unknown>} */ (stragglers), modul.TransactionEnded);
        assert.ok((await t.db.get('SELECT txid_current() AS id')).id, 'die zweite selbst fragt weiter');
      }),
    );
  });
});
