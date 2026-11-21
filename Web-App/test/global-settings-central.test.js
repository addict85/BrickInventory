/**
 * `global_settings` is touched via src/settings/settings.ts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('no new direct access to global_settings', () => {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-global-settings.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const p = /** @type {{ stdout?: unknown, stderr?: unknown }} */ (e);
    assert.fail(String(p.stderr || '') + String(p.stdout || ''));
  }
});
