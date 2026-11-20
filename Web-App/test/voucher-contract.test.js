/**
 * Der Vertrag ist die Eingabeprüfung der Gutscheine: Er formt Nummer, PIN und Währung ins Fachformat
 * und weist mit dem Code der Regel ab; der Dienst bekommt nur Geprüftes.
 *
 * Gegenproben (15.11.2026 gemessen, je einzeln):
 *   A  in src/contract/vouchers.ts `number: VOUCHER_NUMBER` → `number: z.string()` → rot:
 *      „Nummer, PIN und Währung kommen im Fachformat an“ und „unbrauchbare Werte …“
 *   B  in voucherPinOrMask() die Maske nicht durchgelassen → rot: „beim Ändern darf die
 *      Maske zurückkommen …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAndRequire } = require('./helpers/sources');

const _req = buildAndRequire();
const { routen } = _req('src/contract/vouchers.js');
const anlegen = routen['POST /api/v1/vouchers'].eingabe;
const aendern = routen['PUT /api/v1/vouchers/:id'].eingabe;

/** Der Code, mit dem der Vertrag abweist (wie der Vertragsrouter ihn liest). */
function code(schema, rumpf) {
  const r = schema.safeParse(rumpf);
  if (r.success) return null;
  return r.error.issues[0]?.params?.fehler?.code ?? r.error.issues[0]?.code;
}

test('number, PIN and currency arrive in the domain format', () => {
  const r = anlegen.parse({ number: '5045 0763-7445', pin: ' 5225 ', amount: 40, currency: 'chf' });
  assert.deepEqual(r, { number: '504507637445', pin: '5225', amount: 40, currency: 'CHF' });
  assert.deepEqual(anlegen.parse({ number: '1234', amount: 1, pin: '', currency: '' }), {
    number: '1234',
    pin: null,
    amount: 1,
    currency: null,
  });
});

test("the contract rejects unusable values with the rule's code", () => {
  assert.equal(code(anlegen, { number: 'abc', amount: 10 }), 'nummer_ungueltig');
  assert.equal(code(anlegen, { number: '12', amount: 10 }), 'nummer_ungueltig');
  assert.equal(code(anlegen, { number: 1234567, amount: 10 }), 'nummer_ungueltig');
  assert.equal(code(anlegen, { number: '1234567', amount: 10, pin: 'ab' }), 'pin_ungueltig');
  assert.equal(code(anlegen, { number: '1234567', amount: 10, currency: 'Franken' }), 'waehrung_ungueltig');
});

test('when changing the mask may come back, empty means remove', () => {
  assert.deepEqual(aendern.parse({ number: '…1166', pin: '•••' }), { number: '…1166', pin: '•••' });
  assert.deepEqual(aendern.parse({ pin: '', currency: '' }), { pin: '', currency: '' });
  assert.equal(code(aendern, { number: '…11' }), 'nummer_ungueltig');
  assert.equal(code(aendern, { pin: '••' }), 'pin_ungueltig');
});
