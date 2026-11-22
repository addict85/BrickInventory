/**
 * The catalog scope gets its database access passed in (src/catalog/area.ts,
 * built by buildServices in startup/wiring.ts): reading, writing and
 * transactions of the services go through this access. A process store
 * they could fall back to no longer exists (ban in test/ratschen.test.js).
 *
 * Counter-checks (A, B measured on 10.11.2026, each alone; C on 14.11.2026):
 *   A  in src/catalog/rbInventory.ts newestInventory() via the repository with
 *      standardDb() instead of via the context → red: “reading goes through the passed
 *      access” (counted: nothing)
 *   B  in src/externalSources/apiQuota.ts (then src/catalog/) the transaction via standardDb() → red:
 *      “the transaction goes through the passed access”
 *   C  in buildAreas (startup/wiring.ts) createCatalog with { db: testAccess() }
 *      instead of db → red: “reading goes …” (counted: nothing); since
 *      15.11.2026 the external sources count the quota themselves (no passing through in the catalog).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { buildServices } = _req('startup/wiring.js');

const SN = '99872-1';
const INVENTORY = 987655;

/** An access that records every query and passes it to the real one. */
function countingAccess(echt, sql) {
  const remember = f => (text, p) => {
    sql.push(text);
    return f(text, p);
  };
  const huelle = z => ({ all: remember(z.all), get: remember(z.get), run: remember(z.run), exec: remember(z.exec) });
  return new Proxy(echt, {
    get(ziel, name) {
      // The handle carries its access (tx.db) from which t is created: it counts too.
      if (name === 'transaction')
        return (fn, o) => ziel.transaction(tx => fn({ ...huelle(tx), db: countingAccess(tx.db, sql) }), o);
      if (['all', 'get', 'run', 'exec'].includes(String(name))) return huelle(ziel)[name];
      return Reflect.get(ziel, name);
    },
  });
}

test('catalog with its own access', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const weg = async () => {
    await db.run('DELETE FROM rb_inventories WHERE id = $1', [INVENTORY]);
    await quellen.testServices().externalSources.setQuotaBack('brickset');
  };
  t.after(async () => {
    quellen.buildAndRequire();
    await weg();
    await db.pool.end();
  });
  await weg();
  await db.run('INSERT INTO rb_inventories (id, set_num, version) VALUES ($1, $2, 1)', [INVENTORY, SN]);

  const sql = [];
  const contexts = {};
  const { catalog: katalog } = buildServices(countingAccess(quellen.testAccess(), sql), { contexts });

  await t.test('reading goes via the passed access', async () => {
    assert.equal(await katalog.newestInventory(SN), INVENTORY);
    assert.ok(
      sql.some(s => /FROM rb_inventories/.test(s)),
      `gezählt: ${sql.join(' | ').slice(0, 300)}`,
    );
  });

  await t.test('the transaction goes via the passed access', async () => {
    sql.length = 0;
    const { checkAndCountQuota } = require(
      require('node:path').join(require('./helpers/sources').ROOT, 'dist/src/externalSources/apiQuota.js'),
    );
    const r = await checkAndCountQuota(contexts.externalSources, 'brickset');
    assert.equal(r.allowed, true);
    assert.ok(
      sql.some(s => /INSERT INTO api_calls/.test(s)),
      `gezählt: ${sql.join(' | ').slice(0, 300)}`,
    );
  });
});
