/**
 * The contract router registers a route via its contract key: method and path
 * come from it, the route's return value goes into the envelope `{ success: true, … }`, and
 * a router under a foreign prefix does not answer under a path outside the contract.
 *
 * Counter-checks (14.11.2026):
 *   A  in endpunkt() `res.json({ success: true, ...r })` replaced by `res.json(r)` → red:
 *      “the envelope sets success”.
 *   B  the check of req.baseUrl against the prefix deleted → red: “a foreign prefix is 500”.
 *   C  in endpunkt() the lookup in the contract (`routeZu`) skipped → red: “a key outside …”.
 *   D  (15.11.2026) in endpunkt() the check of res.locals.schritt deleted → red:
 *      “a route with a step marker …” (200 instead of 403 for `keiner` and `zweiter_faktor`).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();
const { vertragsRouter } = _req('src/http/contractRouter.js');

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
  const r = vertragsRouter('/api/v1/auth');
  r.endpunkt('GET /api/v1/auth/users', () => ({ users: [] }));
  const basis = server(t, '/api/v1/auth', r);
  const a = await fetch(`${basis}/api/v1/auth/users`);
  assert.deepEqual([a.status, await a.json()], [200, { success: true, users: [] }]);
});

test('a foreign prefix is a 500, no response under a wrong path', async t => {
  const r = vertragsRouter('/api/v1/auth');
  r.endpunkt('GET /api/v1/auth/registration-status', () => ({ enabled: true }));
  const basis = server(t, '/api/v1', r);
  const a = await fetch(`${basis}/api/v1/registration-status`);
  assert.equal(a.status, 500);
  assert.match((await a.json()).error, /eingehängt/);
});

test('a key outside the contract or the prefix throws at build time', () => {
  assert.throws(() => vertragsRouter('/api/v1').endpunkt('GET /api/v1/gibt-es-nicht', () => ({})), /nicht im Vertrag/);
  assert.throws(() => vertragsRouter('/api/v1/auth').endpunkt('GET /api/v1/sets', () => ({})), /nicht im Vertrag/);
});

test('a route with a step brand only answers if the entrance checked exactly its step', async t => {
  const r = vertragsRouter('/api/v1');
  r.endpunkt('POST /api/v1/vouchers/:id/klartext', () => ({ id: 1, number: '1', pin: null }));
  const app = express();
  app.use(express.json());
  // Like stepChutzAtInbox: it records which step it assigned to the request.
  app.use((req, res, next) => {
    const s = req.get('x-schritt');
    if (s !== undefined) res.locals.schritt = s === 'keiner' ? null : s;
    next();
  });
  app.use('/api/v1', r);
  const srv = app.listen(0);
  t.after(() => new Promise(x => srv.close(x)));
  const basis = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
  const ruf = async schritt =>
    (
      await fetch(`${basis}/api/v1/vouchers/1/klartext`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(schritt ? { 'x-schritt': schritt } : {}) },
        body: JSON.stringify({ password: 'x', code: '' }),
      })
    ).status;
  // Without the entrance (routerServer in older tests) the router does not check.
  assert.deepEqual(
    [await ruf('keiner'), await ruf('zweiter_faktor'), await ruf('gutschein'), await ruf(undefined)],
    [403, 403, 200, 200],
  );
});
