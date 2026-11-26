/**
 * A voucher without an uploaded original is drawn into LEGO's card layout: number, PIN,
 * amount and a Code 128 barcode of the number, and readable back like a real card.
 *
 * Counter-checks (measured 26.11.2026, each individually):
 *   a) the check digit summed without position weights   → red „the check digit weighs …“
 *   b) an odd-length number without the leading set-B digit → red „19 digits …“
 *   c) the PIN marker filled with ''                       → red „the card reads back with its PIN“
 *   d) the template again with the original card number    → red „no card number in the template“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { fillTemplate, code128Values, code128Bars } = _req('src/vouchers/templatePdf.js');
const { readPageByPage } = _req('src/vouchers/pdfExport.js');
const { pdfText } = _req('src/vouchers/pdfParsing.js');

test('Code 128 values and check digit', () => {
  // 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879; 879 mod 103 = 55.
  // (A scanner, zbarimg, read the generated cards back when this was written.)
  assert.deepEqual(
    code128Values('PJJ123C'),
    [104, 48, 42, 42, 17, 18, 19, 35, 55, 106],
    'the check digit weighs each symbol by its position',
  );
  // 19 digits: one digit in set B, then CODE C and nine digit pairs.
  const v = code128Values('1234567890123456789');
  assert.deepEqual(v.slice(0, 3), [104, 17, 99], '19 digits start in set B with the first digit');
  assert.deepEqual(v.slice(3, 12), [23, 45, 67, 89, 1, 23, 45, 67, 89], '19 digits continue as pairs in set C');
  // Every symbol is 11 modules, the stop 13.
  assert.equal(code128Bars('PJJ123C').modules, 9 * 11 + 13);
});

test('a voucher without an original becomes a LEGO card that reads back', async () => {
  const pdf = await fillTemplate({ number: '5045076374450017777', pin: '4321', amount: 125.5, currency: 'CHF' });
  const text = pdfText(pdf);
  assert.match(text, /Bauen und spielen!/, 'the LEGO layout is there');
  const [card] = await readPageByPage(pdf);
  assert.ok(card, 'the card reads back');
  assert.equal(card.number, '5045076374450017777');
  assert.equal(card.pin, '4321', 'the card reads back with its PIN');
  assert.equal(card.amount, 125.5);
  assert.equal(card.currency, 'CHF');
});

test('the template carries no card data', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'assets', 'voucher-template.pdf'));
  const text = pdfText(template);
  assert.doesNotMatch(text, /\d{12,}/, 'no card number in the template');
  assert.doesNotMatch(text, /PIN:\s*\d/, 'no PIN in the template');
  assert.doesNotMatch(text, /im Wert von \d/, 'no amount in the template');
});
