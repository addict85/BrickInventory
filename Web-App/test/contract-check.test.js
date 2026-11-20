/**
 * Die Prüfung der Antworten gegen den Vertrag (src/http/contractRouter.ts):
 * In Tests wird eine abweichende 2xx-Antwort zur 500 mit den Abweichungen;
 * eine vertragswidrige Eingabe ist schon vor der Route 400 (checkInput,
 * auch im Betrieb, siehe test/input-contract-db.test.js); im Betrieb
 * (VERTRAG_PRUEFEN nicht 1) geht die Antwort ungeprüft hinaus.
 *
 * Gegenproben (31.10.2026 gemessen):
 *   A  in checkContract() `pruefe('Antwort', …)` auskommentiert → rot: „eine
 *      abweichende Antwort wird zur 500“ (200 statt 500)
 *   B  die Abfrage von konfig().checkContract entfernt → rot: „im Betrieb
 *      geht die Antwort ungeprüft hinaus“ (500 statt 200; nach dem Umzug in
 *      checkContract() beim Bau des Routers erneut gemessen 10.11.2026)
 *   C  in checkContract() `res.statusCode < 300` weggelassen → rot: „eine
 *      Fehlerantwort wird nicht gegen das Erfolgsschema geprüft“
 *   E  in responseAgainstContract() wieder `|| !konfig().checkContract` je Anfrage →
 *      rot: „die Prüfung entscheidet sich beim Bau des Routers“ (200 statt 500)
 *   D  die Zeile `pruefe('Fehlerantwort', …)` gestrichen → rot: „eine
 *      Fehlerantwort ohne Code wird zur 500“ (404 statt 500; gemessen 05.11.2026)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();
const { portOf } = require('./helpers/server');
const { vertragsRouter } = _req('src/http/contractRouter.js');
const { setKonfig } = _req('src/infra/config.js');

/** Ein Router mit echten Schlüsseln des Vertrags, der antwortet, was der Test will. */
function server(t, antworten) {
  const router = vertragsRouter('/api/v1/auth');
  router.endpunkt('GET /api/v1/auth/registration-status', (_req, res) =>
    res.status(antworten.status ?? 200).json(antworten.rumpf),
  );
  router.endpunkt('PUT /api/v1/auth/users/:id/admin', (_req, res) => res.json({ success: true }));
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
  setKonfig({ checkContract: false });
  t.after(() => setKonfig(null));
  const basis = server(t, { rumpf: { enabled: 'ja' } });
  const r = await fetch(`${basis}/registration-status`);
  assert.deepEqual([r.status, await r.json()], [200, { enabled: 'ja' }]);
});

test('the check is decided when the router is built', async t => {
  const basis = server(t, { rumpf: { enabled: 'ja' } });
  setKonfig({ checkContract: false });
  t.after(() => setKonfig(null));
  assert.equal((await fetch(`${basis}/registration-status`)).status, 500);
});
