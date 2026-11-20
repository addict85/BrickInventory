/**
 * Keine Schema-Anweisung im Anfragepfad.
 *
 * Gegenprobe (09.11.2026): `'ALTER TABLE sets ADD COLUMN probe INT'` in src/sets/lesen.ts → rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('keine Schema-Anweisung in routes/ oder den Leseabfragen', () => {
  const script = path.join(__dirname, '..', 'scripts', 'check-schema-am-start.js');
  let output = '';
  try {
    output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
  } catch (e) {
    assert.fail((e.stdout || '') + (e.stderr || ''));
  }
  assert.match(output, /^GRUEN/m, output);
});
