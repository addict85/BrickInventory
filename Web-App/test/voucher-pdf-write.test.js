/**
 * Replace the amount in the original PDF, join vouchers, read them back in.
 *
 * ── Counter-checks (carried out, findings MEASURED) ────────────────────────────
 *
 *   a) font barrier removed            → 6 red
 *   b) post-check removed              → 9 red
 *   c) marker on ALL pages             → nothing red
 *   d) page-wise splitting removed     → 7 red
 *   e) duplicate check removed         → 8 red
 *
 * Three of them say something about this test, and all three against me:
 *
 * (b) turned nothing red at all on the FIRST attempt — the post-check, the heart
 * of the whole thing, was unchecked. Thereupon came case 9: if the amount stands as a
 * subsequence in the 19-digit CARD NUMBER, a replacement via the
 * stream hits the number too. That is not contrived but obvious, and it
 * is the worse error — a wrong card number makes the voucher
 * unusable, and it would stand nowhere. Since case 9 (b) is red.
 *
 * (c) turned nothing red, and it stays that way: that a duplicate becomes ONE
 * entry is guaranteed by the duplicate check, not by restricting the
 * marker to the first page. The comment in the module claimed the opposite
 * and has been corrected.
 *
 * (d) only turned 7 red, not 8 — case 8 stays green because reading the
 * whole stack happens to also result in ONE entry. Case 8 proves the
 * duplicate check (see e), not the splitting. Case 7 does that.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFKit = require('pdfkit');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { valuesFromPdf } = _req('src/vouchers/pdfParsing.js');
const { replaceAmount, combineVouchers, readPageByPage, markText, readMark } = _req('src/vouchers/pdfExport.js');
const PL = require('@cantoo/pdf-lib');

/** An embedded font — this creates an Identity-H subset. */
const TTF = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

/** A voucher PDF as LEGO writes it: the sentence, the number, the PIN. */
function buildVoucher(amountText, number, pin, schrift) {
  return new Promise(fertig => {
    const d = new PDFKit({ size: 'A4' });
    const stuecke = [];
    d.on('data', c => stuecke.push(c));
    d.on('end', () => fertig(Buffer.concat(stuecke)));
    if (schrift) d.font(schrift);
    d.fontSize(14).text(`Ihre LEGO-Geschenkkarte im Wert von ${amountText} CHF:`, 60, 100);
    d.fontSize(12).text(number, 60, 140).text(`PIN: ${pin}`, 60, 170);
    d.end();
  });
}

/**
 * A PDF by hand in which the amount is READABLE but the font carries its own
 * encoding. Only this way can the font barrier be checked — pdfkit does not build
 * anything like that.
 */
async function buildWithEncoding(uncertain) {
  const doc = await PL.PDFDocument.create();
  const seite = doc.addPage([595, 842]);
  const ctx = doc.context;
  const amountFont = ctx.obj({
    Type: 'Font',
    Subtype: 'TrueType',
    BaseFont: 'Sonderbar',
    FirstChar: 32,
    LastChar: 255,
    ...(uncertain
      ? {
          Encoding: ctx.obj({
            Type: 'Encoding',
            Differences: ctx.obj([48, PL.PDFName.of('five'), PL.PDFName.of('six')]),
          }),
        }
      : { Encoding: 'WinAnsiEncoding' }),
  });
  const safeFont = ctx.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: 'WinAnsiEncoding',
  });
  seite.node.set(
    PL.PDFName.of('Resources'),
    ctx.obj({
      Font: ctx.obj({ F9: ctx.register(amountFont), F1: ctx.register(safeFont) }),
    }),
  );
  const inhalt =
    'BT /F9 14 Tf 60 740 Td (Ihre LEGO-Geschenkkarte im Wert von 400 CHF:) Tj ET\n' +
    'BT /F1 12 Tf 60 700 Td (5045076374450011166) Tj ET\n' +
    'BT /F1 12 Tf 60 680 Td (PIN: 5225) Tj ET\n';
  const stream = PL.PDFRawStream.of(ctx.obj({ Length: inhalt.length }), Buffer.from(inhalt, 'latin1'));
  seite.node.set(PL.PDFName.of('Contents'), ctx.register(stream));
  return Buffer.from(await doc.save());
}

const NR = '5045076374450011166';

