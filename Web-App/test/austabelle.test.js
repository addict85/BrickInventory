/**
 * Nachschlagetabellen mit Schlüssel von aussen.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Über buildAndRequire: Ein veraltetes dist/ prüfte sonst den Stand vor der letzten Änderung.
const _req = require('./helpers/sources').buildAndRequire();
const { fromTable } = _req('src/infra/validate.js');

const TABELLE = { year_desc: 'rb.year DESC', name_asc: 'rb.name ASC' };

test('bekannter Schlüssel liefert den Wert', () => {
  assert.strictEqual(fromTable(TABELLE, 'name_asc', 'VORGABE'), 'rb.name ASC');
});

test('unbekannter Schlüssel liefert die Vorgabe', () => {
  assert.strictEqual(fromTable(TABELLE, 'gibtsnicht', 'VORGABE'), 'VORGABE');
});

test('geerbte Eigenschaften zählen NICHT als Treffer', () => {
  // Das ist der eigentliche Befund. Ohne hasOwnProperty käme hier die
  // Object-Funktion bzw. Object.prototype zurück — beides wahrheitswertig,
  // beides landete ungeprüft im SQL.
  for (const k of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.strictEqual(fromTable(TABELLE, k, 'VORGABE'), 'VORGABE', `Schlüssel ${k}`);
  }
});

test('Gegenprobe: der naive Zugriff FÄLLT bei denselben Schlüsseln durch', () => {
  // Belegt, dass der Test oben etwas prüft und nicht ohnehin grün wäre.
  const naive = k => TABELLE[k] || 'VORGABE';
  assert.strictEqual(naive('gibtsnicht'), 'VORGABE'); // hier gleich
  assert.notStrictEqual(naive('constructor'), 'VORGABE'); // hier NICHT
  assert.notStrictEqual(naive('__proto__'), 'VORGABE');
});

test('nicht-string Schlüssel werden gefahrlos behandelt', () => {
  for (const k of [undefined, null, 42, {}, ['name_asc'], true]) {
    const r = fromTable(TABELLE, k, 'VORGABE');
    // Ein Array mit einem gültigen Wert darf über einzelwert() greifen —
    // alles andere fällt auf die Vorgabe.
    assert.ok(r === 'VORGABE' || r === 'rb.name ASC', `Schlüssel ${JSON.stringify(k)} ergab ${r}`);
  }
});

test('ohne Vorgabe kommt undefined statt eines geerbten Werts', () => {
  assert.strictEqual(fromTable(TABELLE, 'constructor'), undefined);
  assert.strictEqual(fromTable(TABELLE, 'name_asc'), 'rb.name ASC');
});

// ── Die drei Fundstellen: kein direkter Tabellenzugriff mehr ────────────────

/** @type {[string, string, RegExp][]} */
const PLACES = [
  ['src/catalog/repository/catalogSearch.ts', 'ORDERS', /ORDERS\s*\[/],
  ['src/sets/repository/sets.ts', 'SET_SORTS', /SET_SORTS\s*\[/],
  // Die Endungen je MIME-Typ der Uploads stehen seit 05.11.2026 im Empfang.
  ['src/http/dateiEmpfang.ts', 'o.typen', /o\.typen\s*\[/],
];

for (const [datei, name, muster] of PLACES) {
  test(`${datei}: ${name} wird nicht mehr direkt indiziert`, () => {
    // Kommentarzeilen heraus: Die Begründung ÜBER dem Code nennt das alte
    // Muster absichtlich, und darauf soll dieser Test nicht anspringen.
    const code = fs
      .readFileSync(path.join(ROOT, datei), 'utf8')
      .split('\n')
      .filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*') && !z.trim().startsWith('/*'))
      .join('\n');
    assert.ok(!muster.test(code), `${datei} greift noch direkt auf ${name}[…] zu — fromTable() verwenden.`);
    assert.match(code, new RegExp(`fromTable\\(\\s*${name}`), `${datei} sollte fromTable(${name}, …) benutzen.`);
  });
}
