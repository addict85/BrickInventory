/**
 * The tick of the instruction queue applies to real fetches, not passes: for a
 * set with an instruction setAnleitungenLaden asks no foreign server.
 *
 * What is counted are the fetches themselves (every source of the services, every http(s) request),
 * no duration: that also measured the setup of services and connections and broke under load.
 *
 * Counter-check (measured 14.11.2026): in setAnleitungenLaden the return at
 * `existing > 0` deleted → red (“no foreign server”: scrapeInstructions and
 * brickset.getInstructions counted).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');

test('an already supplied set triggers no fetch', async t => {
  const db = testData();
  try {
    await db.initSchemaOnce();
  } catch (e) {
    noDb(t, e);
    return;
  }

  const fetches = [];
  const nein = name => async () => {
    fetches.push(name);
    throw new Error(`${name}: no network in the test`);
  };
  testSources(t, {
    scrapeInstructions: nein('scrapeInstructions'),
    brickset: { getInstructions: nein('brickset.getInstructions') },
  });
  for (const [name, modul] of [
    ['http', http],
    ['https', https],
  ])
    for (const kind of ['request', 'get']) {
      const echt = modul[kind];
      t.mock.method(/** @type {any} */ (modul), kind, (/** @type {any[]} */ ...a) => {
        fetches.push(`${name}.${kind}`);
        return echt.apply(modul, a);
      });
    }

  const ins = _req('src/catalog/instructions.js');
  const sn = '99999-1';
  // Even if a check fails: an open pool would keep the file until the time limit.
  t.after(async () => {
    await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [sn]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [sn]);
  await db.run(
    `INSERT INTO shared_instructions (set_number, url, description, local_path)
     VALUES ($1, 'http://example.invalid/a.pdf', 'A', '/data/instructions/a.pdf')`,
    [sn],
  );

  const count = await ins.loadSetInstructions(sn, null);

  assert.deepEqual(fetches, [], 'no foreign server for a supplied set');
  assert.equal(ins.lastFetchWasExternal(), false, 'The tick must not wait after this pass');
  assert.equal(count, 1, 'The existing instruction was not counted');
});
