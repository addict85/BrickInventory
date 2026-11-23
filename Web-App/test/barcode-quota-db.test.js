/**
 * The barcode search asks Rebrickable only through the counting client: every call lands in the
 * shared daily quota, and an exhausted quota stops the search before it reaches the network.
 * Rebrickable is a local HTTPS stub (helpers/https-stub.js), Brickset and the title search are
 * replaced at the wiring.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  rebrickableJson without dailyQuotaFree → red “every call …” (nothing counted) and “an exhausted
 *      quota …” (the stub is asked)
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testSources, testServices } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { httpsStub, reply } = require('./helpers/https-stub');

test('the barcode search counts its Rebrickable calls', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const setGlobal = (k, v) =>
    db.run(
      'INSERT INTO global_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [k, v],
    );
  t.after(async () => {
    await deleteGlobalValues('rebrickable_api_key');
    await db.run(`DELETE FROM global_settings WHERE key = 'api_limit_rebrickable'`);
    await db.pool.end().catch(() => {});
  });
  const { setGlobalSetting, deleteGlobalValues } = _req('src/settings/settings.js');
  await setGlobalSetting('rebrickable_api_key', 'rb-key');
  testSources(t, { getSetByEan: async () => null, productTitle: async () => null });
  const SN = `7${process.pid % 100000}-1`;
  const stub = await httpsStub(t, (c, res) => {
    if (c.path.includes('search='))
      return reply(res, 200, {
        count: 1,
        next: null,
        previous: null,
        results: [{ set_num: SN, name: 'Probe', year: 2021, num_parts: 100, theme_id: 1 }],
      });
    if (c.path.includes('/minifigs/')) return reply(res, 200, { count: 0, next: null, previous: null, results: [] });
    return reply(res, 200, { set_num: SN, name: 'Probe', year: 2021, num_parts: 100, theme_id: 1, external_ids: {} });
  });
  const { quotaOverview } = _req('src/externalSources/apiQuota.js');
  const counted = async () => (await quotaOverview('rebrickable')).count;

  await t.test('every call lands in the daily quota', async () => {
    const before = await counted();
    const hit = await testServices().sets.setToBarcode('5702017151502');
    assert.equal(hit?.set_number, SN, JSON.stringify({ hit, calls: stub.calls.map(c => c.host + c.path) }));
    const asked = stub.calls.filter(c => c.host === 'rebrickable.com').length;
    assert.ok(asked >= 2, `only ${asked} calls`);
    assert.equal((await counted()) - before, asked);
  });
  await t.test('an exhausted quota stops the search before the network', async () => {
    await setGlobal('api_limit_rebrickable', String(await counted()));
    const asked = stub.calls.length;
    await testServices().sets.setToBarcode('5702017151519');
    assert.equal(stub.calls.length, asked, 'Rebrickable was asked past the quota');
  });
});
