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
const { keineDb } = require('./helpers/db');

test('the import opens no pool', () => {
  // In its own process: here the test run has already used the access.
  const script = `
    const pg = require('pg'); let n = 0; const Echt = pg.Pool;
    pg.Pool = class extends Echt { constructor(...a) { n++; super(...a); } };
    const db = require(${JSON.stringify(path.join(DIST, 'db', 'database.js'))});
    const nachImport = n;
    const eigener = db.createDb(db.dbKonfigFromEnvironment());
    const nachFabrik = n;
    console.log(JSON.stringify([nachImport, nachFabrik]));
    eigener.pool.end().then(() => process.exit(0));`;
  const aus = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: 'postgres://niemand:x@127.0.0.1:1/keine' },
  });
  assert.deepEqual(JSON.parse(aus.trim().split('\n').pop()), [0, 1], 'Import, Fabrik');
});

test('two accesses, two transactions', async t => {
  const db = testData();
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const modul = require(path.join(DIST, 'db', 'database.js'));
  const a = modul.createDb(modul.dbKonfigFromEnvironment()),
    b = modul.createDb(modul.dbKonfigFromEnvironment());
  t.after(async () => {
    await a.pool.end();
    await b.pool.end();
    await db.pool.end().catch(() => {});
  });
  assert.notEqual(a.pool, b.pool);
  const SCHL = `fabrik-${process.pid}`;
  await a.run('DELETE FROM global_settings WHERE key = $1', [SCHL]);
  await a.transaction(async tx => {
    assert.equal(a.inTransaction(), true);
    assert.equal(b.inTransaction(), false, 'die Transaktion von a gilt nicht für b');
    await tx.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [SCHL, 'x']);
    assert.ok(await tx.get('SELECT 1 FROM global_settings WHERE key = $1', [SCHL]), 'a sieht die eigene Zeile');
    assert.equal(
      await b.get('SELECT 1 FROM global_settings WHERE key = $1', [SCHL]),
      undefined,
      'b sieht nichts Unfertiges',
    );
  });
  assert.ok(await b.get('SELECT 1 FROM global_settings WHERE key = $1', [SCHL]), 'nach COMMIT sieht b sie');
  await a.run('DELETE FROM global_settings WHERE key = $1', [SCHL]);
});

test('db/database keeps no access of the process', () => {
  const modul = require(path.join(DIST, 'db', 'database.js'));
  const prozess = [
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
  ].filter(n => n in modul);
  assert.deepEqual(prozess, []);
  assert.equal(typeof modul.createDb, 'function', 'die Fabrik bleibt');
});
