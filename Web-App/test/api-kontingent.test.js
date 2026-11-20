/**
 * Anfragebudget je Konto unter /api/v1 (src/http/apiDrossel.ts).
 *
 * Gegenproben:
 *   A  COST.auftrag = 1                      → rot: „der Auftragstopf greift vor dem Budget“
 *   B  Abweisung erhöht den Zähler mit        → rot: „abgewiesene Anfragen zählen nicht mit“
 *   C  Schlüssel im Zähler ist die feste 0    → rot: „ein Konto verbraucht nicht das Budget des anderen“
 *   D  apiDrossel nicht in der Kette          → rot: „ohne Budget antwortet die Route 200“
 *   E  COST.preis = 1                       → rot: „Routen mit BrickLink- oder Fremdabruf …“
 *   F  (15.11.2026) einordnung() wieder über Regexe `^…$` auf den Pfad → rot:
 *      „ein Schrägstrich am Ende kostet …“ (partslist-pdf/ kostet 1 statt 25)
 *
 * Ohne Datenbank: Der Zähler liegt im Prozess, die Route wird mit einer
 * Sitzung im Request nachgebildet.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();
const { checkBudget, clearThrottle, classification, apiDrossel, BUDGET, JOB_BUDGET, WINDOW_MS, COST } =
  _req('src/http/apiDrossel.js');

test('ein Konto hat BUDGET Einheiten je Fenster', () => {
  clearThrottle();
  const t0 = 1_000_000;
  let letzte;
  for (let i = 1; i <= BUDGET; i++) letzte = checkBudget(7, 'GET', '/sets', t0);
  assert.equal(letzte.erlaubt, true);
  const ab = checkBudget(7, 'GET', '/sets', t0);
  assert.equal(ab.erlaubt, false, 'die Anfrage über dem Budget muss abgewiesen werden');
  assert.equal(ab.restSec, WINDOW_MS / 1000, 'Retry-After nennt das Ende des Fensters');
});

test('ein Konto verbraucht nicht das Budget des anderen', () => {
  clearThrottle();
  const t0 = 2_000_000;
  for (let i = 0; i < BUDGET; i++) checkBudget(11, 'GET', '/sets', t0);
  assert.equal(checkBudget(11, 'GET', '/sets', t0).erlaubt, false);
  assert.equal(checkBudget(12, 'GET', '/sets', t0).erlaubt, true);
});

test('nach dem Fenster beginnt das Budget neu', () => {
  clearThrottle();
  const t0 = 3_000_000;
  for (let i = 0; i < BUDGET; i++) checkBudget(13, 'GET', '/sets', t0);
  const neu = checkBudget(13, 'GET', '/sets', t0 + WINDOW_MS);
  assert.equal(neu.erlaubt, true);
  assert.equal(neu.units, 1);
  assert.equal(neu.restSec, WINDOW_MS / 1000);
});

test('abgewiesene Anfragen zählen nicht mit', () => {
  clearThrottle();
  const t0 = 4_000_000;
  for (let i = 0; i < BUDGET; i++) checkBudget(14, 'GET', '/sets', t0);
  let ab;
  for (let i = 0; i < 20; i++) ab = checkBudget(14, 'GET', '/sets', t0 + 1000);
  assert.equal(ab.erlaubt, false);
  assert.equal(ab.units, BUDGET, 'die Abweisung darf den Zähler nicht weiter hochziehen');
});

test('der Auftragstopf greift vor dem allgemeinen Budget', () => {
  clearThrottle();
  const t0 = 5_000_000;
  for (let i = 0; i < JOB_BUDGET; i++) assert.equal(checkBudget(15, 'POST', '/sets/partslist-pdf', t0).erlaubt, true);
  const ab = checkBudget(15, 'POST', '/sets/partslist-pdf', t0);
  assert.equal(ab.erlaubt, false);
  assert.equal(ab.auftrag, true);
  assert.ok(ab.units < BUDGET, 'sonst hätte das allgemeine Budget zugemacht, nicht der Topf');
  // Lesen und Schreiben ohne Auftrag gehen weiter.
  assert.equal(checkBudget(15, 'GET', '/sets', t0).erlaubt, true);
});

test('Katalogabrufe kosten mehr als Lesen', () => {
  assert.equal(classification('GET', '/catalog/sets').kosten, COST.abruf);
  assert.equal(classification('GET', '/sets').kosten, COST.normal);
  assert.equal(classification('POST', '/minifigs/import/csv').auftrag, true);
  assert.equal(classification('GET', '/settings/export/data').auftrag, true);
});

test('ein Schrägstrich am Ende kostet so viel wie die Route, die Express findet', () => {
  for (const [m, p, k] of [
    ['POST', '/sets/partslist-pdf/', COST.auftrag],
    ['POST', '/sets/import/csv//', COST.auftrag],
    ['GET', '/wanted/10294-1/preise/', COST.preis],
    ['POST', '/vouchers/3/guthaben/', COST.abruf],
    ['GET', '/catalog/sets/', COST.abruf],
    ['HEAD', '/settings/export/data/', COST.auftrag],
  ])
    assert.equal(classification(m, p).kosten, k, `${m} ${p}`);
});

test('Routen mit BrickLink- oder Fremdabruf kosten mehr als Lesen', () => {
  for (const [m, p] of [
    ['GET', '/wanted/10294-1/preise'],
    ['GET', '/sets/10294-1/price'],
  ])
    assert.equal(classification(m, p).kosten, COST.preis, `${m} ${p}`);
  for (const [m, p] of [
    ['POST', '/sets'],
    ['GET', '/sets/barcode/123'],
    ['POST', '/sets/10294-1/parts'],
    ['POST', '/parts'],
    ['POST', '/minifigs'],
    ['POST', '/vouchers/3/guthaben'],
  ])
    assert.equal(classification(m, p).kosten, COST.abruf, `${m} ${p}`);
  assert.ok(COST.preis > COST.abruf);
  // Die Preisroute darf das gemeinsame Kontingent nicht mit dem ganzen Budget leeren.
  clearThrottle();
  let n = 0;
  while (checkBudget(31, 'GET', '/wanted/1-1/preise', 9_000_000).erlaubt) n++;
  assert.ok(n * 4 <= 150, `${n} Anfragen je Fenster = bis zu ${n * 4} BrickLink-Aufrufe`);
});

test('die Route antwortet 429 mit Retry-After und Fehlercode', async t => {
  clearThrottle();
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
