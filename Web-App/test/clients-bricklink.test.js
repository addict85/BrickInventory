/**
 * The BrickLink client (clients/bricklink.ts) against a local HTTPS stub with fixtures:
 * OAuth 1.0 signature, quota, maintenance redirect and the error paths — API error in `meta`,
 * 429, 5xx, HTML instead of JSON, timeout.
 *
 * Counter-checks (measured 22.11.2026, each alone):
 *   A  in buildAuthHeader() the query parameters left out of the signature base → red:
 *      “a signed GET … the signature checks out”
 *   B  the quota check removed → red: “an exhausted daily quota asks nothing”
 *   C  the 3xx branch removed → red: “a redirect means maintenance” (non-JSON instead)
 *   D  in readJson() excerpt(body) replaced by the raw body → red: “HTML instead of JSON …”
 *      (the line break of the page lands in the message)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mock } = require('node:test');

const _req = require('./helpers/sources').buildAndRequire();
const { httpsStub, reply, fixture, clientsAccess } = require('./helpers/https-stub');
const { createBricklink, BricklinkNotReachable } = _req('clients/bricklink.js');

const PRICE = '/items/SET/10294-1/price';
const pct = s =>
  encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

test('a signed GET returns `data`; the signature checks out', async t => {
  const stub = await httpsStub(t, (_c, res) => reply(res, 200, fixture('bricklink-price.json')));
  const z = clientsAccess();
  const data = await createBricklink(z).bricklinkRequest('GET', PRICE, { new_or_used: 'N', currency_code: 'CHF' });
  assert.equal(data.avg_price, '612.5000');
  assert.deepEqual(z.seen.counted, ['bricklink']);
  const [c] = stub.calls;
  assert.equal(c.host, 'api.bricklink.com');
  assert.equal(c.path, `/api/store/v1${PRICE}?currency_code=CHF&new_or_used=N`);
  // Recomputed from the header and the known secrets, as BrickLink does it.
  const felder = Object.fromEntries(
    [...String(c.headers.authorization).matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], decodeURIComponent(m[2])]),
  );
  const { oauth_signature: sig, realm: _realm, ...ohne } = felder;
  const alle = { ...ohne, currency_code: 'CHF', new_or_used: 'N' };
  const params = Object.keys(alle)
    .sort()
    .map(k => `${pct(k)}=${pct(alle[k])}`)
    .join('&');
  const basis = `GET&${pct(`https://api.bricklink.com/api/store/v1${PRICE}`)}&${pct(params)}`;
  assert.equal(sig, crypto.createHmac('sha1', 'cs&ts').update(basis).digest('base64'));
  assert.equal(felder.oauth_consumer_key, 'ck');
  assert.equal(felder.oauth_token, 'tk');
});

test('without all four credentials nothing is asked', async t => {
  const stub = await httpsStub(t, (_c, res) => reply(res, 200, '{}'));
  const z = clientsAccess({ keys: { bricklink_token_secret: '' } });
  await assert.rejects(createBricklink(z).bricklinkRequest('GET', PRICE), { code: 'bricklink_credentials_missing' });
  assert.deepEqual([stub.calls.length, z.seen.counted], [0, []]);
});

test('an exhausted daily quota asks nothing', async t => {
  const stub = await httpsStub(t, (_c, res) => reply(res, 200, fixture('bricklink-price.json')));
  await assert.rejects(
    createBricklink(clientsAccess({ allowed: false })).bricklinkRequest('GET', PRICE),
    /Tageslimit erreicht \(100 Aufrufe\/Tag\)/,
  );
  assert.equal(stub.calls.length, 0);
});

test('a redirect means maintenance and is not followed', async t => {
  const stub = await httpsStub(t, (_c, res) => reply(res, 302, '', { location: 'https://www.bricklink.com/maint' }));
  const e = await createBricklink(clientsAccess())
    .bricklinkRequest('GET', PRICE)
    .catch(x => x);
  assert.ok(e instanceof BricklinkNotReachable, String(e));
  assert.match(e.message, /Umleitung 302 nach www\.bricklink\.com/);
  assert.equal(e.code, 'bricklink_nicht_erreichbar');
  assert.equal(stub.calls.length, 1);
});

test('an API error in `meta` is an error with the response attached', async t => {
  await httpsStub(t, (_c, res) => reply(res, 200, fixture('bricklink-error.json')));
  const e = await createBricklink(clientsAccess())
    .bricklinkRequest('GET', PRICE)
    .catch(x => x);
  assert.match(e.message, /BrickLink API Error 400: PARAMETER_MISSING_OR_INVALID/);
  assert.equal(e.detail.meta.code, 400);
});

test('429 and 5xx with a JSON body are errors too', async t => {
  const antworten = [
    [429, { meta: { code: 429, message: 'TOO_MANY_REQUESTS' } }],
    [503, { meta: { code: 503, message: 'SERVICE_UNAVAILABLE' } }],
  ];
  await httpsStub(t, (_c, res) =>
    reply(res, .../** @type {[number, any, Record<string, string>?]} */ (antworten.shift())),
  );
  const bl = createBricklink(clientsAccess());
  await assert.rejects(bl.bricklinkRequest('GET', PRICE), /API Error 429: TOO_MANY_REQUESTS/);
  await assert.rejects(bl.bricklinkRequest('GET', PRICE), /API Error 503: SERVICE_UNAVAILABLE/);
});

test('HTML instead of JSON: one line with the start of the body', async t => {
  await httpsStub(t, (_c, res) => reply(res, 500, fixture('bricklink-maintenance.html')));
  const e = await createBricklink(clientsAccess())
    .bricklinkRequest('GET', PRICE)
    .catch(x => x);
  assert.match(e.message, /^BrickLink non-JSON \(HTTP 500\): <!DOCTYPE html>/);
  assert.doesNotMatch(e.message, /[\r\n]/, 'a line break in the text forged a log line');
});

test('a hanging BrickLink ends at the deadline', async t => {
  const stub = await httpsStub(t, () => {});
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const lauf = createBricklink(clientsAccess()).checkBricklinkAccess();
  const call = await stub.nextCall();
  assert.equal(call.path, '/api/store/v1/colors/1');
  mock.timers.tick(20_000);
  await assert.rejects(lauf, /Zeitlimit 20000 ms/);
});
