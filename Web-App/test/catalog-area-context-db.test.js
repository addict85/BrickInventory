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

const sources = require('./helpers/sources');
const _req = sources.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { buildServices } = _req('startup/wiring.js');

const SN = '99872-1';
const INVENTORY = 987655;

/** An access that records every query and passes it to the real one. */
function countingAccess(original, sql) {
  const remember = f => (text, p) => {
    sql.push(text);
    return f(text, p);
  };
  const shell = z => ({ all: remember(z.all), get: remember(z.get), run: remember(z.run), exec: remember(z.exec) });
  return new Proxy(original, {
    get(target, name) {
      // The handle carries its access (tx.db) from which t is created: it counts too.
      if (name === 'transaction')
        return (fn, o) => target.transaction(tx => fn({ ...shell(tx), db: countingAccess(tx.db, sql) }), o);
      if (['all', 'get', 'run', 'exec'].includes(String(name))) return shell(target)[name];
      return Reflect.get(target, name);
    },
  });
}

test('catalog with its own access', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const route = async () => {
    await db.run('DELETE FROM rb_inventories WHERE id = $1', [INVENTORY]);
    await sources.testServices().externalSources.setQuotaBack('brickset');
  };
  t.after(async () => {
    sources.buildAndRequire();
    await route();
    await db.pool.end();
  });
  await route();
  await db.run('INSERT INTO rb_inventories (id, set_num, version) VALUES ($1, $2, 1)', [INVENTORY, SN]);

  const sql = [];
  const contexts = {};
  const { catalog } = buildServices(countingAccess(sources.testAccess(), sql), { contexts });

  await t.test('reading goes via the passed access', async () => {
    assert.equal(await catalog.newestInventory(SN), INVENTORY);
    assert.ok(
      sql.some(s => /FROM rb_inventories/.test(s)),
      `counted: ${sql.join(' | ').slice(0, 300)}`,
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
      `counted: ${sql.join(' | ').slice(0, 300)}`,
    );
  });
});
