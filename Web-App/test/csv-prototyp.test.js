/**
 * A CSV header must not hit the prototype chain — checked on the import's reader
 * (csvReadIn in src/infra/csvExport.ts), not on a copy of its settings.
 *
 * Counter-checks (09.11.2026):
 *   A  in csvReadIn() back to `columns: true` → red: “a column __proto__ …” and “constructor too …”
 *   B  the filter discards every column → red, all three; “ordinary columns stay untouched” names the reason
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { csvReadIn } = require('./helpers/sources').buildAndRequire()('src/infra/csvExport.js');
const einlesen = (/** @type {string} */ csv) => csvReadIn(csv).records;

test('a column __proto__ does not end up in the prototype chain', () => {
  const vorher = /** @type {any} */ (Object.prototype).polluted;
  const records = einlesen('set_number,__proto__\n10497-1,{"polluted":true}\n');
  assert.equal(records.length, 1);
  assert.equal(records[0].set_number, '10497-1', 'Die echte Spalte geht verloren — der Filter greift zu weit');
  assert.equal(
    /** @type {any} */ (Object.prototype).polluted,
    vorher,
    'Object.prototype wurde veraendert — die Kopfzeile hat die Kette getroffen',
  );
  assert.ok(!Object.hasOwn(records[0], '__proto__'), 'Der Datensatz traegt einen __proto__-Schluessel');
});

test('constructor and prototype are discarded too', () => {
  for (const name of ['constructor', 'prototype']) {
    const r = einlesen(`set_number,${name}\n10497-1,x\n`);
    assert.equal(r[0].set_number, '10497-1');
    assert.ok(!Object.hasOwn(r[0], name), `Die Spalte "${name}" ist im Datensatz gelandet`);
  }
});

test('ordinary columns stay untouched', () => {
  // A filter that discards EVERYTHING would also pass the two rules above.
  const r = einlesen('set_number,quantity,note\n10497-1,2,Geschenk\n');
  assert.deepEqual(
    r.map(z => ({ ...z })),
    [{ set_number: '10497-1', quantity: '2', note: 'Geschenk' }],
  );
});
