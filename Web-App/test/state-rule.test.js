/**
 * One rule for the condition (src/infra/validate.ts:conditionOf): 'U' in any
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
  const { conditionOf: condition } = _req('src/infra/validate.js');
  assert.equal(condition('u'), 'U');
  assert.equal(condition(' n '), 'N');
});

test('unknown values become the default', () => {
  const { conditionOf: condition } = _req('src/infra/validate.js');
  assert.equal(condition('X'), 'N');
  assert.equal(condition(null, 'U'), 'U');
  assert.equal(condition('', 'U'), 'U');
  assert.equal(condition('N', 'U'), 'N', 'eine gültige Angabe schlägt die Vorgabe');
});
