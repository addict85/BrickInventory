/**
 * Die Prüfung der Antworten gegen den Vertrag (src/infra/vertrag/pruefen.ts):
 * In Tests wird eine abweichende 2xx-Antwort zur 500 mit den Abweichungen;
 * eine vertragswidrige Eingabe ist schon vor der Route 400 (eingabePruefen,
 * auch im Betrieb, siehe test/eingabe-vertrag-db.test.js); im Betrieb
 * (VERTRAG_PRUEFEN nicht 1) geht die Antwort ungeprüft hinaus.
 *
 * Gegenproben (31.10.2026 gemessen):
 *   A  in vertragPruefen() `pruefe('Antwort', …)` auskommentiert → rot: „eine
 *      abweichende Antwort wird zur 500“ (200 statt 500)
 *   B  die Abfrage von konfig().vertragPruefen entfernt → rot: „im Betrieb
 *      geht die Antwort ungeprüft hinaus“ (500 statt 200)
 *   C  in vertragPruefen() `res.statusCode < 300` weggelassen → rot: „eine
 *      Fehlerantwort wird nicht geprüft“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();
const { vertragsRouter } = _req('src/infra/vertrag/pruefen.js');

/** Ein Router mit echten Schlüsseln des Vertrags, der antwortet, was der Test will. */
function server(t, antworten) {
  const router = vertragsRouter();
  router.get('/registration-status', (_req, res) => res.status(antworten.status ?? 200).json(antworten.rumpf));
  router.put('/users/:id/admin', (_req, res) => res.json({ success: true }));
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', router);
  const srv = app.listen(0);
  t.after(() => new Promise((r) => srv.close(r)));
  return `http://127.0.0.1:${srv.address().port}/api/v1/auth`;
}

test('eine abweichende Antwort wird zur 500', async (t) => {
  const basis = server(t, { rumpf: { enabled: 'ja' } });
  const r = await fetch(`${basis}/registration-status`);
  assert.equal(r.status, 500);
  const j = await r.json();
  assert.equal(j.code, 'vertrag_verletzt');
  assert.match(j.abweichungen.join(), /Antwort enabled/);
});

test('eine vertragsgemässe Antwort geht unverändert hinaus', async (t) => {
  const basis = server(t, { rumpf: { enabled: true } });
  const r = await fetch(`${basis}/registration-status`);
  assert.deepEqual([r.status, await r.json()], [200, { enabled: true }]);
});

test('eine vertragswidrige Eingabe erreicht die Route nicht', async (t) => {
  const basis = server(t, {});
  const senden = (rumpf) => fetch(`${basis}/users/7/admin`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rumpf) });
  assert.equal((await senden({ is_admin: true })).status, 200);
  const r = await senden({ is_admin: 'vielleicht' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /is_admin/);
});

test('eine Fehlerantwort wird nicht geprüft', async (t) => {
  const basis = server(t, { status: 404, rumpf: { success: false, error: 'weg', code: 'x' } });
  assert.equal((await fetch(`${basis}/registration-status`)).status, 404);
});

test('im Betrieb geht die Antwort ungeprüft hinaus', async (t) => {
  const vorher = process.env.VERTRAG_PRUEFEN;
  process.env.VERTRAG_PRUEFEN = '0';
  t.after(() => { process.env.VERTRAG_PRUEFEN = vorher; });
  const basis = server(t, { rumpf: { enabled: 'ja' } });
  const r = await fetch(`${basis}/registration-status`);
  assert.deepEqual([r.status, await r.json()], [200, { enabled: 'ja' }]);
});
