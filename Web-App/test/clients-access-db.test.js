/**
 * Clients know no domain area and no process store: key,
 * quota and throttle are given to every client at its creation
 * (createRebrickable(z) …), src/externalSources gives them to it from its access.
 *
 * Counter-checks (measured on 14.11.2026):
 *   A  in clients/rebrickable.ts a module-wide `let _z` set by every
 *      createRebrickable(z) and read in getRbKey() instead of `z` (the former
 *      verdrahteKlienten(): the last one wins) → red: “two clients …”
 *      (both fetches carried “key zweiter”)
 *   B  in createForeignSources() `key: async () => ''` → red: “via the
 *      services fetches carry …” (no fetch, result null)
 *   C  in createForeignSources() `count: async () => ({ allowed: true, count: 0,
 *      limit: 0 })` → red: the same test (the counter stands still)
 *
 * Rebrickable itself is not asked: https.get is a dummy.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

/** @type {{ path: string, key: string | undefined }[]} */
const fetches = [];
// @ts-expect-error — dummy with exactly what src/infra/fetch.ts uses.
https.get = (url, opts, cb) => {
  const u = new URL(url);
  fetches.push({ path: u.pathname, key: /** @type {any} */ (opts)?.headers?.Authorization });
  const req = new EventEmitter();
  setImmediate(() =>
    cb(
      /** @type {any} */ (
        Object.assign(Readable.from([JSON.stringify({ set_num: '10001-1', name: 'Attrappe' })]), {
          statusCode: 200,
          headers: {},
        })
      ),
    ),
  );
  return req;
};

/** An access without a database: fixed key, free quota, throttle without waiting. */
const accessWith = key => {
  const free = { waitForSlot: async () => {}, throttle: () => {} };
  return {
    key: async () => key,
    count: async () => ({ allowed: true, count: 1, limit: 10 }),
    quotaStatus: async () => ({ count: 1, limit: 10, remaining: 9 }),
    throttle: { foreground: free, background: free },
    bricksetReserve: async () => ({ attempt: 1, queued: true, atMost: 3 }),
    bricksetForgotten: async () => {},
  };
};

test('two clients in one process each ask with the key of their access', async () => {
  const { createRebrickable } = _req('clients/rebrickable.js');
  const { RbSet } = _req('clients/responses.js');
  const firstOne = createRebrickable(accessWith('erster'));
  const secondOne = createRebrickable(accessWith('zweiter'));
  fetches.length = 0;
  await firstOne.rebrickableJson('/lego/sets/10001-1/', RbSet);
  await secondOne.rebrickableJson('/lego/sets/10001-1/', RbSet);
  assert.deepEqual(
    fetches.map(a => a.key),
    ['key erster', 'key zweiter'],
  );
});

test('via the services fetches carry the stored key and count', { concurrency: 1 }, async t => {
  const db = S.testData();
  if (!(await dataOrSkip(t, _req))) return;
  const { setGlobalSetting, deleteGlobalValues } = _req('src/settings/settings.js');
  await setGlobalSetting('rebrickable_api_key', 'schluessel-zugang-1');
  t.after(async () => {
    await deleteGlobalValues('rebrickable_api_key');
    await db.pool.end().catch(() => {});
  });
  const todayDate = new Date().toISOString().slice(0, 10);
  const counter = async () =>
    Number(
      (
        await db.get("SELECT count FROM api_calls WHERE day = $1 AND api = 'rebrickable' AND account_id = 0", [
          todayDate,
        ])
      )?.count || 0,
    );
  const prior = await counter();

  const { RbSet } = _req('src/externalSources/index.js');
  fetches.length = 0;
  const response = await S.testServices().externalSources.sources.rebrickableJson('/lego/sets/10001-1/', RbSet);
  assert.deepEqual(response, { set_num: '10001-1', name: 'Attrappe' });
  assert.deepEqual(fetches, [{ path: '/api/v3/lego/sets/10001-1/', key: 'key schluessel-zugang-1' }]);
  assert.equal(await counter(), prior + 1);
});
