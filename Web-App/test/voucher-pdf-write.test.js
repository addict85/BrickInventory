/**
 * Den Betrag im Original-PDF ersetzen, Gutscheine verbinden, zurueckeinlesen.
 *
 * ── Gegenproben (durchgeführt, Befunde GEMESSEN) ────────────────────────────
 *
 *   a) Schriftschranke entfernt         → 6 rot
 *   b) Nachprüfung entfernt             → 9 rot
 *   c) Marke auf ALLE Seiten            → nichts rot
 *   d) seitenweises Zerlegen entfernt   → 7 rot
 *   e) Dublettenprüfung entfernt        → 8 rot
 *
 * Drei davon sagen etwas über diesen Test, und alle drei gegen mich:
 *
 * (b) machte im ERSTEN Versuch gar nichts rot — die Nachprüfung, das Herzstück
 * der ganzen Sache, war ungeprüft. Daraufhin kam Fall 9: Steht der Betrag als
 * Teilfolge in der 19-stelligen KARTENNUMMER, trifft ein Ersetzen über den
 * Strom die Nummer mit. Das ist nicht konstruiert, sondern naheliegend, und es
 * ist der schlimmere Fehler — eine falsche Kartennummer macht den Gutschein
 * unbrauchbar, und es stünde nirgends. Seit Fall 9 ist (b) rot.
 *
 * (c) machte nichts rot, und das bleibt so: Dass aus einer Dublette EIN
 * Eintrag wird, garantiert die Dublettenprüfung, nicht die Beschränkung der
 * Marke auf die erste Seite. Der Kommentar im Modul behauptete das Gegenteil
 * und ist richtiggestellt.
 *
 * (d) machte nur 7 rot, nicht 8 — Fall 8 bleibt grün, weil das Lesen des
 * ganzen Stapels zufällig auch EINEN Eintrag ergibt. Fall 8 beweist die
 * Dublettenprüfung (siehe e), nicht das Zerlegen. Das tut Fall 7.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFKit = require('pdfkit');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { valuesFromPdf } = _req('src/vouchers/pdfParsing.js');
const { replaceAmount, combineVouchers, readPageByPage, markText, readMark } = _req('src/vouchers/pdfExport.js');
const PL = require('@cantoo/pdf-lib');

/** Eine eingebettete Schrift — damit entsteht eine Identity-H-Teilmenge. */
const TTF = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

/** Ein Gutschein-PDF, wie LEGO es schreibt: der Satz, die Nummer, die PIN. */
function buildVoucher(amountText, nummer, pin, schrift) {
  return new Promise(fertig => {
    const d = new PDFKit({ size: 'A4' });
    const stuecke = [];
    d.on('data', c => stuecke.push(c));
    d.on('end', () => fertig(Buffer.concat(stuecke)));
    if (schrift) d.font(schrift);
    d.fontSize(14).text(`Ihre LEGO-Geschenkkarte im Wert von ${amountText} CHF:`, 60, 100);
    d.fontSize(12).text(nummer, 60, 140).text(`PIN: ${pin}`, 60, 170);
    d.end();
  });
}

/**
 * Ein PDF von Hand, in dem der Betrag LESBAR ist, die Schrift aber eine eigene
 * Kodierung trägt. Nur so lässt sich die Schriftschranke prüfen — pdfkit baut
 * so etwas nicht.
 */
