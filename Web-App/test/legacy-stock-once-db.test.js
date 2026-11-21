/**
 * The re-keying of the legacy data runs once per database, not at
 * every start: afterwards a marker stands in the run state. If it is missing (fresh
 * database, restored older backup), it runs again.
 *
 * Counter-checks (measured 05.11.2026):
 *   A  the query of the marker in legacyStockUpgrade(require('./helpers/sources').testServices()) deleted → red:
 *      “the second start leaves the legacy data alone”
 *   B  setzeZustand(LEGACY_STOCK_BRAND, …) deleted → red: “the first start
 *      upgrades and sets the marker” and “the second start …”
 *
 * That the re-keying itself works is shown by secret-context-db and
 * voucher-number-encrypted-db on a fresh database.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('legacy data once per database', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { legacyStockUpgrade, LEGACY_STOCK_BRAND } = _req('startup/database.js');
  const { liesZustand, deleteState } = require('./helpers/sources').testArea('jobQueue').laufzustand;
  await deleteState(LEGACY_STOCK_BRAND);

  await t.test('the first start upgrades and sets the marker', async () => {
    const r = await legacyStockUpgrade(require('./helpers/sources').testServices());
    assert.ok(r && typeof r.umgeschluesselt === 'number', JSON.stringify(r));
    assert.ok(await liesZustand(LEGACY_STOCK_BRAND));
  });

  await t.test('the second start leaves the legacy data alone', async () => {
    assert.equal(await legacyStockUpgrade(require('./helpers/sources').testServices()), null);
  });

  await t.test('without the marker (older backup restored) it runs again', async () => {
    await deleteState(LEGACY_STOCK_BRAND);
    assert.notEqual(await legacyStockUpgrade(require('./helpers/sources').testServices()), null);
  });
});
