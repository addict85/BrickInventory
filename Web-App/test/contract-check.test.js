/**
 * Checking the responses against the contract (src/http/contractRouter.ts):
 * in tests a deviating 2xx response becomes a 500 with the deviations;
 * an input violating the contract is already 400 before the route (checkInput,
 * also in production, see test/input-contract-db.test.js); in production
 * (VERTRAG_PRUEFEN not 1) the response goes out unchecked.
 *
 * Counter-checks (measured 31.10.2026):
 *   A  in checkContract() `pruefe('Antwort', …)` commented out → red: “a
 *      deviating response becomes 500” (200 instead of 500)
 *   B  the query of konfig().checkContract removed → red: “in production
 *      the response goes out unchecked” (500 instead of 200; measured again after the move into
 *      checkContract() when building the router 10.11.2026)
 *   C  in checkContract() `res.statusCode < 300` omitted → red: “an
 *      error response is not checked against the success schema”
 *   E  in responseAgainstContract() again `|| !konfig().checkContract` per request →
 *      red: “the check is decided when the router is built” (200 instead of 500)
 *   D  the line `pruefe('Fehlerantwort', …)` deleted → red: “an
 *      error response without code becomes 500” (404 instead of 500; measured 05.11.2026)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();
const { portOf } = require('./helpers/server');
const { contractRouter: vertragsRouter } = _req('src/http/contractRouter.js');
const { setConfig } = _req('src/infra/config.js');

/** A router with real contract keys that answers whatever the test wants. */
function server(t, antworten) {
  const router = vertragsRouter('/api/v1/auth');
  router.endpoint('GET /api/v1/auth/registration-status', (_req, res) =>
    res.status(antworten.status ?? 200).json(antworten.rumpf),
  );
  router.endpoint('PUT /api/v1/auth/users/:id/admin', (_req, res) => res.json({ success: true }));
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', router);
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  return `http://127.0.0.1:${portOf(srv)}/api/v1/auth`;
}

test('a deviating response becomes a 500', async t => {
  const basis = server(t, { rumpf: { enabled: 'ja' } });
  const r = await fetch(`${basis}/registration-status`);
  assert.equal(r.status, 500);
  const j = await r.json();
  assert.equal(j.code, 'vertrag_verletzt');
  assert.match(j.deviations.join(), /Antwort enabled/);
});

test('a response matching the contract goes out unchanged', async t => {
  const basis = server(t, { rumpf: { enabled: true } });
  const r = await fetch(`${basis}/registration-status`);
  assert.deepEqual([r.status, await r.json()], [200, { enabled: true }]);
});

test('an input violating the contract does not reach the route', async t => {
  const basis = server(t, {});
  const senden = rumpf =>
    fetch(`${basis}/users/7/admin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rumpf),
    });
  assert.equal((await senden({ is_admin: true })).status, 200);
  const r = await senden({ is_admin: 'vielleicht' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /is_admin/);
});

test('an error response is not checked against the success schema', async t => {
  const basis = server(t, { status: 404, rumpf: { success: false, error: 'weg', code: 'x' } });
  assert.equal((await fetch(`${basis}/registration-status`)).status, 404);
});

test('an error response without a code becomes a 500', async t => {
  const basis = server(t, { status: 404, rumpf: { success: false, error: 'Endpoint nicht gefunden' } });
  const r = await fetch(`${basis}/registration-status`);
  assert.equal(r.status, 500);
  assert.match((await r.json()).deviations.join(), /Fehlerantwort code/);
});

test('in production the response goes out unchecked', async t => {
  setConfig({ checkContract: false });
  t.after(() => setConfig(null));
  const basis = server(t, { rumpf: { enabled: 'ja' } });
  const r = await fetch(`${basis}/registration-status`);
  assert.deepEqual([r.status, await r.json()], [200, { enabled: 'ja' }]);
});

test('the check is decided when the router is built', async t => {
  const basis = server(t, { rumpf: { enabled: 'ja' } });
  setConfig({ checkContract: false });
  t.after(() => setConfig(null));
  assert.equal((await fetch(`${basis}/registration-status`)).status, 500);
});
