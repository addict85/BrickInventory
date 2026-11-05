/**
 * „Unable to deserialize cloned data" unter Last: node:test (Node 22) liest
 * Berichtsrahmen und Text des Kindes aus demselben Strom. Steht Text mit einem
 * Nicht-ASCII-Byte an Stelle 2 im selben Lesestück direkt hinter einem Rahmen,
 * wird seine Länge negativ gelesen und der Text deserialisiert. Unter Last …
 * Ausführlich: docs/begruendungen/test/test-lauf-textausgabe.test.js.md#kopf
 *
 * Gegenprobe (05.11.2026): in scripts/test-lauf.js das Vorladen von
 * test/helpers/textausgabe.js gestrichen → rot (Exit 1, der Lauf bricht nach
 * wenigen Rahmen ohne Zusammenfassung ab).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('test-lauf.js übersteht Rahmen mit Nicht-ASCII-Text dahinter', () => {
  const env = { ...process.env };
  // Ohne Datenbank: Geprüft wird nur der Weg der Ausgabe.
  delete env.TEST_DATABASE_URL; delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test-lauf.js'), 'test/fixtures/rahmen-und-text.js'],
    { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 });
  const ausgabe = r.stdout + r.stderr;
  assert.equal(r.status, 0, ausgabe.slice(-2000));
  assert.match(ausgabe, /^(# |ℹ )pass 1$/m);
  // Die Rahmen der Attrappe folgen dem Format von Node 22; neuere Läufer (CI:
  // Node 26) lesen sie nicht als Rahmen. Dort zählt nur, dass der Lauf heil bleibt.
  if (Number(process.versions.node.split('.')[0]) <= 22) {
    assert.equal((ausgabe.match(/^(# |ℹ )rahmen$/gm) || []).length, 300, 'nicht alle Rahmen kamen an');
  }
});
