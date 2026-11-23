/**
 * The market prices of a wishlist item: a number no catalog knows triggers
 * no BrickLink call (all accounts share the daily quota).
 *
 * Counter-checks (measured 08.11.2026):
 *   A  the catalog check in pricesForBothConditions() removed
 *      → red: “invented number …” and “a no-price marker …”
 *   B  setInCatalog() always says no (even for known sets)
 *      → red: “known set is fetched”
 *   C  setInCatalog() counts the NONE marker as a hit
 *      → red: “a no-price marker is not a catalog entry”
 *
 * BrickLink itself is not asked: https.get is a dummy that counts every
 * call. Prerequisite: test DB via TEST_DATABASE_URL.
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
  calls.push(new URL(url).pathname);
  const req = new EventEmitter();
  const data = { avg_price: '12.50', qty_avg_price: '12.00', min_price: '10', max_price: '15', total_quantity: '3' };
  setImmediate(() => {
    cb(
      /** @type {any} */ (
        Object.assign(Readable.from([JSON.stringify({ meta: { code: 200 }, data })]), { statusCode: 200, headers: {} })
      ),
    );
  });
  return req;
};

test('wishlist item prices call BrickLink only for sets in the catalog', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const INVENTED = '98765-1';
  const KNOWN = '98766-1';
  const MARKED = '98767-1';
  const access = ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'];
  const put = async (k, v) =>
    db.run(`INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`, [
      k,
      v,
    ]);
  const alterAccess = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [access]);
  for (const k of access) await put(k, 'test');
  await _req('src/settings/settings.js').reencryptLegacyGlobalValues();
  await db.run('DELETE FROM users WHERE username = $1', ['preise_erfunden']);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ('preise_erfunden','x') RETURNING id`))
    .id;
  await db.run(
    `INSERT INTO rb_sets (set_num, name, year, num_parts) VALUES ($1,'Bekannt',2020,100)
                ON CONFLICT (set_num) DO NOTHING`,
    [KNOWN],
  );
  await db.run(
    `INSERT INTO catalog_cache (set_number, bl_type, is_gear) VALUES ($1,'NONE',true)
                ON CONFLICT (set_number) DO UPDATE SET bl_type='NONE', is_gear=true`,
    [MARKED],
  );
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM rb_sets WHERE set_num = $1', [KNOWN]);
    await db.run('DELETE FROM catalog_cache WHERE set_number = ANY($1)', [[MARKED, KNOWN, INVENTED]]);
    await db.run('DELETE FROM price_cache WHERE set_number = ANY($1)', [[KNOWN, INVENTED]]);
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [access]);
    for (const z of alterAccess) await put(z.key, z.value);
    await db.pool.end().catch(() => {});
  });
  const { pricesForBothConditions } = _req('src/wanted/wanted.js');

  await t.test('invented number: no BrickLink call', async () => {
    calls.length = 0;
    const r = await pricesForBothConditions(uid, INVENTED);
    assert.deepEqual(r.current, {});
    assert.equal(calls.length, 0, `fetched needlessly: ${calls.join(' | ')}`);
  });

  await t.test('a no-price marker is not a catalog entry', async () => {
    calls.length = 0;
    const r = await pricesForBothConditions(uid, MARKED);
    assert.deepEqual(r.current, {});
    assert.equal(calls.length, 0, `fetched needlessly: ${calls.join(' | ')}`);
  });

  await t.test('known set is fetched', async () => {
    calls.length = 0;
    const r = await pricesForBothConditions(uid, KNOWN);
    assert.ok(calls.length > 0, 'the dummy saw no call — the counter-check above would prove nothing');
    assert.equal(parseFloat(String(r.current.N.avg_price)), 12.5);
  });
});
