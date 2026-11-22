/**
 * No schema statement in the request path.
 *
 * Counter-check (09.11.2026): `'ALTER TABLE sets ADD COLUMN probe INT'` in src/sets/read.ts → red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('no schema statement in routes/ or the read queries', () => {
  const script = path.join(__dirname, '..', 'scripts', 'check-schema-at-start.js');
  let output = '';
  try {
    output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
  } catch (e) {
    assert.fail((e.stdout || '') + (e.stderr || ''));
  }
  assert.match(output, /^GRUEN/m, output);
});
