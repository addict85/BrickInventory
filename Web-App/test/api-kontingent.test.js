/**
 * Anfragebudget je Konto unter /api/v1 (src/http/apiDrossel.ts).
 *
 * Gegenproben:
 *   A  KOSTEN.auftrag = 1                      → rot: „der Auftragstopf greift vor dem Budget“
 *   B  Abweisung erhöht den Zähler mit        → rot: „abgewiesene Anfragen zählen nicht mit“
 *   C  Schlüssel im Zähler ist die feste 0    → rot: „ein Konto verbraucht nicht das Budget des anderen“
 *   D  apiDrossel nicht in der Kette          → rot: „ohne Budget antwortet die Route 200“
 *
 * Ohne Datenbank: Der Zähler liegt im Prozess, die Route wird mit einer
 * Sitzung im Request nachgebildet.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();
const { pruefeBudget, drosselLeeren, einordnung, apiDrossel, BUDGET, AUFTRAG_BUDGET, FENSTER_MS, KOSTEN } =
  _req('src/http/apiDrossel.js');

test('ein Konto hat BUDGET Einheiten je Fenster', () => {
  drosselLeeren();
  const t0 = 1_000_000;
  let letzte;
  for (let i = 1; i <= BUDGET; i++) letzte = pruefeBudget(7, 'GET', '/sets', t0);
  assert.equal(letzte.erlaubt, true);
  const ab = pruefeBudget(7, 'GET', '/sets', t0);
  assert.equal(ab.erlaubt, false, 'die Anfrage über dem Budget muss abgewiesen werden');
  assert.equal(ab.restSek, FENSTER_MS / 1000, 'Retry-After nennt das Ende des Fensters');
});

test('ein Konto verbraucht nicht das Budget des anderen', () => {
  drosselLeeren();
  const t0 = 2_000_000;
  for (let i = 0; i < BUDGET; i++) pruefeBudget(11, 'GET', '/sets', t0);
  assert.equal(pruefeBudget(11, 'GET', '/sets', t0).erlaubt, false);
  assert.equal(pruefeBudget(12, 'GET', '/sets', t0).erlaubt, true);
});

test('nach dem Fenster beginnt das Budget neu', () => {
  drosselLeeren();
  const t0 = 3_000_000;
  for (let i = 0; i < BUDGET; i++) pruefeBudget(13, 'GET', '/sets', t0);
  const neu = pruefeBudget(13, 'GET', '/sets', t0 + FENSTER_MS);
  assert.equal(neu.erlaubt, true);
  assert.equal(neu.einheiten, 1);
  assert.equal(neu.restSek, FENSTER_MS / 1000);
});

test('abgewiesene Anfragen zählen nicht mit', () => {
  drosselLeeren();
  const t0 = 4_000_000;
  for (let i = 0; i < BUDGET; i++) pruefeBudget(14, 'GET', '/sets', t0);
  let ab;
  for (let i = 0; i < 20; i++) ab = pruefeBudget(14, 'GET', '/sets', t0 + 1000);
  assert.equal(ab.erlaubt, false);
  assert.equal(ab.einheiten, BUDGET, 'die Abweisung darf den Zähler nicht weiter hochziehen');
});

test('der Auftragstopf greift vor dem allgemeinen Budget', () => {
  drosselLeeren();
  const t0 = 5_000_000;
  for (let i = 0; i < AUFTRAG_BUDGET; i++)
    assert.equal(pruefeBudget(15, 'POST', '/sets/partslist-pdf', t0).erlaubt, true);
  const ab = pruefeBudget(15, 'POST', '/sets/partslist-pdf', t0);
  assert.equal(ab.erlaubt, false);
  assert.equal(ab.auftrag, true);
  assert.ok(ab.einheiten < BUDGET, 'sonst hätte das allgemeine Budget zugemacht, nicht der Topf');
  // Lesen und Schreiben ohne Auftrag gehen weiter.
  assert.equal(pruefeBudget(15, 'GET', '/sets', t0).erlaubt, true);
});

test('Katalogabrufe kosten mehr als Lesen', () => {
  assert.equal(einordnung('GET', '/catalog/sets').kosten, KOSTEN.abruf);
  assert.equal(einordnung('GET', '/sets').kosten, KOSTEN.normal);
  assert.equal(einordnung('POST', '/minifigs/import/csv').auftrag, true);
  assert.equal(einordnung('GET', '/settings/export/data').auftrag, true);
});

test('die Route antwortet 429 mit Retry-After und Fehlercode', async t => {
  drosselLeeren();
  const app = express();
  app.use((req, _res, next) => {
    // Object.assign statt Zuweisung: `session` steht nicht im Typ von express.Request.
    Object.assign(req, { session: { userId: 42 } });
    next();
  });
  app.use('/api/v1', apiDrossel);
  app.use('/api/v1', (req, res) => res.json({ success: true, pfad: req.path }));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const adresse = srv.address();
  const base = `http://localhost:${typeof adresse === 'object' && adresse ? adresse.port : 0}/api/v1`;

  let letzte;
  for (let i = 0; i <= BUDGET; i++) letzte = await fetch(base + '/sets');
  assert.equal(letzte.status, 429, 'ohne Budget antwortet die Route 200');
  const rumpf = await letzte.json();
  assert.equal(rumpf.code, 'zu_viele_anfragen');
  assert.ok(Number(letzte.headers.get('retry-after')) >= 1);
  assert.equal(letzte.headers.get('ratelimit-remaining'), '0');

  // Ohne Anmeldung begrenzt nichts — die Anmeldung hat eigene Bremsen.
  const ohne = express();
  ohne.use('/api/v1', apiDrossel);
  ohne.use('/api/v1', (_req, res) => res.json({ success: true }));
  const srv2 = ohne.listen(0);
  t.after(() => new Promise(r => srv2.close(r)));
  const adresse2 = srv2.address();
  const basis2 = `http://localhost:${typeof adresse2 === 'object' && adresse2 ? adresse2.port : 0}/api/v1`;
  for (let i = 0; i <= BUDGET; i++) assert.equal((await fetch(basis2 + '/sets')).status, 200);
});
