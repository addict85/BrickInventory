/**
 * One transaction form: in k.transact(t => …) the body queries via `t`. A query
 * via the unbound access (k.db, a captured k) throws UnboundQuery instead of
 * being silently redirected into the transaction; services of other scopes, called via `t`,
 * run inside it. Stock locks are an option of k.transact.
 *
 * Counter-checks (measured 14.11.2026, each on its own):
 *   A  in txStand() (db/database.ts) the line `if (freigabe.getStore() !== t) throw …`
 *      deleted → red: “k.db in the body throws …”, “a captured k …”, “a service of
 *      another scope …” (k.household ran silently in the transaction)
 *   B  in gebundenAn() (src/infra/area.ts) the dependencies passed on unwrapped
 *      (`aus[name] = wert`) → red: “a service of another scope via t …”
 *      (UnboundQuery from the household)
 *   C  in transaction() (db/database.ts) the preamble with lockInventories() deleted → red:
 *      “a stock lock holds up …” and “opposite directions …” (nobody waited, until() timed out);
 *      likewise test/lock-namespaces-db.test.js “an account's inventory lock …”
 *   D  the sorting deleted in lockInventories() → red: “opposite directions …”
 *      (the second waited for the lock of the larger account)
 *   F  in anTransaktion() the line `notification: huelle(…)` deleted → red: “a signal
 *      via t …” (notify() ran via the unbound access and swallowed UnboundQuery)
 *   E  in inSystemFrame() (src/infra/area.ts) again `return f()` instead of throwing
 *      → red: “a service in the system context inside a transaction without it throws”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testContext, testAccess, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const dbModule = require(path.join(__dirname, '..', 'dist', 'db', 'database.js'));
const { asRequest, inSystemContext } = require(path.join(__dirname, '..', 'dist', 'src', 'infra', 'accountContext.js'));
const { SystemFrameInTransaction } = require(path.join(__dirname, '..', 'dist', 'src', 'infra', 'area.js'));

const PID = 'SELECT pg_backend_pid() AS p';
const { until } = require('./helpers/time');
const { LOCKS } = require(path.join(__dirname, '..', 'dist', 'src', 'infra', 'lockNamespaces.js'));

test('transaction: explicitly via t', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const k = testContext('sets');
  const uid = (
    await testData().get(
      `INSERT INTO users (username, password_hash) VALUES ('tx_explizit_${process.pid}', 'x') RETURNING id`,
    )
  ).id;
  t.after(async () => {
    await testData().run('DELETE FROM users WHERE id = $1', [uid]);
    await testAccess()
      .pool.end()
      .catch(() => {});
  });

  await t.test('k.db in the body throws, t.db goes through the transaction', async () => {
    await k.transact(async tt => {
      const owned = (await tt.db.get(PID)).p;
      await assert.rejects(k.db.get(PID), dbModule.UnboundQuery);
      await assert.rejects(
        k.db.transaction(async () => {}),
        dbModule.UnboundQuery,
      );
      assert.equal((await tt.db.get(PID)).p, owned, 'the transaction stays usable');
    });
    // Afterwards k is free again.
    assert.ok((await k.db.get(PID)).p > 0);
  });

  await t.test('a signal via t belongs to the transaction and arrives with the COMMIT', async () => {
    const channel = `tx_explizit_${process.pid}`;
    const listener = await testAccess().ownConnection();
    try {
      const belongsTo = [];
      listener.on('notification', m => belongsTo.push(m.channel));
      await listener.query(`LISTEN ${channel}`);
      await k.transact(async tt => {
        await tt.db.notification.notify(channel);
      });
      await until(() => belongsTo.length > 0);
      assert.deepEqual(belongsTo, [channel]);
    } finally {
      await listener.end();
    }
  });

  await t.test('a captured k in an inner transaction throws as well', async () => {
    await k.transact(async outer => {
      await outer.transact(async inner => {
        await inner.db.get('SELECT 1');
        await assert.rejects(k.db.get('SELECT 1'), dbModule.UnboundQuery);
      });
    });
  });

  await t.test('a service of another scope via t runs in the transaction', async () => {
    const r = await k.transact(async tt => {
      await tt.db.run(`UPDATE users SET first_name = first_name WHERE id = $1`, [uid]);
      // scopeIds asks the household via its own access; called via t it belongs to it.
      const ids = await tt.household.scopeIds(uid);
      await assert.rejects(k.household.writeScope(uid), dbModule.UnboundQuery);
      return ids;
    });
    assert.deepEqual(r, [uid]);
  });

  /** What another connection is currently waiting for: the stock lock for this key? */
  const waitsOn = async key =>
    !!(await testData().get(
      `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = $1
          AND objid = ((hashtext($2)::bigint + 4294967296) % 4294967296)::oid`,
      [LOCKS.INVENTORY, key],
    ));

  /** The first transaction holds its locks until `frei()`; the second starts from outside (a
   * start in the body of the first would query via the unbound access). */
  const hold = async block => {
    /** @type {(w?: unknown) => void} */
    let inside = () => {};
    /** @type {(w?: unknown) => void} */
    let free = () => {};
    const inner = new Promise(r => {
      inside = r;
    });
    const result = new Promise(r => {
      free = r;
    });
    const done = k.transact(
      async () => {
        inside();
        await result;
      },
      { locks: block },
    );
    await inner;
    return { free, done };
  };

  await t.test('a stock lock holds up the second transaction until the first ends', async () => {
    const block = [{ account: uid, key: 'probe' }];
    const expiry = [];
    const first = await hold(block);
    const second = k.transact(async () => expiry.push('zweite an'), { locks: block });
    await until(() => waitsOn(`${uid}|probe`));
    expiry.push('erste aus');
    first.free();
    await Promise.all([first.done, second]);
    assert.deepEqual(expiry, ['erste aus', 'zweite an']);
  });

  await t.test('opposite directions do not deadlock: locking is ascending', async () => {
    // If the first holds both locks, the second waits for its FIRST. Ascending, that is the one
    // of the smaller account, no matter in which order they are named.
    const two = uid + 1_000_000;
    const opened = account => ({ account: account, key: 'x' });
    const first = await hold([opened(uid), opened(two)]);
    const second = k.transact(async () => {}, { locks: [opened(two), opened(uid)] });
    await until(async () => (await waitsOn(`${uid}|x`)) || (await waitsOn(`${two}|x`)));
    const onSmaller = await waitsOn(`${uid}|x`);
    first.free();
    await Promise.all([first.done, second]);
    assert.equal(onSmaller, true, 'the second waits for the lock of the smaller account');
  });

  await t.test('a service in the system context inside a transaction without it throws', async () => {
    const account = testContext('account');
    await asRequest({ apiUser: { user_id: uid } }, () =>
      account.transact(async tt => {
        await assert.rejects(async () => tt.accesses.validToken('gibt-es-nicht'), SystemFrameInTransaction);
      }),
    );
    // Opened in the system context, it also applies to the service.
    assert.equal(
      await inSystemContext('probe', () => account.transact(tt => tt.accesses.validToken('gibt-es-nicht'))),
      undefined,
    );
  });
});
