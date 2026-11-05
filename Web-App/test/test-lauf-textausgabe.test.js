/**
 * „Unable to deserialize cloned data" unter Last: node:test (Node 22) liest
 * Berichtsrahmen und Text des Kindes aus demselben Strom. Steht Text mit einem
 * Nicht-ASCII-Byte an Stelle 2 im selben Lesestück direkt hinter einem Rahmen,
 * wird seine Länge negativ gelesen und der Text deserialisiert. Unter Last
 * landen mehr Schreibvorgänge in einem Lesestück, daher nur dann.
 *
 * Geprüft wird der echte Weg: scripts/test-lauf.js mit einer Datei, die das
 * Muster 300-mal schreibt (test/fixtures/rahmen-und-text.js). @einzeln, weil
 * test-lauf.js dist/ neu baut, aus dem parallele Dateien gerade lesen.
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
  assert.equal((ausgabe.match(/# rahmen/g) || []).length, 300, 'nicht alle Rahmen kamen an');
  assert.match(ausgabe, /^# pass 1$/m);
});
