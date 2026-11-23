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
const doc = _req('src/contract/openapi.js').openapi(2);
const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'app-interface.json'), 'utf8'));

/** @param {string} p */
const uniform = p => p.replace(/\{\w+\}/g, '{}');
/** @param {string} method @param {string} route */
function operation(method, route) {
  const hits = Object.entries(doc.paths).filter(([p]) => uniform(p) === uniform(route));
  return hits.length === 1 ? hits[0][1][method.toLowerCase()] : undefined;
}

test('every route of the app is in the contract', () => {
  assert.ok(app.routes.length > 100, `only ${app.routes.length} routes — has the file been generated?`);
  const without = app.routes.filter(r => !operation(r.method, r.path)).map(r => `${r.method} ${r.path}`);
  assert.deepEqual(without, [], 'The app calls these addresses, the server does not have them');
});

test('every query parameter of the app is in the contract', () => {
  const missing = [];
  let checked = 0;
  for (const r of app.routes) {
    const names = new Set(
      (operation(r.method, r.path)?.parameters ?? []).filter(p => p.in === 'query').map(p => p.name),
    );
    for (const a of r.query) {
      checked++;
      if (!names.has(a.name)) missing.push(`${r.method} ${r.path} ?${a.name}`);
    }
  }
  assert.ok(checked >= 50, `nur ${checked} Abfrageparameter verglichen`);
  assert.deepEqual(missing, []);
});

// Inputs are closed (strictObject): a field the app sends and the contract
// does not know would be a 400 in production.
test('every body field of the app is in the contract', () => {
  // A generated body type serves several routes (union of their schemas); a field must be in
  // one of them.
  const withBody = app.routes.filter(x => x.body_fields.length);
  /** @type {Map<string, Set<string>>} */
  const perType = new Map();
  for (const r of withBody) {
    const schema = operation(r.method, r.path)?.requestBody?.content?.['application/json']?.schema;
    const fields = perType.get(r.body ?? '') ?? new Set();
    for (const f of Object.keys(schema?.properties ?? {})) fields.add(f);
    perType.set(r.body ?? '', fields);
  }
  const missing = [];
  let checked = 0;
  for (const r of withBody) {
    checked++;
    for (const f of r.body_fields)
      if (!perType.get(r.body ?? '')?.has(f)) missing.push(`${r.method} ${r.path} ${r.body}.${f}`);
  }
  assert.ok(checked >= 35, `only ${checked} bodies compared`);
  assert.deepEqual(missing, []);
});
