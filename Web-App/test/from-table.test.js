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

test('a known key delivers the value', () => {
  assert.strictEqual(fromTable(TABELLE, 'name_asc', 'VORGABE'), 'rb.name ASC');
});

test('an unknown key delivers the default', () => {
  assert.strictEqual(fromTable(TABELLE, 'gibtsnicht', 'VORGABE'), 'VORGABE');
});

test('inherited properties do NOT count as hits', () => {
  // Das ist der eigentliche Befund. Ohne hasOwnProperty käme hier die
  // Object-Funktion bzw. Object.prototype zurück — beides wahrheitswertig,
  // beides landete ungeprüft im SQL.
  for (const k of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.strictEqual(fromTable(TABELLE, k, 'VORGABE'), 'VORGABE', `Schlüssel ${k}`);
  }
});

test('counter-check: the naive access FAILS with the same keys', () => {
  // Belegt, dass der Test oben etwas prüft und nicht ohnehin grün wäre.
  const naive = k => TABELLE[k] || 'VORGABE';
  assert.strictEqual(naive('gibtsnicht'), 'VORGABE'); // hier gleich
  assert.notStrictEqual(naive('constructor'), 'VORGABE'); // hier NICHT
  assert.notStrictEqual(naive('__proto__'), 'VORGABE');
});

test('non-string keys are handled safely', () => {
  for (const k of [undefined, null, 42, {}, ['name_asc'], true]) {
    const r = fromTable(TABELLE, k, 'VORGABE');
    // Ein Array mit einem gültigen Wert darf über einzelwert() greifen —
    // alles andere fällt auf die Vorgabe.
    assert.ok(r === 'VORGABE' || r === 'rb.name ASC', `Schlüssel ${JSON.stringify(k)} ergab ${r}`);
  }
});

test('without a default undefined comes instead of an inherited value', () => {
  assert.strictEqual(fromTable(TABELLE, 'constructor'), undefined);
  assert.strictEqual(fromTable(TABELLE, 'name_asc'), 'rb.name ASC');
});

// ── Die drei Fundstellen: kein direkter Tabellenzugriff mehr ────────────────

/** @type {[string, string, RegExp][]} */
const PLACES = [
  ['src/catalog/repository/catalogSearch.ts', 'ORDERS', /ORDERS\s*\[/],
  ['src/sets/repository/sets.ts', 'SET_SORTS', /SET_SORTS\s*\[/],
  // Die Endungen je MIME-Typ der Uploads stehen seit 05.11.2026 im Empfang.
  ['src/http/fileUpload.ts', 'o.typen', /o\.typen\s*\[/],
];

for (const [datei, name, muster] of PLACES) {
  test(`${datei}: ${name} is no longer indexed directly`, () => {
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