test('1. the amount is replaced in the original — three notations', async () => {
  // Three notations, because the PDF holds the NOTATION and not the number:
  // „400", „1'250" (Swiss thousands separator), „49.90" (cents). A
  // replacement that only knows the whole number would never find the other two.
  for (const [geschrieben, neu] of [
    ['400', 250],
    ["1'250", 300],
    ['49.90', 12.5],
  ]) {
    const original = await buildVoucher(geschrieben, NR, '5225', null);
    const vorher = valuesFromPdf(original);
    const r = await replaceAmount(original, neu);
    assert.ok(r.data, `„${geschrieben}" → ${neu} wurde abgelehnt: ${r.reason}`);
    const nachher = valuesFromPdf(r.data);
    assert.equal(nachher.amount, neu, `Aus „${geschrieben}" wurde ${nachher.amount} statt ${neu}`);
    assert.equal(nachher.number, vorher.number, 'Die Kartennummer hat sich verändert');
    assert.equal(nachher.pin, vorher.pin, 'Die PIN hat sich verändert');
  }
});

test('2. an already correct amount stays untouched', async () => {
  // No hit is SUCCESS here, not failure: the original is already
  // right. Without this case a replacement that rewrites every PDF would be „right",
  // even if there is nothing to change.
  const original = await buildVoucher('400', NR, '5225', null);
  const r = await replaceAmount(original, 400);
  assert.ok(r.data, `Abgelehnt, obwohl nichts zu tun war: ${r.reason}`);
  assert.equal(r.hits, 0, `${r.hits} Operatoren geändert, erwartet 0`);
  assert.equal(r.data, original, 'Es kam ein neues PDF zurück statt des Originals');
});

test('3. a PDF without a readable amount is rejected, not guessed', async () => {
  const original = await buildVoucher('400', NR, '5225', TTF); // Identity-H
  assert.equal(
    valuesFromPdf(original).amount,
    null,
    'Vorbedingung: der Leser findet in einer eingebetteten Schrift keinen Betrag',
  );
  const r = await replaceAmount(original, 250);
  assert.equal(r.data, null, 'Es wurde etwas ersetzt, obwohl kein Betrag zu finden war');
  assert.match(
    String(r.reason),
    /No amount/,
    `Der Grund lautet „${r.reason}" — er soll sagen, dass nichts zu finden war`,
  );
});

test('4. writing and reading the marker is reversible', () => {
  const w = { number: NR, pin: '5225', betrag: 249.5, currency: 'CHF' };
  const parsed = readMark(markText(w));
  assert.deepEqual(parsed, { number: NR, pin: '5225', amount: 249.5, currency: 'CHF' });
  // A line that is no marker must not produce one — otherwise the
  // import would find a voucher in every text.
  assert.equal(readMark('Ihre LEGO-Geschenkkarte im Wert von 400 CHF:'), null);
  // Without a PIN: null and not the empty string (the column is nullable,
  // and „" would be a different statement than „keine").
  assert.equal(readMark(markText({ ...w, pin: null })).pin, null);
});

test('5. three vouchers become ONE PDF and all come back', async () => {
  // The core of Marco's specification, and three situations in one run:
  //   · with original, amount differing   → is replaced
  //   · with original, font unreadable    → stays unchanged, the marker carries the value
  //   · without original (captured by hand) → page is generated
  const g = [
    { id: 1, number: NR, pin: '5225', amount: 250, currency: 'CHF', pdf: await buildVoucher('400', NR, '5225', null) },
    {
      id: 2,
      number: '5045076374450022277',
      pin: '1234',
      amount: 150,
      currency: 'CHF',
      pdf: await buildVoucher('150', '5045076374450022277', '1234', TTF),
    },
    { id: 3, number: '5045076374450033388', pin: null, amount: 42.5, currency: 'CHF', pdf: null },
  ];
  const { pdf, results } = await combineVouchers(g);

  assert.equal((await PL.PDFDocument.load(pdf)).getPageCount(), 3, 'Es sind nicht drei Seiten geworden');
  assert.deepEqual(
    results.map(b => b.kind),
    ['ersetzt', 'unveraendert', 'erzeugt'],
    `Die Befunde lauten ${JSON.stringify(results.map(b => b.kind))}`,
  );
  assert.ok(results[1].reason, 'Zum unveränderten Gutschein steht kein Grund dabei');

  // ── The round trip ───────────────────────────────────────────────────────
  const zurueck = await readPageByPage(pdf);
  assert.equal(zurueck.length, 3, `${zurueck.length} Gutscheine gelesen statt 3`);
  for (const x of g) {
    const w = zurueck.find(z => z.number === x.number);
    assert.ok(w, `${x.number} kam nicht zurück`);
    // The APP amount, not the printed one. For voucher 2 the
    // replacement FAILED — and still 150 comes back, because the marker
    // carries it. That is exactly what it is there for.
    assert.equal(
      w.amount,
      x.amount,
      `${x.number}: ${w.amount} statt ${x.amount} — der Import muss den Stand der App lesen`,
    );
    assert.equal(w.pin, x.pin, `${x.number}: PIN ${w.pin} statt ${x.pin}`);
  }
});

