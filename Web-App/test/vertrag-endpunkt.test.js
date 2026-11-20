/**
 * Der Vertragsrouter registriert eine Route über ihren Vertragsschlüssel: Methode und Pfad
 * kommen aus ihm, der Rückgabewert der Route geht in die Hülle `{ success: true, … }`, und
 * ein Router unter einem fremden Präfix antwortet nicht unter einem Pfad ausserhalb des Vertrags.
 *
 * Gegenproben (14.11.2026):
 *   A  in endpunkt() `res.json({ success: true, ...r })` durch `res.json(r)` ersetzt → rot:
 *      „die Hülle setzt success“.
 *   B  die Prüfung von req.baseUrl gegen das Präfix gestrichen → rot: „ein fremdes Präfix ist 500“.
 *   C  in endpunkt() die Suche im Vertrag (`routeZu`) übergangen → rot: „ein Schlüssel ausserhalb …“.
 *   D  (15.11.2026) in endpunkt() die Prüfung von res.locals.schritt gestrichen → rot:
 *      „eine Route mit Schrittmarke …“ (200 statt 403 für `keiner` und `zweiter_faktor`).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();
const { vertragsRouter } = _req('src/http/vertragsRouter.js');

function server(t, mount, router) {
  const app = express();
  app.use(express.json());
  app.use(mount, router);
  app.use((e, _req, res, _next) => res.status(500).json({ success: false, error: String(e.message), code: 'x' }));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  return `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
}

test('die Hülle setzt success, die Route gibt nur ihr Ergebnis', async t => {
  const r = vertragsRouter('/api/v1/auth');
  r.endpunkt('GET /api/v1/auth/users', () => ({ users: [] }));
  const basis = server(t, '/api/v1/auth', r);
  const a = await fetch(`${basis}/api/v1/auth/users`);
  assert.deepEqual([a.status, await a.json()], [200, { success: true, users: [] }]);
});

test('ein fremdes Präfix ist 500, keine Antwort unter falschem Pfad', async t => {
  const r = vertragsRouter('/api/v1/auth');
  r.endpunkt('GET /api/v1/auth/registration-status', () => ({ enabled: true }));
  const basis = server(t, '/api/v1', r);
  const a = await fetch(`${basis}/api/v1/registration-status`);
  assert.equal(a.status, 500);
  assert.match((await a.json()).error, /eingehängt/);
});

test('ein Schlüssel ausserhalb des Vertrags oder des Präfixes wirft beim Bau', () => {
  assert.throws(() => vertragsRouter('/api/v1').endpunkt('GET /api/v1/gibt-es-nicht', () => ({})), /nicht im Vertrag/);
  assert.throws(() => vertragsRouter('/api/v1/auth').endpunkt('GET /api/v1/sets', () => ({})), /nicht im Vertrag/);
});

test('eine Route mit Schrittmarke antwortet nur, wenn der Eingang genau ihren Schritt geprüft hat', async t => {
  const r = vertragsRouter('/api/v1');
  r.endpunkt('POST /api/v1/vouchers/:id/klartext', () => ({ id: 1, number: '1', pin: null }));
  const app = express();
  app.use(express.json());
  // Wie stepChutzAtInbox: Es hält fest, welchen Schritt es der Anfrage zugeordnet hat.
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
  // Ohne Eingang (routerServer in älteren Tests) prüft der Router nicht nach.
  assert.deepEqual(
    [await ruf('keiner'), await ruf('zweiter_faktor'), await ruf('gutschein'), await ruf(undefined)],
    [403, 403, 200, 200],
  );
});
