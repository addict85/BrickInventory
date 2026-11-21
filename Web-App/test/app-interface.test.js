/**
 * What the Android app needs from the server is in shared/app-schnittstelle.json (generated from
 * its source text, checked for currency in the Android run). The server must keep offering it:
 * every route in the contract, with the query parameters and body fields the app sends.
 * Whether the Kotlin models can read the responses is checked by the Android side
 * (Android-App/tools/vertrag/vertrag-kotlin.test.js).
 *
 * Counter-checks (measured 14.11.2026, each alone, reverted):
 *   A  'GET /api/v1/settings/default-condition' renamed in the contract → red: “every route of the app …”
 *   B  SEITE without `page_size` (src/contract/base.ts) → red: “every query parameter …”
 *   C  `label` deleted from the login data in the contract → red: “every body field …” (LoginRequest)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const dok = _req('src/contract/openapi.js').openapi();
const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'app-schnittstelle.json'), 'utf8'));

/** @param {string} p */
const uniform = p => p.replace(/\{\w+\}/g, '{}');
/** @param {string} methode @param {string} pfad */
function operation(methode, pfad) {
  const treffer = Object.entries(dok.paths).filter(([p]) => uniform(p) === uniform(pfad));
  return treffer.length === 1 ? treffer[0][1][methode.toLowerCase()] : undefined;
}

test('every route of the app is in the contract', () => {
  assert.ok(app.routen.length > 100, `nur ${app.routen.length} Routen — ist die Datei erzeugt?`);
  const ohne = app.routen.filter(r => !operation(r.methode, r.pfad)).map(r => `${r.methode} ${r.pfad}`);
  assert.deepEqual(ohne, [], 'Diese Adressen ruft die App, der Server hat sie nicht');
});

test('every query parameter of the app is in the contract', () => {
  const fehlt = [];
  let geprueft = 0;
  for (const r of app.routen) {
    const namen = new Set(
      (operation(r.methode, r.pfad)?.parameters ?? []).filter(p => p.in === 'query').map(p => p.name),
    );
    for (const a of r.abfrage) {
      geprueft++;
      if (!namen.has(a.name)) fehlt.push(`${r.methode} ${r.pfad} ?${a.name}`);
    }
  }
  assert.ok(geprueft >= 50, `nur ${geprueft} Abfrageparameter verglichen`);
  assert.deepEqual(fehlt, []);
});

// Inputs are closed (strictObject): a field the app sends and the contract
// does not know would be a 400 in production.
test('every body field of the app is in the contract', () => {
  // A generated body type serves several routes (union of their schemas); a field must be in
  // one of them.
  const withBody = app.routen.filter(x => x.rumpffelder.length);
  /** @type {Map<string, Set<string>>} */
  const jeType = new Map();
  for (const r of withBody) {
    const schema = operation(r.methode, r.pfad)?.requestBody?.content?.['application/json']?.schema;
    const felder = jeType.get(r.rumpf ?? '') ?? new Set();
    for (const f of Object.keys(schema?.properties ?? {})) felder.add(f);
    jeType.set(r.rumpf ?? '', felder);
  }
  const fehlt = [];
  let geprueft = 0;
  for (const r of withBody) {
    geprueft++;
    for (const f of r.rumpffelder)
      if (!jeType.get(r.rumpf ?? '')?.has(f)) fehlt.push(`${r.methode} ${r.pfad} ${r.rumpf}.${f}`);
  }
  assert.ok(geprueft >= 35, `nur ${geprueft} Rümpfe verglichen`);
  assert.deepEqual(fehlt, []);
});
