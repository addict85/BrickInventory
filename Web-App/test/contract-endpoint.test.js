/**
 * The contract router registers a route via its contract key: method and path
 * come from it, the route's return value goes into the envelope `{ success: true, … }`, and
 * a router under a foreign prefix does not answer under a path outside the contract.
 *
 * Counter-checks (14.11.2026):
 *   A  in endpunkt() `res.json({ success: true, ...r })` replaced by `res.json(r)` → red:
 *      “the envelope sets success”.
 *   B  the check of req.baseUrl against the prefix deleted → red: “a foreign prefix is 500”.
 *   C  in endpunkt() the lookup in the contract (`routeFor`) skipped → red: “a key outside …”.
 *   D  (15.11.2026) in endpunkt() the check of res.locals.schritt deleted → red:
 *      “a route with a step marker …” (200 instead of 403 for `keiner` and `zweiter_faktor`).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();
const { contractRouter: contractRouterFn } = _req('src/http/contractRouter.js');

function server(t, mount, router) {
  const app = express();
  app.use(express.json());
  app.use(mount, router);
  app.use((e, _req, res, _next) => res.status(500).json({ success: false, error: String(e.message), code: 'x' }));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  return `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
}

test('the envelope sets success, the route only returns its result', async t => {
  const r = contractRouterFn('/api/v2/auth');
  r.endpoint('GET /api/v2/auth/users', () => ({ users: [] }));
  const basis = server(t, '/api/v2/auth', r);
  const a = await fetch(`${basis}/api/v2/auth/users`);
  assert.deepEqual([a.status, await a.json()], [200, { success: true, users: [] }]);
});

test('a foreign prefix is a 500, no response under a wrong path', async t => {
  const r = contractRouterFn('/api/v2/auth');
  r.endpoint('GET /api/v2/auth/registration-status', () => ({ enabled: true }));
  const basis = server(t, '/api/v2', r);
  const a = await fetch(`${basis}/api/v2/registration-status`);
  assert.equal(a.status, 500);
  assert.match((await a.json()).error, /eingehängt/);
});

test('a key outside the contract or the prefix throws at build time', () => {
  assert.throws(
    () => contractRouterFn('/api/v2').endpoint('GET /api/v2/gibt-es-nicht', () => ({})),
    /nicht im Vertrag/,
  );
  assert.throws(() => contractRouterFn('/api/v2/auth').endpoint('GET /api/v2/sets', () => ({})), /nicht im Vertrag/);
});

test('a route with a step brand only answers if the entrance checked exactly its step', async t => {
  const r = contractRouterFn('/api/v2');
  r.endpoint('POST /api/v2/vouchers/:id/plaintext', () => ({ id: 1, number: '1', pin: null }));
  const app = express();
  app.use(express.json());
  // Like stepProtectionAtInbox: it records which step it assigned to the request.
  app.use((req, res, next) => {
    const s = req.get('x-schritt');
    if (s !== undefined) res.locals.step = s === 'keiner' ? null : s;
    next();
  });
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', r);
  const srv = app.listen(0);
  t.after(() => new Promise(x => srv.close(x)));
  const basis = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
  const callFn = async schritt =>
    (
      await fetch(`${basis}/api/v2/vouchers/1/plaintext`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(schritt ? { 'x-schritt': schritt } : {}) },
        body: JSON.stringify({ password: 'x', code: '' }),
      })
    ).status;
  // Without the entrance (routerServer in older tests) the router does not check.
  assert.deepEqual(
    [await callFn('keiner'), await callFn('second_factor'), await callFn('voucher'), await callFn(undefined)],
    [403, 403, 200, 200],
  );
});
