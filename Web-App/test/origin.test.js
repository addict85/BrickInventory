/**
 * Writing requests of a foreign site are rejected (CSRF), everything
 * else goes through. That server.ts mounts the guard is checked by
 * signale-zwei-worker-db on the real server.
 *
 * Counter-checks (measured on 27.10.):
 *   A  only 'cross-site' rejected instead of everything except same-origin/none → red:
 *      “a neighboring subdomain”
 *   B  the cookie condition on the bearer exception removed → red: “a
 *      bearer header next to the session cookie switches nothing off”
 * Counter-checks (measured on 30.10.):
 *   C  Origin/Referer not checked (branch removed) → red: “an old
 *      browser without Sec-Fetch-Site, from a foreign site”
 *   D  always let through without a header → red: “a cookie session without any
 *      origin information”
 *   E  host comparison replaced by `startsWith` → red: “a host that only
 *      starts like the own one”
 * Counter-check (measured on 01.11.2026):
 *   F  carriesSessionCookie() again only recognizes `connect.sid` → red: “a
 *      cookie session without any origin information”, “a bearer header …”
 * Counter-check (measured on 15.11.2026):
 *   G  in onlyOwnHost() again `if (!adresse) return next()` → red: “without
 *      APP_BASE_URL the host filter accepts no name” (200 instead of 421)
 */
const test = require('node:test');
const { environment } = require('./helpers/sources');
const assert = require('node:assert/strict');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { onlyOwnOrigin, onlyOwnHost } = _req('src/http/origin.js');
const http = require('node:http');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

test('origin of writing requests', async t => {
  const app = express();
  app.use(onlyOwnOrigin);
  app.all('/x', (_req, res) => res.json({ ok: true }));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const callFn = async (method, head = {}) =>
    (await fetch(`http://127.0.0.1:${srv.address().port}/x`, { method, headers: head })).status;

  await t.test('a foreign website', async () => {
    assert.equal(await callFn('POST', { 'sec-fetch-site': 'cross-site' }), 403);
    assert.equal(await callFn('DELETE', { 'sec-fetch-site': 'cross-site' }), 403);
  });
  await t.test('a neighboring subdomain', async () => {
    assert.equal(await callFn('PUT', { 'sec-fetch-site': 'same-site' }), 403);
  });
  await t.test('the own site', async () => {
    assert.equal(await callFn('POST', { 'sec-fetch-site': 'same-origin' }), 200);
    assert.equal(await callFn('POST', { 'sec-fetch-site': 'none' }), 200, 'entered by the user themselves');
  });
  await t.test('without header and without session: app, scripts', async () => {
    assert.equal(await callFn('POST'), 200);
    assert.equal(await callFn('POST', { authorization: 'Bearer abc' }), 200);
  });
  const own = () => `http://127.0.0.1:${srv.address().port}`;
  const SESSION = { cookie: '__Host-bim.sid=s%3Aabc' };
  await t.test('a cookie session without any origin information', async () => {
    assert.equal(await callFn('POST', SESSION), 403);
    assert.equal(await callFn('DELETE', SESSION), 403);
    assert.equal(await callFn('GET', SESSION), 200, 'reading stays allowed');
  });
  await t.test('an old browser without Sec-Fetch-Site, from a foreign site', async () => {
    assert.equal(await callFn('POST', { ...SESSION, origin: 'https://boese.example' }), 403);
    assert.equal(await callFn('POST', { ...SESSION, origin: 'null' }), 403, 'Origin „null" (sandbox, file)');
    assert.equal(await callFn('POST', { ...SESSION, referer: 'https://boese.example/seite' }), 403);
    assert.equal(await callFn('POST', { origin: 'https://boese.example' }), 403, 'also without a session (login CSRF)');
  });
  await t.test('a host that only starts like the own one', async () => {
    environment({ APP_BASE_URL: 'https://lego.example.org' });
    try {
      assert.equal(await callFn('POST', { ...SESSION, origin: 'https://lego.example.org.boese.example' }), 403);
      assert.equal(await callFn('POST', { ...SESSION, referer: 'https://lego.example.org.boese.example/' }), 403);
    } finally {
      environment({ APP_BASE_URL: undefined });
    }
  });
  await t.test('an old browser from the own site', async () => {
    assert.equal(await callFn('POST', { ...SESSION, origin: own() }), 200);
    assert.equal(await callFn('POST', { ...SESSION, referer: `${own()}/#/sets` }), 200);
    environment({ APP_BASE_URL: 'https://lego.example.org' });
    try {
      assert.equal(await callFn('POST', { ...SESSION, origin: 'https://lego.example.org' }), 200, 'APP_BASE_URL');
    } finally {
      environment({ APP_BASE_URL: undefined });
    }
  });
  await t.test('reading and with token', async () => {
    assert.equal(await callFn('GET', { 'sec-fetch-site': 'cross-site' }), 200);
    assert.equal(await callFn('POST', { 'sec-fetch-site': 'cross-site', authorization: 'Bearer abc' }), 200);
  });
  await t.test('a bearer header next to the session cookie switches nothing off', async () => {
    // With a cookie the session applies, not the token — so the origin counts.
    assert.equal(
      await callFn('POST', {
        'sec-fetch-site': 'same-site',
        authorization: 'Bearer x',
        cookie: 'theme=dunkel; bim.sid=s%3Aabc',
      }),
      403,
    );
    assert.equal(
      await callFn('POST', { 'sec-fetch-site': 'same-origin', authorization: 'Bearer x', cookie: 'bim.sid=s%3Aabc' }),
      200,
    );
  });
});

test('without APP_BASE_URL the host filter accepts no name, only loopback and IP addresses', async t => {
  environment({ APP_BASE_URL: undefined });
  const app = express();
  app.use(onlyOwnHost);
  app.all('/{*pfad}', (_req, res) => res.json({ ok: true }));
  const srv = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(r => srv.close(r)));
  await new Promise(r => srv.once('listening', r));
  const withHost = (host, path = '/api/v2/auth/me') =>
    new Promise((done, error) => {
      const r = http.request(
        { host: '127.0.0.1', port: srv.address().port, path: path, setHost: false, headers: { host } },
        res => {
          let text = '';
          res.on('data', d => {
            text += d;
          });
          res.on('end', () => done({ status: res.statusCode, text }));
        },
      );
      r.on('error', error);
      r.end();
    });
  // A bent name (DNS rebinding) points to the same address but carries its name.
  const fremd = await withHost('boese.example');
  assert.equal(fremd.status, 421);
  assert.equal(JSON.parse(fremd.text).code, 'foreign_host');
  assert.match(JSON.parse(fremd.text).error, /127\.0\.0\.1/, 'the rejection names the own address');
  assert.equal((await withHost('nas.local:3000')).status, 421);
  for (const h of ['localhost:3000', '127.0.0.1', '192.168.1.20:3000', '[fe80::1]:8080'])
    assert.equal((await withHost(h)).status, 200, h);
  assert.equal((await withHost('boese.example', '/api/v2/health')).status, 200, 'health stays free');
});
