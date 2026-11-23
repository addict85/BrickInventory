/**
 * The Rebrickable stage of the wanted resolution: only 404 means “unknown”, and
 * every other error ends the stage with a reason instead of silently counting
 * the remaining items as “not found”. HTTP runs over a dummy of
 * https.get, the quota over the real database.
 *
 * Counter-checks (measured 11.11.2026):
 *   A  in blPartToRb() `.catch(() => null)` again on both rbGet calls →
 *      red: “without a key …”, “server error 500 …”, “daily limit …”
 *   B  in resolveViaRebrickableOn() `catch { rbId = null; }` again → red:
 *      the same three
 *   C  in rbGet() `if (status === 404) return null;` removed → red: “404 is
 *      unknown, the run continues” (and “daily limit …”, reason stoerung)
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

/** Every request gets `status` with an empty JSON body. */
async function withResponse(status, run) {
  const original = https.get;
  let requests = 0;
  // @ts-expect-error — dummy with exactly what src/infra/fetch.ts uses.
  https.get = (_u, _o, atResponse) => {
    requests++;
    const r = Object.assign(Readable.from([Buffer.from('{}')]), { statusCode: status, headers: {} });
    // @ts-expect-error — not a complete IncomingMessage
    setImmediate(() => atResponse(r));
    return Object.assign(new EventEmitter(), { destroy: () => {}, end: () => {} });
  };
  try {
    return { ergebnis: await run(), requests };
  } finally {
    https.get = original;
  }
}

const items = n =>
  Array.from({ length: n }, (_, i) => ({
    items: { kind: 'part', blId: `9${i}9${i}`, blColor: null, quantity: 1, condition: null, maxPrice: null },
    rbId: null,
    rbColor: null,
    rbColorName: null,
    rbColorHex: null,
    confidence: null,
    colorPending: false,
  }));

test('wanted resolution via Rebrickable aborts with a reason', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const S = _req('src/settings/settings.js');
  const k = _req('src/externalSources/apiQuota.js');
  const { resolveViaRebrickableOn } = _req('src/wanted/wantedResolution.js');
  await db.run("DELETE FROM global_settings WHERE key = 'rebrickable_api_key'");

  await t.test('without a key: aborted with reason kein_schluessel', async () => {
    const r = await resolveViaRebrickableOn(items(3));
    assert.equal(r.aborted, 'no_key');
    assert.equal(r.found, 0);
  });

  await S.setGlobalSetting('rebrickable_api_key', 'testschluessel');
  await k.setQuotaBack('rebrickable');

  await t.test('404 is unknown, the run continues', async () => {
    const { ergebnis: outcome, requests } = await withResponse(404, () => resolveViaRebrickableOn(items(3)));
    assert.equal(outcome.aborted, undefined);
    assert.equal(outcome.asked, 3);
    // Two paths per item (the number itself, then the filter).
    assert.equal(requests, 3 * 2);
  });

  await t.test('server error 500 is not “unknown”', async () => {
    const { ergebnis: outcome, requests } = await withResponse(500, () => resolveViaRebrickableOn(items(3)));
    assert.equal(outcome.aborted, 'failure');
    assert.equal(requests, 1, 'kept asking after the first error');
  });

  await t.test('daily limit: aborted with reason kontingent', async () => {
    await db.run(`INSERT INTO global_settings (key, value) VALUES ('api_limit_rebrickable', '1')
                  ON CONFLICT (key) DO UPDATE SET value = '1'`);
    await k.setQuotaBack('rebrickable');
    const { ergebnis: outcome, requests } = await withResponse(404, () => resolveViaRebrickableOn(items(3)));
    assert.equal(outcome.aborted, 'quota');
    assert.equal(requests, 1, 'only the one quota call went out');
  });
});
