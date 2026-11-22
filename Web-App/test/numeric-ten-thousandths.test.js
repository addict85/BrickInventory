/**
 * NUMERIC comes as a number that stays exact in ten-thousandths; a value for which
 * that no longer holds throws instead of silently rounding.
 *
 * Counter-check (measured 14.11.2026): the parser again `parseFloat(v)` → red:
 * “beyond 2^53/10^4 …” (Missing expected exception).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildAndRequire, ROOT } = require('./helpers/sources');

buildAndRequire();
const { numericAsNumber } = require(path.join(ROOT, 'dist/db/database.js'));
const { inZehntel4 } = require(path.join(ROOT, 'dist/src/infra/geld.js'));

test('NUMERIC(12,4) stays exact in ten-thousandths', () => {
  /** @type {[string, number][]} */
  const faelle = [
    ['99999999.9999', 999999999999],
    ['-12345678.0001', -123456780001],
    ['0.0001', 1],
    ['1.005', 10050],
  ];
  for (const [roh, z] of faelle) assert.equal(inZehntel4(numericAsNumber(roh)), z, roh);
  assert.equal(numericAsNumber(null), null);
});

test('beyond 2^53/10^4 the parser throws', () => {
  assert.throws(() => numericAsNumber('900719925474.0993'), RangeError);
  assert.equal(inZehntel4(numericAsNumber('900719925474.0000')), 9007199254740000);
});
