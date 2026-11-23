/**
 * Responses from Rebrickable and Brickset run through their zod schemas
 * (clients/responses.ts): a matching response arrives typed, an
 * unexpected shape is an error instead of empty fields. HTTP via a
 * dummy of https.get, key and quota via the real database.
 *
 * Counter-checks (measured on 11.11.2026):
 *   A  in rbGet() again `return JSON.parse(body)` instead of checkResponse → red:
 *      “Rebrickable: a response without set_num is an error”
 *   B  in parseResponse() (Brickset) the second check removed (`return data`)
 *      → red: “Brickset: a set without a number does not count as a hit”
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

/** Every request gets 200 with `payload` as JSON. */
async function withBody(payload, run) {
  const original = https.get;
  // @ts-expect-error — dummy with exactly what src/infra/fetch.ts uses.
  https.get = (_u, _o, atResponse) => {
    const r = Object.assign(Readable.from([Buffer.from(JSON.stringify(payload))]), { statusCode: 200, headers: {} });
    // @ts-expect-error — not a complete IncomingMessage
    setImmediate(() => atResponse(r));
    return Object.assign(new EventEmitter(), { destroy: () => {}, end: () => {} });
  };
  try {
    return await run();
  } finally {
    https.get = original;
  }
}

test('third-party responses against their schema', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const S = _req('src/settings/settings.js');
  const k = _req('src/externalSources/apiQuota.js');
  t.after(async () => {
    await db.run("DELETE FROM global_settings WHERE key IN ('rebrickable_api_key', 'brickset_api_key')");
    await db.pool.end().catch(() => {});
  });
  await S.setGlobalSetting('rebrickable_api_key', 'rb-test');
  await S.setGlobalSetting('brickset_api_key', 'bs-test');
  await k.setQuotaBack('rebrickable');
  await k.setQuotaBack('brickset');
  const rb = require('./helpers/sources').testServices().externalSources.sources;
  const bs = rb.brickset;

  await t.test('Rebrickable: a matching response arrives typed', async () => {
    const set = await withBody(
      { set_num: '10294-1', name: 'Titanic', year: 2021, theme_id: 721, num_parts: 9090 },
      () => rb.holeSet('10294-1'),
    );
    assert.equal(set.name, 'Titanic');
    assert.equal(set.num_parts, 9090);
  });

  await t.test('Rebrickable: a response without set_num is an error', async () => {
    await assert.rejects(
      withBody({ name: 'kaputt' }, () => rb.holeSet('10294-1')),
      /Rebrickable: unerwartete Antwort \(set_num/,
    );
  });

  await t.test('Brickset: a hit is read', async () => {
    const r = await withBody(
      {
        status: 'success',
        matches: 1,
        sets: [{ number: '10294', numberVariant: 1, name: 'Titanic', year: 2021, pieces: 9090 }],
      },
      () => bs.getSetByEan('5702016914313'),
    );
    assert.deepEqual(r, {
      set_number: '10294-1',
      name: 'Titanic',
      year: 2021,
      theme: null,
      pieces: 9090,
      image_url: null,
    });
  });

  await t.test('Brickset: a set without a number does not count as a hit', async () => {
    const r = await withBody({ status: 'success', matches: 1, sets: [{ name: 'ohne Nummer' }] }, () =>
      bs.getSetByEan('5702016914313'),
    );
    assert.equal(r, null);
  });
});
