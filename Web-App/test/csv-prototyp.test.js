/**
 * Eine CSV-Kopfzeile darf die Prototypenkette nicht treffen — geprüft am Einleser des Imports
 * (csvEinlesen in src/infra/csvExport.ts), nicht an einer Kopie seiner Einstellungen.
 * Ausführlich: docs/begruendungen/test/csv-prototyp.test.js.md#stelle
 *
 * Gegenproben (09.11.2026):
 *   A  in csvEinlesen() wieder `columns: true` → rot: „eine Spalte __proto__ …“ und „auch constructor …“
 *   B  der Filter verwirft jede Spalte → rot, alle drei; „gewoehnliche Spalten bleiben unberuehrt“ nennt den Grund
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { csvEinlesen } = require('./helpers/sources').buildAndRequire()('src/infra/csvExport.js');
const einlesen = (/** @type {string} */ csv) => csvEinlesen(csv).records;

test('eine Spalte __proto__ landet nicht in der Prototypenkette', () => {
  const vorher = /** @type {any} */ (Object.prototype).polluted;
  const records = einlesen('set_number,__proto__\n10497-1,{"polluted":true}\n');
  assert.equal(records.length, 1);
  assert.equal(records[0].set_number, '10497-1', 'Die echte Spalte geht verloren — der Filter greift zu weit');
  assert.equal(
    /** @type {any} */ (Object.prototype).polluted,
    vorher,
    'Object.prototype wurde veraendert — die Kopfzeile hat die Kette getroffen',
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(records[0], '__proto__'),
    'Der Datensatz traegt einen __proto__-Schluessel',
  );
});

test('auch constructor und prototype werden verworfen', () => {
  for (const name of ['constructor', 'prototype']) {
    const r = einlesen(`set_number,${name}\n10497-1,x\n`);
    assert.equal(r[0].set_number, '10497-1');
    assert.ok(!Object.prototype.hasOwnProperty.call(r[0], name), `Die Spalte "${name}" ist im Datensatz gelandet`);
  }
});

test('gewoehnliche Spalten bleiben unberuehrt', () => {
  // Ein Filter, der ALLES verwirft, bestünde die beiden Regeln oben ebenfalls.
  const r = einlesen('set_number,quantity,note\n10497-1,2,Geschenk\n');
  assert.deepEqual(
    r.map(z => ({ ...z })),
    [{ set_number: '10497-1', quantity: '2', note: 'Geschenk' }],
  );
});
