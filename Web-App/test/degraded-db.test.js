/**
 * A response made of substitute values says so: `degradiert` names the parts that
 * only carry a 0 or null after an error (src/infra/result.ts, Abstriche).
 *
 * Counter-checks (measured 09.11.2026, each alone):
 *   A  in cacheStatistics() `...ab.angabe()` deleted → red: “the cache numbers
 *      say which part is missing” (degradiert undefined)
 *   B  in Abstriche.oder() the entry in `teile` omitted → red: both subtests
 *   C  in changeSet() again `valueOr(versuche(…))` for the purchase price → red:
 *      “a quantity increase without market price says so”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

let cacheBroken = false,
  priceBroken = false;
const Module = require('node:module');
const _original = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = _original.call(this, name, ...rest);
  if (typeof name !== 'string') return m;
  if (/(?:catalog[/\\]|^\.\/)bricklinkPrices(\.js)?$/.test(name))
    return new Proxy(m, {
      get: (t, k) =>
        k === 'getCacheStats'
          ? async (...a) => {
              if (cacheBroken) throw new Error('Cache not readable');
              return t[k](...a);
            }
          : t[k],
    });
  if (/(?:finances[/\\]|^\.\/)financeCalc(\.js)?$/.test(name))
    return new Proxy(m, {
      get: (t, k) =>
        k === 'setState'
          ? async (...a) => {
              if (priceBroken) throw new Error('Condition not readable');
              return t[k](...a);
            }
          : t[k],
    });
  return m;
};

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');

test('substitute values are named in the response', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const NAME = `degr-${process.pid}`,
    SN = `${60000 + (process.pid % 9000)}-1`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get("INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id", [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM set_acquisitions WHERE set_number = $1', [SN]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('the cache numbers say which part is missing', async () => {
    const { cacheStats: cacheStatistics } = _req('src/management/service.js');
    const heil = await cacheStatistics();
    assert.equal(heil.degraded, undefined, 'no statement without an error');
    cacheBroken = true;
    try {
      const r = await cacheStatistics();
      assert.deepEqual(r.degraded, ['cache']);
      assert.equal(r.prices, 0, 'the substitute value stays — but now recognizable');
      assert.equal(typeof r.price_stale, 'number');
    } finally {
      cacheBroken = false;
    }
  });

  await t.test('a quantity increase without a market price says so', async () => {
    await holdsSet(db, uid, SN, 0);
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, purchase_price, condition, quantity)
                  VALUES ($1, $2, 10, 'N', 1)`,
      [uid, SN],
    );
    const { changeSet } = require('./helpers/sources').areaPage('sets');
    // Sets asks for the condition via the finance services of its context (sk.finances).
    const finances = require('./helpers/sources').testArea('finances');
    const stateReal = finances.setState;
    finances.setState = async (...a) => {
      if (priceBroken) throw new Error('Condition not readable');
      return stateReal(...a);
    };
    t.after(() => {
      finances.setState = stateReal;
    });
    priceBroken = true;
    let r;
    try {
      r = await changeSet(uid, SN, { quantity: 2 });
    } finally {
      priceBroken = false;
    }
    assert.equal(r.quantity, 2, 'the quantity is written anyway');
    assert.deepEqual(r.degraded, ['kaufpreis']);
    const withoutPrice = await db.get(
      'SELECT COUNT(*)::int AS n FROM set_acquisitions WHERE user_id = $1 AND set_number = $2 AND purchase_price IS NULL',
      [uid, SN],
    );
    assert.equal(withoutPrice.n, 1, 'the new acquisition without a price — the follow-up fetches it');
    assert.equal((await changeSet(uid, SN, { quantity: 2 })).degraded, undefined);
  });
});