test('6. a font with its own encoding is NOT touched', async () => {
  // The most important case. Both PDFs are identical except for the encoding
  // of the amount font, and in BOTH the reader reads 400.
  const sicher = await buildWithEncoding(false);
  const uncertain = await buildWithEncoding(true);
  assert.equal(valuesFromPdf(sicher).amount, 400, 'Vorbedingung: WinAnsi ist lesbar');
  assert.equal(
    valuesFromPdf(uncertain).amount,
    400,
    'Vorbedingung: auch mit eigener Kodierung liest der Leser den Betrag — ' +
      'genau deshalb reicht eine Nachprüfung über den Text NICHT',
  );

  const a = await replaceAmount(sicher, 250);
  assert.ok(a.data, `WinAnsi wurde abgelehnt: ${a.reason}`);
  assert.equal(valuesFromPdf(a.data).amount, 250);

  const b = await replaceAmount(uncertain, 250);
  assert.equal(
    b.data,
    null,
    'Eine Schrift mit eigener Kodierung wurde ersetzt. Die Zeichenkette LIEST sich ' +
      'dann als 250 und DRUCKT sich als Zeichensalat — und keine Nachprüfung über den ' +
      'Text würde das melden.',
  );
  assert.ok(b.rejected >= 1, `abgelehnt=${b.rejected}, erwartet mindestens 1`);
  assert.match(String(b.reason), /own encoding/, `Der Grund lautet „${b.reason}"`);
});

test('7. a foreign PDF without a marker is guessed page by page', async () => {
  // The fallback. A stack as LEGO sends it has no marker. It MUST be
  // split: if one reads the whole stack as one text, the longest
  // digit sequence of the whole heap wins, and ONE voucher would come out
  // instead of two.
  const ziel = await PL.PDFDocument.create();
  for (const [betrag, nr, pin] of [
    ['400', NR, '5225'],
    ['150', '5045076374450022277', '1234'],
  ]) {
    const doc = await PL.PDFDocument.load(await buildVoucher(betrag, nr, pin, null));
    for (const s of await ziel.copyPages(doc, doc.getPageIndices())) ziel.addPage(s);
  }
  const stapel = Buffer.from(await ziel.save());
  assert.equal((await PL.PDFDocument.load(stapel)).getPageCount(), 2);

  const zurueck = await readPageByPage(stapel);
  assert.equal(zurueck.length, 2, `${zurueck.length} Gutscheine aus zwei Seiten — ohne Zerlegen wäre es einer`);
  assert.deepEqual(zurueck.map(w => w.number).sort(), [NR, '5045076374450022277'].sort());
  assert.deepEqual(
    zurueck.map(w => w.amount).sort((a, b) => a - b),
    [150, 400],
  );
});

test('8. the same card twice in the batch yields ONE entry', async () => {
  const ziel = await PL.PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const doc = await PL.PDFDocument.load(await buildVoucher('400', NR, '5225', null));
    for (const s of await ziel.copyPages(doc, doc.getPageIndices())) ziel.addPage(s);
  }
  const zurueck = await readPageByPage(Buffer.from(await ziel.save()));
  assert.equal(
    zurueck.length,
    1,
    `${zurueck.length} Einträge für dieselbe Karte — ein Stapel mit einer Dublette ` +
      'soll keinen zweiten Eintrag ergeben',
  );
});

test('9. the verification catches a replacement that hits the card number', async () => {
  // Where this case comes from (counter-check)
  const numberWith400 = '5045076374400011166';
  const original = await buildVoucher('400', numberWith400, '5225', null);
  const vorher = valuesFromPdf(original);
  assert.equal(vorher.number, numberWith400, 'Vorbedingung: die Nummer wird gelesen');
  assert.ok(numberWith400.includes('400'), 'Vorbedingung: der Betrag steht als Teilfolge in der Nummer');

  const r = await replaceAmount(original, 250);
  if (r.data) {
    // Replacing IS allowed — but then the number must be intact. Both
    // together is the statement, not „it was rejected".
    const nachher = valuesFromPdf(r.data);
    assert.equal(
      nachher.number,
      vorher.number,
      `Die Kartennummer wurde zu ${nachher.number} verändert, und das PDF kam ` +
        'trotzdem zurück. Die Nachprüfung hat nicht gegriffen.',
    );
    assert.equal(nachher.amount, 250);
  } else {
    assert.match(
      String(r.reason),
      /Number|PIN|amount/i,
      `Abgelehnt mit „${r.reason}" — der Grund soll sagen, was nicht stimmte`,
    );
  }
});
