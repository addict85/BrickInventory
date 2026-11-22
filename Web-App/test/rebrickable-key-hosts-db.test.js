/**
 * The Rebrickable key only goes to rebrickable.com — not even to another
 * host of the API list when a response points there with `next`.
 *
 * Counter-checks (measured on 08.11.2026):
 *   A  the check of `next` removed in fetchSetParts AND httpsGetRobust again with
 *      ALLOWED_API_HOSTS → red: “next on api.upcitemdb.com …” (fetch with key seen)
 *   B  only the host choice in httpsGetRobust back to ALLOWED_API_HOSTS (next check stays)
 *      → red: “fetches with key …” (the next check alone does not catch this path)
 *   C  rebrickableRaw again with ALLOWED_API_HOSTS → red: “rebrickableRaw reaches no other host”
 *   D  only the next check removed (host choice stays) → STAYS GREEN: the host choice alone
 *      holds back the key; the next check is the early, readable net in front of it.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (the key lies in global_settings).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test.after(async () => {
  await db.pool.end().catch(() => {});
});

/** @type {Array<{ url: string, kopf: Record<string, string> }>} */
const fetches = [];
let responseFor = (/** @type {string} */ _url) => ({ status: 404, body: '' });
// @ts-expect-error — dummy with exactly what src/infra/fetch.ts uses.
https.get = (url, opt, cb) => {
  fetches.push({ url: String(url), kopf: { .../** @type {Record<string, string>} */ (opt?.headers) } });
  const { status, body } = responseFor(String(url));
  const req = new EventEmitter();
  setImmediate(() => {
    const r = /** @type {any} */ (new EventEmitter());
    r.statusCode = status;
    r.headers = {};
    r.resume = () => {};
    r.destroy = () => {};
    cb(r);
    setImmediate(() => {
      r.emit('data', Buffer.from(body));
      r.emit('end');
    });
  });
  return req;
};

test('the Rebrickable key stays with rebrickable.com', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const S = _req('src/settings/settings.js');
  const vorher = await S.getGlobalSetting('rebrickable_api_key');
  await S.setGlobalSetting('rebrickable_api_key', 'geheim-123');
  t.after(async () => {
    if (vorher) await S.setGlobalSetting('rebrickable_api_key', vorher);
    else await S.deleteGlobalValues('rebrickable_api_key');
  });
  const { fetchSetParts, httpsGetRobust, rebrickableRaw } =
    require('./helpers/sources').testServices().externalSources.quellen;
  const withKey = () => fetches.filter(a => Object.keys(a.kopf).some(k => k.toLowerCase() === 'authorization'));

  await t.test('next on api.upcitemdb.com is not followed', async () => {
    fetches.length = 0;
    responseFor = url =>
      url.includes('/lego/sets/')
        ? {
            status: 200,
            body: JSON.stringify({
              results: [{ part: { part_num: 'x' }, color: { id: 1 }, quantity: 1 }],
              next: 'https://api.upcitemdb.com/prod/x',
            }),
          }
        : { status: 200, body: '{}' };
    await fetchSetParts('10294-1');
    assert.ok(fetches.length >= 1, 'die Attrappe sah keinen Abruf — die Gegenprobe bewiese nichts');
    assert.deepEqual(
      fetches.filter(a => new URL(a.url).hostname !== 'rebrickable.com').map(a => a.url),
      [],
      'ein Abruf ging an einen anderen Host',
    );
  });

  await t.test('next on rebrickable.com is still followed', async () => {
    fetches.length = 0;
    responseFor = url =>
      url.includes('page=2')
        ? {
            status: 200,
            body: JSON.stringify({ results: [{ part: { part_num: 'b' }, color: { id: 1 }, quantity: 1 }], next: null }),
          }
        : {
            status: 200,
            body: JSON.stringify({
              results: [{ part: { part_num: 'a' }, color: { id: 1 }, quantity: 1 }],
              next: 'https://rebrickable.com/api/v3/lego/sets/10294-1/parts/?page=2',
            }),
          };
    const r = await fetchSetParts('10294-1');
    assert.equal(r.teile.length, 2, 'die zweite Seite fehlt');
  });

  await t.test('rebrickableRaw reaches no other host', async () => {
    fetches.length = 0;
    const r = await rebrickableRaw('https://lego.brickinstructions.com/x', 'geheim-123');
    assert.equal(r.status, 0);
    assert.equal(fetches.length, 0, 'der Abruf mit Schlüssel ging hinaus');
  });

  await t.test(
    'requests with a key only go to rebrickable.com; without a key the EAN search stays allowed',
    async () => {
      fetches.length = 0;
      responseFor = () => ({ status: 200, body: '{}' });
      await httpsGetRobust('https://api.upcitemdb.com/prod/trial/lookup?upc=1', {}, 3000);
      assert.equal(fetches.length, 1, 'die EAN-Suche ohne Schlüssel muss weiter gehen');
      fetches.length = 0;
      await httpsGetRobust('https://api.upcitemdb.com/prod/x', { Authorization: 'key geheim-123' }, 3000).catch(
        () => null,
      );
      assert.deepEqual(withKey(), [], 'ein Abruf mit Schlüssel ging an upcitemdb');
    },
  );
});
