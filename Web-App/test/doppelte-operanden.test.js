/**
 * Derselbe Operand zweimal in der Webapp.
 *
 * Die Regel steht in scripts/check-duplicate-operands.js; dort ist auch
 * begründet, warum es sie gibt. Dieser Test führt sie im normalen Lauf mit aus.
 *
 * Gegenproben (durchgeführt):
 *   a) Den bekannten `avg > 0 || avg > 0` in financeCalc.ts zurückgeholt → rot.
 *   b) `SELECT avg_price, avg_price` zurückgeholt → rot.
 *   d) Den Pfad zu den Quellen verbogen → rot mit eigener Meldung, statt still
 *      grün auf der halben Menge.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('no expression stands twice on both sides', () => {
  const script = path.join(__dirname, '..', 'scripts', 'check-duplicate-operands.js');
  try {
    execFileSync(process.execPath, [script], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    assert.fail(
      `${e.stdout || ''}${e.stderr || ''}`.trim() ||
        'check-duplicate-operands.js ist fehlgeschlagen, ohne etwas zu melden',
    );
  }
});
