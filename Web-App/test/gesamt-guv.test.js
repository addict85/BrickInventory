/**
 * Gesamt-G&V in Finanzen: Ein Posten ohne Marktpreis ist kein Wert 0.
 *
 * Vorher rechnete die Kachel alle Kaufpreise gegen alle Marktwerte; ohne
 * einen einzigen Marktpreis stand dort −100 %.
 *
 * Gegenprobe (am 25.10. gemessen): die Bedingung `m > 0` in
 * gesamtGuvProzent() entfernt → rot: „−100 % ohne Marktpreis".
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { gesamtGuvProzent } = _req('src/finanzen/rechnung/gewinnVerlust.js');

test('Gesamt-G&V nur über Posten mit Kauf- UND Marktpreis', () => {
  assert.equal(gesamtGuvProzent([{ purchase_price: 100, current_price: 0, quantity: 1 }]), null,
    '−100 % ohne Marktpreis');
  assert.equal(gesamtGuvProzent([]), null);
  assert.equal(gesamtGuvProzent([{ purchase_price: 0, current_price: 80, quantity: 1 }]), null, 'ohne Kaufpreis');
  // Nur das zweite Set ist vergleichbar: 2 × 50 → 2 × 60 = +20 %.
  assert.equal(gesamtGuvProzent([
    { purchase_price: 100, current_price: 0,  quantity: 1 },
    { purchase_price: 50,  current_price: 60, quantity: 2 },
    { purchase_price: null, current_price: 999, quantity: 1 },
  ]), '20.0');
  assert.equal(gesamtGuvProzent([{ purchase_price: 200, current_price: 150, quantity: 1 }]), '-25.0');
});
