/**
 * Keine Schema-Anweisung im Anfragepfad.
 * Ausführlich: docs/begruendungen/test/schema-am-start.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('keine Schema-Anweisung in routes/ oder den Leseabfragen', () => {
  const skript = path.join(__dirname, '..', 'scripts', 'check-schema-am-start.js');
  let ausgabe = '';
  try {
    ausgabe = execFileSync(process.execPath, [skript], { encoding: 'utf8' });
  } catch (e) {
    assert.fail((e.stdout || '') + (e.stderr || ''));
  }
  assert.match(ausgabe, /^GRUEN/m, ausgabe);
});
