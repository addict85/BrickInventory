/**
 * Read the three values of a voucher from its PDF.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { valuesFromPdf, valuesFromText, parseNumber, pdfText } = _req('src/vouchers/pdfParsing.js');
// `require('pdfkit')` and NOT via the directory path: pdfkit 0.20 has
// no `main` any more, only `exports` — a path to the directory bypasses
// the resolution and fails. The tree does the same at its own two
// places (routes/api/pdf.ts, src/catalog/instructions.ts).
const PDFDocument = require('pdfkit');

/** Build a PDF with the passed lines — one text operator per line. */
function pdfWith(lines) {
  return new Promise(done => {
    const doc = new PDFDocument({ compress: true });
    const pieces = [];
    doc.on('data', s => pieces.push(s));
    doc.on('end', () => done(Buffer.concat(pieces)));
    doc.fontSize(12);
    for (const z of lines) doc.text(z);
    doc.end();
  });
}

test('voucher PDF: the three values land in the right place', async t => {
  await t.test("a voucher in the form of Marco's example", async () => {
    const buf = await pdfWith([
      'Bauen und spielen!',
      'Ihre LEGO-Geschenkkarte im Wert von 250 CHF:',
      '5045076374450019999',
      'PIN: 4711',
      'Um Ihr Geschenk einzuloesen, gehen Sie zu shop.LEGO.com',
    ]);
    const w = valuesFromPdf(buf);
    assert.equal(w.number, '5045076374450019999', 'the card number');
    assert.equal(w.pin, '4711', 'the PIN');
    assert.equal(w.amount, 250, 'the amount');
    assert.equal(w.currency, 'CHF', 'the currency');
  });

  await t.test('short numbers do not become the card number', async () => {
    // This assertion exists because of a COUNTER-CHECK
    //
    // The test above was supposed to secure the length limit (>= 13 digits).
    // The counter-check showed that it did not: lowering the limit from 13 to 3
    // left it green — it passed solely because of the
    // PIN exclusion, i.e. for a different reason than claimed.
    const buf = await pdfWith([
      'LEGO Store, Postfach 8005 Zuerich',
      'Ausgestellt 2025, Filiale 4711',
      'Ihre LEGO-Geschenkkarte im Wert von 50 EUR:',
    ]);
    const w = valuesFromPdf(buf);
    assert.equal(w.number, null, 'postcode, year or branch number are no card number');
  });

  await t.test('a PDF without voucher data delivers null everywhere', async () => {
    // The most important case: fail honestly. A wrongly read
    // voucher is worse than one not read, because nobody checks it
    // — the UI then falls back to the manual
    // input.
    const buf = await pdfWith(['Rechnung Nr. 12', 'Vielen Dank fuer Ihren Einkauf.']);
    const w = valuesFromPdf(buf);
    assert.deepEqual(w, { number: null, pin: null, amount: null, currency: null });
  });

  await t.test('something that is not a PDF at all does not throw', async () => {
    // The upload filter only lets application/pdf through, but a MIME type
    // is a claim of the client, not a fact.
    const w = valuesFromPdf(Buffer.from('das ist kein PDF, sondern Text'));
    assert.equal(w.number, null);
  });
});

test('voucher PDF: numbers in all three notations', async t => {
  // The same sum, three countries. Without this mapping 1'234.50 would become
  // 123450 or 1.234 depending on the notation — both silently wrong.
  await t.test('Switzerland, Germany, USA yield the same number', () => {
    assert.equal(parseNumber("1'234.50"), 1234.5, 'Schweiz');
    assert.equal(parseNumber('1.234,50'), 1234.5, 'Deutschland');
    assert.equal(parseNumber('1,234.50'), 1234.5, 'USA');
  });

  await t.test('a single separator with three digits is thousands', () => {
    // 1.234 is ambiguous. The decision is for 1234, because there are vouchers
    // above 1234 CHF and none above 1,234 CHF.
    assert.equal(parseNumber('1.234'), 1234);
    assert.equal(parseNumber('1,234'), 1234);
  });

  await t.test('whole amounts and cents', () => {
    assert.equal(parseNumber('400'), 400);
    assert.equal(parseNumber('99,90'), 99.9);
    assert.equal(parseNumber('99.90'), 99.9);
  });

  await t.test('what is not a number does not become one', () => {
    assert.equal(parseNumber('CHF'), null);
    assert.equal(parseNumber(''), null);
    assert.equal(parseNumber('12-34'), null);
  });
});

test('voucher PDF: the amount is read at the named place', async t => {
  await t.test('the English wording likewise', () => {
    const w = valuesFromText('Your LEGO gift card with a value of 75 GBP:\n5045076374450011111\nPIN: 1234');
    assert.equal(w.amount, 75);
    assert.equal(w.currency, 'GBP');
  });

  await t.test('“im Wert von” beats a number from the small print', () => {
    // The order of the patterns is the protection. If only „any
    // number next to a currency code" stood here, the first hit in the text would win —
    // and the small print does happen to stand in the PDF too.
    const text = [
      'Mindestbestellwert 20 EUR gemaess AGB.',
      'Ihre LEGO-Geschenkkarte im Wert von 400 CHF:',
      '5045076374450011166',
    ].join('\n');
    const w = valuesFromText(text);
    assert.equal(w.amount, 400, 'the named amount, not the first one in the text');
    assert.equal(w.currency, 'CHF');
  });

  await t.test('currency before the amount is also read', () => {
    const w = valuesFromText('Geschenkkarte CHF 120\n5045076374450012222');
    assert.equal(w.amount, 120);
    assert.equal(w.currency, 'CHF');
  });

  await t.test('a three-letter word alone is not yet a currency', () => {
    // The currency list is closed. Without that the same rule catches
    // „PDF", „LEGO" or „AGB" — and the amount then hangs on a word.
    const w = valuesFromText('Datei 400 PDF\nkeine Karte');
    assert.equal(w.amount, null);
    assert.equal(w.currency, null);
  });
});

test('voucher PDF: the text extract separates the operators', async () => {
  // In the example the card number stands ALONE in a text operator. If
  // everything were glued into one running text, it would border on the colon before it
  // and on „PIN" behind it.
  const buf = await pdfWith(['Erste Zeile', 'Zweite Zeile']);
  const text = pdfText(buf);
  assert.match(text, /Erste Zeile/);
  assert.match(text, /Zweite Zeile/);
  assert.ok(!/Erste ZeileZweite/.test(text), 'two operators must not stick together');
});
