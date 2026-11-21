/**
 * The same operand twice in the web app.
 *
 * The rule lives in scripts/check-duplicate-operands.js; there it is also
 * explained why it exists. This test runs it along in the normal run.
 *
 * Counter-checks (performed):
 *   a) the known `avg > 0 || avg > 0` in financeCalc.ts brought back → red.
 *   b) `SELECT avg_price, avg_price` brought back → red.
 *   d) the path to the sources bent → red with its own message instead of silently
 *      green on half the set.
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
