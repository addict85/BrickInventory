/**
 * What the Android app needs from the server is in shared/app-interface.json (generated from
 * its source text, checked for currency in the Android run). The server must keep offering it:
 * every route in the contract, with the query parameters and body fields the app sends.
 * Whether the Kotlin models can read the responses is checked by the Android side
 * (Android-App/tools/contract/contract-kotlin.test.js).
 *
 * Counter-checks (measured 14.11.2026, each alone, reverted):
 *   A  'GET /api/v2/settings/default-condition' renamed in the contract → red: “every route of the app …”
 *   B  SEITE without `page_size` (src/contract/base.ts) → red: “every query parameter …”
 *   C  `label` deleted from the login data in the contract → red: “every body field …” (LoginRequest)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const dok = _req('src/contract/openapi.js').openapi(2);
const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'app-interface.json'), 'utf8'));

/** @param {string} p */
const uniform = p => p.replace(/\{\w+\}/g, '{}');
/** @param {string} method @param {string} route */
function operation(method, route) {
  const treffer = Object.entries(dok.paths).filter(([p]) => uniform(p) === uniform(route));
  return treffer.length === 1 ? treffer[0][1][method.toLowerCase()] : undefined;
}

test('every route of the app is in the contract', () => {
  assert.ok(app.routes.length > 100, `only ${app.routes.length} routes — has the file been generated?`);
  const ohne = app.routes.filter(r => !operation(r.method, r.path)).map(r => `${r.method} ${r.path}`);
  assert.deepEqual(ohne, [], 'The app calls these addresses, the server does not have them');
});

test('every query parameter of the app is in the contract', () => {
  const fehlt = [];
  let geprueft = 0;
  for (const r of app.routes) {
    const namen = new Set(
      (operation(r.method, r.path)?.parameters ?? []).filter(p => p.in === 'query').map(p => p.name),
    );
    for (const a of r.query) {
      geprueft++;
      if (!namen.has(a.name)) fehlt.push(`${r.method} ${r.path} ?${a.name}`);
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
  const withBody = app.routes.filter(x => x.body_fields.length);
  /** @type {Map<string, Set<string>>} */
  const jeType = new Map();
  for (const r of withBody) {
    const schema = operation(r.method, r.path)?.requestBody?.content?.['application/json']?.schema;
    const felder = jeType.get(r.body ?? '') ?? new Set();
    for (const f of Object.keys(schema?.properties ?? {})) felder.add(f);
    jeType.set(r.body ?? '', felder);
  }
  const fehlt = [];
  let geprueft = 0;
  for (const r of withBody) {
    geprueft++;
    for (const f of r.body_fields)
      if (!jeType.get(r.body ?? '')?.has(f)) fehlt.push(`${r.method} ${r.path} ${r.body}.${f}`);
  }
  assert.ok(geprueft >= 35, `only ${geprueft} bodies compared`);
  assert.deepEqual(fehlt, []);
});
