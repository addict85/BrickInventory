/**
 * Eine Regel für den Zustand (src/infra/validate.ts:zustand): 'U' in jeder
 * Schreibung ist gebraucht, 'N' neu, alles andere die Vorgabe.
 *
 * Gegenproben (am 11.11.2026 gemessen):
 *   A  in zustand() das toUpperCase() entfernt → rot: „klein geschrieben zählt wie gross“
 *   B  die Vorgabe ignoriert (immer 'N') → rot: „Unbekanntes wird zur Vorgabe“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const _req = require('./helpers/sources').buildAndRequire();

test('klein geschrieben zählt wie gross', () => {
  const { zustand } = _req('src/infra/validate.js');
  assert.equal(zustand('u'), 'U');
  assert.equal(zustand(' n '), 'N');
});

test('Unbekanntes wird zur Vorgabe', () => {
  const { zustand } = _req('src/infra/validate.js');
  assert.equal(zustand('X'), 'N');
  assert.equal(zustand(null, 'U'), 'U');
  assert.equal(zustand('', 'U'), 'U');
  assert.equal(zustand('N', 'U'), 'N', 'eine gültige Angabe schlägt die Vorgabe');
});
