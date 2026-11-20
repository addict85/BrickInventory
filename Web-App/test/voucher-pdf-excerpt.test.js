/**
 * Die drei Werte eines Gutscheins aus seinem PDF lesen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { valuesFromPdf, valuesFromText, parseNumber, pdfText } = _req('src/vouchers/pdfParsing.js');
// `require('pdfkit')` und NICHT ueber den Verzeichnispfad: pdfkit 0.20 hat
// kein `main` mehr, nur noch `exports` — ein Pfad auf das Verzeichnis umgeht
// die Aufloesung und scheitert. Der Baum macht es an seinen beiden eigenen
// Stellen (routes/api_v1/pdf.ts, src/catalog/instructions.ts) genauso.
const PDFDocument = require('pdfkit');

/** Ein PDF mit den uebergebenen Zeilen bauen — je Zeile ein Textoperator. */
function pdfWith(zeilen) {
  return new Promise(fertig => {
    const doc = new PDFDocument({ compress: true });
    const stuecke = [];
    doc.on('data', s => stuecke.push(s));
    doc.on('end', () => fertig(Buffer.concat(stuecke)));
    doc.fontSize(12);
    for (const z of zeilen) doc.text(z);
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
    assert.equal(w.number, '5045076374450019999', 'die Kartennummer');
    assert.equal(w.pin, '4711', 'der PIN');
    assert.equal(w.amount, 250, 'der Betrag');
    assert.equal(w.currency, 'CHF', 'die Waehrung');
  });

  await t.test('short numbers do not become the card number', async () => {
    // Diese Zusicherung gibt es wegen einer GEGENPROBE
    //
    // Der Test darueber sollte die Laengengrenze (>= 13 Stellen) absichern.
    // Die Gegenprobe zeigte, dass er das nicht tat: Die Grenze von 13 auf 3
    // herunterzusetzen liess ihn gruen — er bestand allein wegen des
    // PIN-Ausschlusses, also aus einem anderen Grund als behauptet.
    const buf = await pdfWith([
      'LEGO Store, Postfach 8005 Zuerich',
      'Ausgestellt 2025, Filiale 4711',
      'Ihre LEGO-Geschenkkarte im Wert von 50 EUR:',
    ]);
    const w = valuesFromPdf(buf);
    assert.equal(w.number, null, 'Postleitzahl, Jahr oder Filialnummer sind keine Kartennummer');
  });

  await t.test('a PDF without voucher data delivers null everywhere', async () => {
    // Der wichtigste Fall: ehrlich scheitern. Ein falsch ausgelesener
    // Gutschein ist schlimmer als ein nicht ausgelesener, weil niemand ihn
    // nachprueft — die Oberflaeche faellt dann auf die manuelle Eingabe
    // zurueck.
    const buf = await pdfWith(['Rechnung Nr. 12', 'Vielen Dank fuer Ihren Einkauf.']);
    const w = valuesFromPdf(buf);
    assert.deepEqual(w, { number: null, pin: null, amount: null, currency: null });
  });

  await t.test('something that is not a PDF at all does not throw', async () => {
    // Der Upload-Filter laesst nur application/pdf durch, aber ein MIME-Typ
    // ist eine Behauptung des Klienten, keine Tatsache.
    const w = valuesFromPdf(Buffer.from('das ist kein PDF, sondern Text'));
    assert.equal(w.number, null);
  });
});

test('voucher PDF: numbers in all three notations', async t => {
  // Dieselbe Summe, drei Laender. Ohne diese Zuordnung wuerde aus 1'234.50
  // je nach Schreibweise 123450 oder 1.234 — beides stillschweigend falsch.
  await t.test('Switzerland, Germany, USA yield the same number', () => {
    assert.equal(parseNumber("1'234.50"), 1234.5, 'Schweiz');
    assert.equal(parseNumber('1.234,50'), 1234.5, 'Deutschland');
    assert.equal(parseNumber('1,234.50'), 1234.5, 'USA');
  });

  await t.test('a single separator with three digits is thousands', () => {
    // 1.234 ist mehrdeutig. Entschieden wird fuer 1234, weil es Gutscheine
    // ueber 1234 CHF gibt und keine ueber 1,234 CHF.
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
    // Die Reihenfolge der Muster ist der Schutz. Stuende hier nur „irgendeine
    // Zahl neben einem Waehrungscode", gewaenne der erste Treffer im Text —
    // und das Kleingedruckte steht nun einmal auch im PDF.
    const text = [
      'Mindestbestellwert 20 EUR gemaess AGB.',
      'Ihre LEGO-Geschenkkarte im Wert von 400 CHF:',
      '5045076374450011166',
    ].join('\n');
    const w = valuesFromText(text);
    assert.equal(w.amount, 400, 'der benannte Betrag, nicht der erste im Text');
    assert.equal(w.currency, 'CHF');
  });

  await t.test('currency before the amount is also read', () => {
    const w = valuesFromText('Geschenkkarte CHF 120\n5045076374450012222');
    assert.equal(w.amount, 120);
    assert.equal(w.currency, 'CHF');
  });

  await t.test('a three-letter word alone is not yet a currency', () => {
    // Die Waehrungsliste ist geschlossen. Ohne das faengt dieselbe Regel
    // „PDF", „LEGO" oder „AGB" — und der Betrag haengt dann an einem Wort.
    const w = valuesFromText('Datei 400 PDF\nkeine Karte');
    assert.equal(w.amount, null);
    assert.equal(w.currency, null);
  });
});

test('voucher PDF: the text extract separates the operators', async () => {
  // Die Kartennummer steht im Beispiel ALLEIN in einem Textoperator. Wuerde
  // alles zu einem Fliesstext verklebt, grenzte sie an den Doppelpunkt davor
  // und an „PIN" dahinter.
  const buf = await pdfWith(['Erste Zeile', 'Zweite Zeile']);
  const text = pdfText(buf);
  assert.match(text, /Erste Zeile/);
  assert.match(text, /Zweite Zeile/);
  assert.ok(!/Erste ZeileZweite/.test(text), 'zwei Operatoren duerfen nicht verkleben');
});
