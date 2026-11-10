/**
 * konfig() liest die Umgebung einmal und friert das Ergebnis ein; wer sie
 * danach umstellt, sagt es mit konfigNeuLesen() oder setzeKonfig().
 *
 * Gegenproben (10.11.2026 gemessen):
 *   A  in konfig() `_konfig ??=` durch `_konfig =` ersetzt (jeder Aufruf liest neu)
 *      → rot: „nach dem ersten Lesen ändert die Umgebung nichts mehr“ (4102 statt 4101)
 *   B  setzeKonfig() ohne `...teil` → rot: „setzeKonfig legt Werte darüber,
 *      null hebt sie auf“ (3000 statt 5)
 *   C  Object.freeze in konfig() weggelassen → rot: „die Konfiguration ist eingefroren“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { konfig, konfigNeuLesen, setzeKonfig } = _req('src/infra/konfig.js');

const vorher = process.env.PORT;
test.after(() => {
  if (vorher === undefined) delete process.env.PORT;
  else process.env.PORT = vorher;
  konfigNeuLesen();
});

test('nach dem ersten Lesen ändert die Umgebung nichts mehr', () => {
  process.env.PORT = '4101';
  assert.equal(konfigNeuLesen().port, 4101);
  process.env.PORT = '4102';
  assert.equal(konfig().port, 4101);
  assert.equal(konfigNeuLesen().port, 4102);
});

test('setzeKonfig legt Werte darüber, null hebt sie auf', () => {
  process.env.PORT = '4103';
  assert.equal(setzeKonfig({ port: 5 }).port, 5);
  assert.equal(konfig().port, 5);
  assert.equal(setzeKonfig(null).port, 4103);
});

test('die Konfiguration ist eingefroren', () => {
  assert.ok(Object.isFrozen(konfigNeuLesen()));
  assert.ok(Object.isFrozen(setzeKonfig({ port: 5 })));
  setzeKonfig(null);
});
