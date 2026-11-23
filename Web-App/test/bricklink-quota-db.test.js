/**
 * Every HTTP call to BrickLink counts in the daily quota — including the
 * fallbacks (sold → stock) that used to run along for free.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  the count removed in bricklinkRequest() → red: both cases
 *   B  in fetchPrice back to checkAndCountQuota instead of quotaFree
 *      → red: both cases (the pre-check counts too)
 *   C  in bricklinkRequest the abort on an exhausted quota removed
 *      → red: “an exhausted quota also stops the fallback”
 *
 * BrickLink itself is not asked: https.get is replaced by a dummy
 * that delivers nothing for “sold” and a price for “stock”.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

/** @type {string[]} */
const calls = [];
// @ts-expect-error — dummy with exactly what clients/bricklink.ts uses.
https.get = (url, _opts, cb) => {
  const u = new URL(url);
  calls.push(u.pathname + u.search);
  const req = new EventEmitter();
  const kind = u.searchParams.get('guide_type');
  const data =
    kind === 'stock'
      ? { avg_price: '12.50', qty_avg_price: '12.00', min_price: '10', max_price: '15', total_quantity: '3' }
      : { avg_price: '0', qty_avg_price: '0', min_price: '0', max_price: '0', total_quantity: '0' };
  setImmediate(() => {
    cb(
      /** @type {any} */ (
        Object.assign(Readable.from([JSON.stringify({ meta: { code: 200 }, data })]), { statusCode: 200, headers: {} })
      ),
    );
  });
  return req;
};

const counter = async () =>
  Number(
    (
      await db.get(`SELECT count FROM api_calls WHERE day = $1 AND api = 'bricklink' AND account_id = 0`, [
        new Date().toISOString().slice(0, 10),
      ])
    )?.count || 0,
  );

test('BrickLink quota per HTTP call', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const SN = `91${process.pid % 10000}-1`;
  const todayDate = new Date().toISOString().slice(0, 10);
  const prior = await db.get(`SELECT value FROM global_settings WHERE key = 'api_limit_bricklink'`);
  const put = async (k, v) =>
    db.run(`INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`, [
      k,
      v,
    ]);
  const newTag = async () => {
    await db.run(`DELETE FROM api_calls WHERE day = $1 AND api = 'bricklink'`, [todayDate]);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SN]);
    calls.length = 0;
  };
  const access = ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'];
  const alterAccess = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [access]);
  for (const k of access) await put(k, 'test');
  await _req('src/settings/settings.js').reencryptLegacyGlobalValues();
  const { fetchPrice } = _req('src/finances/financeCalc.js');
  t.after(async () => {
    await put('api_limit_bricklink', prior?.value ?? '4000');
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [access]);
    for (const z of alterAccess) await put(z.key, z.value);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SN]);
    await db.run('DELETE FROM price_history WHERE set_number = $1', [SN]);
    await db.pool.end().catch(() => {});
  });

  await t.test('sold and stock count once each', async () => {
    await put('api_limit_bricklink', '100');
    await newTag();
    const p = await fetchPrice(SN, 'N', 'sold', 'EUR', 24);
    assert.equal(parseFloat(p.avg_price), 12.5, 'the fallback to offers delivered no price');
    assert.equal(calls.length, 2, `expected two fetches, seen: ${calls.join(' | ')}`);
    assert.equal(await counter(), 2, 'the quota does not count every fetch');
  });

  await t.test('an exhausted quota also stops the fallback', async () => {
    await put('api_limit_bricklink', '1');
    await newTag();
    await fetchPrice(SN, 'N', 'sold', 'EUR', 24).catch(() => null);
    assert.equal(calls.length, 1, `fetched beyond the limit: ${calls.join(' | ')}`);
    assert.equal(await counter(), 1);
  });
});
