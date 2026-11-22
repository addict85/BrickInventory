/**
 * Lookup tables with a key from outside.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Via buildAndRequire: a stale dist/ would otherwise check the state before the last change.
const _req = require('./helpers/sources').buildAndRequire();
const { fromTable } = _req('src/infra/validate.js');

const TABLE_NAME = { year_desc: 'rb.year DESC', name_asc: 'rb.name ASC' };

test('a known key delivers the value', () => {
  assert.strictEqual(fromTable(TABLE_NAME, 'name_asc', 'VORGABE'), 'rb.name ASC');
});

test('an unknown key delivers the default', () => {
  assert.strictEqual(fromTable(TABLE_NAME, 'gibtsnicht', 'VORGABE'), 'VORGABE');
});

test('inherited properties do NOT count as hits', () => {
  // This is the actual finding. Without hasOwnProperty the
  // Object function or Object.prototype would come back here — both truthy,
  // both landed unchecked in the SQL.
  for (const k of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.strictEqual(fromTable(TABLE_NAME, k, 'VORGABE'), 'VORGABE', `Schlüssel ${k}`);
  }
});

test('counter-check: the naive access FAILS with the same keys', () => {
  // Proves that the test above checks something and would not be green anyway.
  const naive = k => TABLE_NAME[k] || 'VORGABE';
  assert.strictEqual(naive('gibtsnicht'), 'VORGABE'); // equal here
  assert.notStrictEqual(naive('constructor'), 'VORGABE'); // NOT here
  assert.notStrictEqual(naive('__proto__'), 'VORGABE');
});

test('non-string keys are handled safely', () => {
  for (const k of [undefined, null, 42, {}, ['name_asc'], true]) {
    const r = fromTable(TABLE_NAME, k, 'VORGABE');
    // An array with a valid value may apply via einzelwert() —
    // everything else falls back to the default.
    assert.ok(r === 'VORGABE' || r === 'rb.name ASC', `Schlüssel ${JSON.stringify(k)} ergab ${r}`);
  }
});

test('without a default undefined comes instead of an inherited value', () => {
  assert.strictEqual(fromTable(TABLE_NAME, 'constructor'), undefined);
  assert.strictEqual(fromTable(TABLE_NAME, 'name_asc'), 'rb.name ASC');
});

// ── The three locations: no direct table access anymore ────────────────────

/** @type {[string, string, RegExp][]} */
const PLACES = [
  ['src/catalog/repository/catalogSearch.ts', 'ORDERS', /ORDERS\s*\[/],
  ['src/sets/repository/sets.ts', 'SET_SORTS', /SET_SORTS\s*\[/],
  // The extensions per MIME type of the uploads have been in the reception since 05.11.2026.
  ['src/http/fileUpload.ts', 'o.typen', /o\.typen\s*\[/],
];

for (const [datei, name, muster] of PLACES) {
  test(`${datei}: ${name} is no longer indexed directly`, () => {
    // Comment lines out: the rationale ABOVE the code names the old
    // pattern on purpose, and this test should not trigger on it.
    const code = fs
      .readFileSync(path.join(ROOT, datei), 'utf8')
      .split('\n')
      .filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*') && !z.trim().startsWith('/*'))
      .join('\n');
    assert.ok(!muster.test(code), `${datei} greift noch direkt auf ${name}[…] zu — fromTable() verwenden.`);
    assert.match(code, new RegExp(`fromTable\\(\\s*${name}`), `${datei} sollte fromTable(${name}, …) benutzen.`);
  });
}