async function buildWithEncoding(unsicher) {
  const doc = await PL.PDFDocument.create();
  const seite = doc.addPage([595, 842]);
  const ctx = doc.context;
  const amountFont = ctx.obj({
    Type: 'Font',
    Subtype: 'TrueType',
    BaseFont: 'Sonderbar',
    FirstChar: 32,
    LastChar: 255,
    ...(unsicher
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
  const strom = PL.PDFRawStream.of(ctx.obj({ Length: inhalt.length }), Buffer.from(inhalt, 'latin1'));
  seite.node.set(PL.PDFName.of('Contents'), ctx.register(strom));
  return Buffer.from(await doc.save());
}

const NR = '5045076374450011166';

test('1. the amount is replaced in the original — three notations', async () => {
  // Drei Schreibweisen, weil im PDF die SCHREIBWEISE steht und nicht die Zahl:
  // „400", „1'250" (Schweizer Tausendertrenner), „49.90" (Rappen). Ein
  // Ersetzen, das nur die ganze Zahl kennt, fände die beiden anderen nie.
  for (const [geschrieben, neu] of [
    ['400', 250],
    ["1'250", 300],
    ['49.90', 12.5],
  ]) {
    const original = await buildVoucher(geschrieben, NR, '5225', null);
    const vorher = valuesFromPdf(original);
    const r = await replaceAmount(original, neu);
    assert.ok(r.data, `„${geschrieben}" → ${neu} wurde abgelehnt: ${r.grund}`);
    const nachher = valuesFromPdf(r.data);
    assert.equal(nachher.amount, neu, `Aus „${geschrieben}" wurde ${nachher.amount} statt ${neu}`);
    assert.equal(nachher.number, vorher.number, 'Die Kartennummer hat sich verändert');
    assert.equal(nachher.pin, vorher.pin, 'Die PIN hat sich verändert');
  }
});

test('2. an already correct amount stays untouched', async () => {
  // Kein Treffer ist hier ERFOLG, nicht Fehlschlag: Das Original stimmt
  // bereits. Ohne diesen Fall wäre ein Ersetzen „richtig", das jedes PDF
  // umschreibt, auch wenn es nichts zu ändern gibt.
  const original = await buildVoucher('400', NR, '5225', null);
  const r = await replaceAmount(original, 400);
  assert.ok(r.data, `Abgelehnt, obwohl nichts zu tun war: ${r.grund}`);
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
    String(r.grund),
    /No amount/,
    `Der Grund lautet „${r.grund}" — er soll sagen, dass nichts zu finden war`,
  );
});

test('4. writing and reading the marker is reversible', () => {
  const w = { nummer: NR, pin: '5225', betrag: 249.5, waehrung: 'CHF' };
  const gelesen = readMark(markText(w));
  assert.deepEqual(gelesen, { number: NR, pin: '5225', amount: 249.5, currency: 'CHF' });
  // Eine Zeile, die keine Marke ist, darf keine ergeben — sonst fände der
  // Import in jedem Text einen Gutschein.
  assert.equal(readMark('Ihre LEGO-Geschenkkarte im Wert von 400 CHF:'), null);
  // Ohne PIN: null und nicht die leere Zeichenkette (die Spalte ist NULL-fähig,
  // und „" wäre eine andere Aussage als „keine").
  assert.equal(readMark(markText({ ...w, pin: null })).pin, null);
});

test('5. three vouchers become ONE PDF and all come back', async () => {
  // Der Kern von Marcos Vorgabe, und drei Lagen in einem Lauf:
  //   · mit Original, Betrag abweichend  → wird ersetzt
  //   · mit Original, Schrift unlesbar   → bleibt unverändert, Marke trägt den Wert
  //   · ohne Original (von Hand erfasst) → Seite wird erzeugt
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
    results.map(b => b.art),
    ['ersetzt', 'unveraendert', 'erzeugt'],
    `Die Befunde lauten ${JSON.stringify(results.map(b => b.art))}`,
  );
  assert.ok(results[1].grund, 'Zum unveränderten Gutschein steht kein Grund dabei');

  // ── Der Rundlauf ───────────────────────────────────────────────────────
  const zurueck = await readPageByPage(pdf);
  assert.equal(zurueck.length, 3, `${zurueck.length} Gutscheine gelesen statt 3`);
  for (const x of g) {
    const w = zurueck.find(z => z.number === x.number);
    assert.ok(w, `${x.number} kam nicht zurück`);
    // Der APP-Betrag, nicht der aufgedruckte. Bei Gutschein 2 ist das
    // Ersetzen GESCHEITERT — und trotzdem kommt 150 zurück, weil die Marke
    // ihn trägt. Genau dafür ist sie da.
    assert.equal(
      w.amount,
      x.amount,
      `${x.number}: ${w.amount} statt ${x.amount} — der Import muss den Stand der App lesen`,
    );
    assert.equal(w.pin, x.pin, `${x.number}: PIN ${w.pin} statt ${x.pin}`);
  }
});

test('6. a font with its own encoding is NOT touched', async () => {
  // Der wichtigste Fall. Beide PDFs sind zeichengleich bis auf die Kodierung
  // der Betragsschrift, und in BEIDEN liest der Leser 400.
  const sicher = await buildWithEncoding(false);
  const unsicher = await buildWithEncoding(true);
  assert.equal(valuesFromPdf(sicher).amount, 400, 'Vorbedingung: WinAnsi ist lesbar');
  assert.equal(
    valuesFromPdf(unsicher).amount,
    400,
    'Vorbedingung: auch mit eigener Kodierung liest der Leser den Betrag — ' +
      'genau deshalb reicht eine Nachprüfung über den Text NICHT',
  );

  const a = await replaceAmount(sicher, 250);
  assert.ok(a.data, `WinAnsi wurde abgelehnt: ${a.grund}`);
  assert.equal(valuesFromPdf(a.data).amount, 250);

  const b = await replaceAmount(unsicher, 250);
  assert.equal(
    b.data,
    null,
    'Eine Schrift mit eigener Kodierung wurde ersetzt. Die Zeichenkette LIEST sich ' +
      'dann als 250 und DRUCKT sich als Zeichensalat — und keine Nachprüfung über den ' +
      'Text würde das melden.',
  );
  assert.ok(b.rejected >= 1, `abgelehnt=${b.rejected}, erwartet mindestens 1`);
  assert.match(String(b.grund), /own encoding/, `Der Grund lautet „${b.grund}"`);
});

test('7. a foreign PDF without a marker is guessed page by page', async () => {
  // Der Rückfall. Ein Stapel, wie LEGO ihn schickt, hat keine Marke. Zerlegt
  // werden MUSS er: Liest man den ganzen Stapel als einen Text, gewinnt die
  // längste Ziffernfolge des ganzen Haufens, und es käme EIN Gutschein heraus
  // statt zwei.
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
  // Woher dieser Fall kommt (Gegenprobe)
  const numberMit400 = '5045076374400011166';
  const original = await buildVoucher('400', numberMit400, '5225', null);
  const vorher = valuesFromPdf(original);
  assert.equal(vorher.number, numberMit400, 'Vorbedingung: die Nummer wird gelesen');
  assert.ok(numberMit400.includes('400'), 'Vorbedingung: der Betrag steht als Teilfolge in der Nummer');

  const r = await replaceAmount(original, 250);
  if (r.data) {
    // Ersetzt werden DARF — aber dann muss die Nummer heil sein. Beides
    // zusammen ist die Aussage, nicht „es wurde abgelehnt".
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
      String(r.grund),
      /Number|PIN|amount/i,
      `Abgelehnt mit „${r.grund}" — der Grund soll sagen, was nicht stimmte`,
    );
  }
});
