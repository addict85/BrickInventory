/**
 * The database access is created by createDb(konfig), not on import:
 * whoever loads db/database opens no pool; every access has its own
 * pool and its own transaction. An access of the process does not exist:
 * the entry point (server.ts, scripts, test helper) holds its own.
 *
 * Counter-checks (measured 09.11.2026, each alone):
 *   A  in db/database.ts again `const pool = new Pool(...)` at the top level →
 *      red: “the import opens no pool” (1 instead of 0)
 *   B  in createDb() txClient without the comparison `t.db === ich` → red: “two accesses,
 *      two transactions” (b.inTransaction() true in a's transaction)
 *   C  (11.11.2026) `export const get = …` with an access of the process back
 *      in db/database.ts → red: “db/database keeps no access of the process”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const DIST = require('./helpers/sources').DIST;
const { noDb } = require('./helpers/db');

test('the import opens no pool', () => {
  // In its own process: here the test run has already used the access.
  const script = `
    const pg = require('pg'); let n = 0; const Real = pg.Pool;
    pg.Pool = class extends Real { constructor(...a) { n++; super(...a); } };
    const db = require(${JSON.stringify(path.join(DIST, 'db', 'database.js'))});
    const nachImport = n;
    const ownOne = db.createDb(db.dbConfigFromEnvironment());
    const nachFabrik = n;
    console.log(JSON.stringify([nachImport, nachFabrik]));
    ownOne.pool.end().then(() => process.exit(0));`;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: 'postgres://niemand:x@127.0.0.1:1/keine' },
  });
  assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), [0, 1], 'Import, Fabrik');
});

test('two accesses, two transactions', async t => {
  const db = testData();
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  const mod = require(path.join(DIST, 'db', 'database.js'));
  const a = mod.createDb(mod.dbConfigFromEnvironment()),
    b = mod.createDb(mod.dbConfigFromEnvironment());
  t.after(async () => {
    await a.pool.end();
    await b.pool.end();
    await db.pool.end().catch(() => {});
  });
  assert.notEqual(a.pool, b.pool);
  const SETTING_KEY = `fabrik-${process.pid}`;
  await a.run('DELETE FROM global_settings WHERE key = $1', [SETTING_KEY]);
  await a.transaction(async tx => {
    assert.equal(a.inTransaction(), true);
    assert.equal(b.inTransaction(), false, 'the transaction of a does not apply to b');
    await tx.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [SETTING_KEY, 'x']);
    assert.ok(await tx.get('SELECT 1 FROM global_settings WHERE key = $1', [SETTING_KEY]), 'a sees its own row');
    assert.equal(
      await b.get('SELECT 1 FROM global_settings WHERE key = $1', [SETTING_KEY]),
      undefined,
      'b sees nothing unfinished',
    );
  });
  assert.ok(await b.get('SELECT 1 FROM global_settings WHERE key = $1', [SETTING_KEY]), 'after COMMIT b sees it');
  await a.run('DELETE FROM global_settings WHERE key = $1', [SETTING_KEY]);
});

test('db/database keeps no access of the process', () => {
  const mod = require(path.join(DIST, 'db', 'database.js'));
  const proc = [
    'pool',
    'all',
    'get',
    'run',
    'exec',
    'transaction',
    'initSchema',
    'initSchemaOnce',
    'standardDb',
    'setzeStandardDb',
    'inTransaction',
    'getPoolStats',
  ].filter(n => n in mod);
  assert.deepEqual(proc, []);
  assert.equal(typeof mod.createDb, 'function', 'the factory stays');
});
