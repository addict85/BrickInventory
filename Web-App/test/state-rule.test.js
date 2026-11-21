/**
 * One rule for the condition (src/infra/validate.ts:zustand): 'U' in any
 * spelling is used, 'N' new, everything else the default.
 *
 * Counter-checks (measured on 11.11.2026):
 *   A  the toUpperCase() removed in zustand() → red: “lower case counts like upper case”
 *   B  the default ignored (always 'N') → red: “unknown values become the default”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const _req = require('./helpers/sources').buildAndRequire();

test('lower case counts like upper case', () => {
  const { zustand } = _req('src/infra/validate.js');
  assert.equal(zustand('u'), 'U');
  assert.equal(zustand(' n '), 'N');
});

test('unknown values become the default', () => {
  const { zustand } = _req('src/infra/validate.js');
  assert.equal(zustand('X'), 'N');
  assert.equal(zustand(null, 'U'), 'U');
  assert.equal(zustand('', 'U'), 'U');
  assert.equal(zustand('N', 'U'), 'N', 'eine gültige Angabe schlägt die Vorgabe');
});
