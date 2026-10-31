/**
 * Den Betrag im Original-PDF ersetzen, Gutscheine verbinden, zurueckeinlesen.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „Gutscheine sollen exportiert werden können inkl. Guthaben. Bitte den Text
 *    im Gutschein mit dem in der App hinterlegten Betrag ersetzen. Wenn alle
 *    Gutscheine exportiert werden sollen, ein PDF erstellen mit allen
 *    Gutscheinen. Das PDF soll auch wieder importiert werden können (mehrere
 *    Seiten in einem PDF ergeben mehrere Gutschein-Einträge)."
 *
 * Ich hatte abgeraten (ein neu erzeugtes PDF ist beherrschbarer) und die
 * Brüchigkeit genannt. Marco hat entschieden; dieser Test ist der Preis
 * dafür, dass die Entscheidung tragfähig ist.
 *
 * ── Was BELEGT wird, und was nicht ──────────────────────────────────────────
 *
 * Belegt wird alles an PDFs, die hier erzeugt werden. NICHT belegt ist Marcos
 * echtes LEGO-PDF: Es liegt nicht im Baum (und darf nicht hinein — das
 * Verzeichnis ist öffentlich, und auf der Karte stehen Nummer und PIN). Was
 * darüber bekannt ist, steht in src/gutscheine/gutscheinPdf.ts, gemessen am 06.10.
 *
 * Deshalb ist die NACHPRÜFUNG Teil der Sache und nicht Zierde: ersetzeBetrag()
 * liest sein eigenes Ergebnis zurück und gibt `null`, wenn nicht genau der
 * neue Betrag herauskommt. Ein nicht ersetzter Gutschein ist eine Auskunft;
 * ein falsch ersetzter wäre eine Falschaussage über Geld.
 *
 * ── Die Schriftschranke ─────────────────────────────────────────────────────
 *
 * Fall 6 ist der wichtigste des ganzen Tests. Eine literale ASCII-Kette LIEST
 * sich in einer Schrift mit eigener Kodierung als „250" und DRUCKT sich als
 * Zeichensalat — eine Nachprüfung über den Text fängt das NICHT. Deshalb wird
 * nur angefasst, was eine Standardkodierung trägt, und Fall 6 baut genau den
 * Fall, in dem die Schranke auslösen muss: derselbe lesbare Betrag, nur die
 * Kodierung unterscheidet sich.
 *
 * Ohne Fall 6 wäre die Schranke eine Behauptung — sie löst in keinem der
 * anderen Fälle aus (bei Identity-H findet der Leser schon gar keinen Betrag).
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
const test   = require('node:test');
const assert = require('node:assert/strict');
const PDFKit = require('pdfkit');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { werteAusPdf } = _req('src/gutscheine/gutscheinPdf.js');
const { ersetzeBetrag, verbindeGutscheine, seitenweiseLesen, markeText, markeLesen } =
  _req('src/gutscheine/gutscheinPdfSchreiben.js');
const PL = require('@cantoo/pdf-lib');

/** Eine eingebettete Schrift — damit entsteht eine Identity-H-Teilmenge. */
const TTF = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

/** Ein Gutschein-PDF, wie LEGO es schreibt: der Satz, die Nummer, die PIN. */
function baueGutschein(betragText, nummer, pin, schrift) {
  return new Promise((fertig) => {
    const d = new PDFKit({ size: 'A4' });
    const stuecke = [];
    d.on('data', (c) => stuecke.push(c));
    d.on('end', () => fertig(Buffer.concat(stuecke)));
    if (schrift) d.font(schrift);
    d.fontSize(14).text(`Ihre LEGO-Geschenkkarte im Wert von ${betragText} CHF:`, 60, 100);
    d.fontSize(12).text(nummer, 60, 140).text(`PIN: ${pin}`, 60, 170);
    d.end();
  });
}

/**
 * Ein PDF von Hand, in dem der Betrag LESBAR ist, die Schrift aber eine eigene
 * Kodierung trägt. Nur so lässt sich die Schriftschranke prüfen — pdfkit baut
 * so etwas nicht.
 */
async function baueMitKodierung(unsicher) {
  const doc = await PL.PDFDocument.create();
  const seite = doc.addPage([595, 842]);
  const ctx = doc.context;
  const betragFont = ctx.obj({
    Type: 'Font', Subtype: 'TrueType', BaseFont: 'Sonderbar',
    FirstChar: 32, LastChar: 255,
    ...(unsicher
      ? { Encoding: ctx.obj({ Type: 'Encoding',
            Differences: ctx.obj([48, PL.PDFName.of('five'), PL.PDFName.of('six')]) }) }
      : { Encoding: 'WinAnsiEncoding' }),
  });
  const sicherFont = ctx.obj({
    Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' });
  seite.node.set(PL.PDFName.of('Resources'), ctx.obj({
    Font: ctx.obj({ F9: ctx.register(betragFont), F1: ctx.register(sicherFont) }) }));
  const inhalt =
    'BT /F9 14 Tf 60 740 Td (Ihre LEGO-Geschenkkarte im Wert von 400 CHF:) Tj ET\n' +
    'BT /F1 12 Tf 60 700 Td (5045076374450011166) Tj ET\n' +
    'BT /F1 12 Tf 60 680 Td (PIN: 5225) Tj ET\n';
  const strom = PL.PDFRawStream.of(ctx.obj({ Length: inhalt.length }),
    Buffer.from(inhalt, 'latin1'));
  seite.node.set(PL.PDFName.of('Contents'), ctx.register(strom));
  return Buffer.from(await doc.save());
}

const NR = '5045076374450011166';

test('1. der Betrag wird im Original ersetzt — drei Schreibweisen', async () => {
  // Drei Schreibweisen, weil im PDF die SCHREIBWEISE steht und nicht die Zahl:
  // „400", „1'250" (Schweizer Tausendertrenner), „49.90" (Rappen). Ein
  // Ersetzen, das nur die ganze Zahl kennt, fände die beiden anderen nie.
  for (const [geschrieben, neu] of [['400', 250], ["1'250", 300], ['49.90', 12.5]]) {
    const original = await baueGutschein(geschrieben, NR, '5225', null);
    const vorher = werteAusPdf(original);
    const r = await ersetzeBetrag(original, neu);
    assert.ok(r.daten, `„${geschrieben}" → ${neu} wurde abgelehnt: ${r.grund}`);
    const nachher = werteAusPdf(r.daten);
    assert.equal(nachher.betrag, neu,
      `Aus „${geschrieben}" wurde ${nachher.betrag} statt ${neu}`);
    assert.equal(nachher.nummer, vorher.nummer, 'Die Kartennummer hat sich verändert');
    assert.equal(nachher.pin, vorher.pin, 'Die PIN hat sich verändert');
  }
});

test('2. ein schon richtiger Betrag bleibt unangetastet', async () => {
  // Kein Treffer ist hier ERFOLG, nicht Fehlschlag: Das Original stimmt
  // bereits. Ohne diesen Fall wäre ein Ersetzen „richtig", das jedes PDF
  // umschreibt, auch wenn es nichts zu ändern gibt.
  const original = await baueGutschein('400', NR, '5225', null);
  const r = await ersetzeBetrag(original, 400);
  assert.ok(r.daten, `Abgelehnt, obwohl nichts zu tun war: ${r.grund}`);
  assert.equal(r.treffer, 0, `${r.treffer} Operatoren geändert, erwartet 0`);
  assert.equal(r.daten, original, 'Es kam ein neues PDF zurück statt des Originals');
});

test('3. ein PDF ohne lesbaren Betrag wird abgelehnt, nicht geraten', async () => {
  const original = await baueGutschein('400', NR, '5225', TTF);   // Identity-H
  assert.equal(werteAusPdf(original).betrag, null,
    'Vorbedingung: der Leser findet in einer eingebetteten Schrift keinen Betrag');
  const r = await ersetzeBetrag(original, 250);
  assert.equal(r.daten, null, 'Es wurde etwas ersetzt, obwohl kein Betrag zu finden war');
  assert.match(String(r.grund), /kein Betrag/,
    `Der Grund lautet „${r.grund}" — er soll sagen, dass nichts zu finden war`);
});

test('4. Marke schreiben und lesen ist umkehrbar', () => {
  const w = { nummer: NR, pin: '5225', betrag: 249.5, waehrung: 'CHF' };
  const gelesen = markeLesen(markeText(w));
  assert.deepEqual(gelesen, { nummer: NR, pin: '5225', betrag: 249.5, waehrung: 'CHF' });
  // Eine Zeile, die keine Marke ist, darf keine ergeben — sonst fände der
  // Import in jedem Text einen Gutschein.
  assert.equal(markeLesen('Ihre LEGO-Geschenkkarte im Wert von 400 CHF:'), null);
  // Ohne PIN: null und nicht die leere Zeichenkette (die Spalte ist NULL-fähig,
  // und „" wäre eine andere Aussage als „keine").
  assert.equal(markeLesen(markeText({ ...w, pin: null })).pin, null);
});

test('5. drei Gutscheine werden EIN PDF und kommen alle zurück', async () => {
  // Der Kern von Marcos Vorgabe, und drei Lagen in einem Lauf:
  //   · mit Original, Betrag abweichend  → wird ersetzt
  //   · mit Original, Schrift unlesbar   → bleibt unverändert, Marke trägt den Wert
  //   · ohne Original (von Hand erfasst) → Seite wird erzeugt
  const g = [
    { id: 1, number: NR, pin: '5225', amount: 250, currency: 'CHF',
      pdf: await baueGutschein('400', NR, '5225', null) },
    { id: 2, number: '5045076374450022277', pin: '1234', amount: 150, currency: 'CHF',
      pdf: await baueGutschein('150', '5045076374450022277', '1234', TTF) },
    { id: 3, number: '5045076374450033388', pin: null, amount: 42.5, currency: 'CHF',
      pdf: null },
  ];
  const { daten, befunde } = await verbindeGutscheine(g);

  assert.equal((await PL.PDFDocument.load(daten)).getPageCount(), 3,
    'Es sind nicht drei Seiten geworden');
  assert.deepEqual(befunde.map(b => b.art), ['ersetzt', 'unveraendert', 'erzeugt'],
    `Die Befunde lauten ${JSON.stringify(befunde.map(b => b.art))}`);
  assert.ok(befunde[1].grund, 'Zum unveränderten Gutschein steht kein Grund dabei');

  // ── Der Rundlauf ───────────────────────────────────────────────────────
  const zurueck = await seitenweiseLesen(daten);
  assert.equal(zurueck.length, 3, `${zurueck.length} Gutscheine gelesen statt 3`);
  for (const x of g) {
    const w = zurueck.find(z => z.nummer === x.number);
    assert.ok(w, `${x.number} kam nicht zurück`);
    // Der APP-Betrag, nicht der aufgedruckte. Bei Gutschein 2 ist das
    // Ersetzen GESCHEITERT — und trotzdem kommt 150 zurück, weil die Marke
    // ihn trägt. Genau dafür ist sie da.
    assert.equal(w.betrag, x.amount,
      `${x.number}: ${w.betrag} statt ${x.amount} — der Import muss den Stand der App lesen`);
    assert.equal(w.pin, x.pin, `${x.number}: PIN ${w.pin} statt ${x.pin}`);
  }
});

test('6. eine Schrift mit eigener Kodierung wird NICHT angefasst', async () => {
  // Der wichtigste Fall. Beide PDFs sind zeichengleich bis auf die Kodierung
  // der Betragsschrift, und in BEIDEN liest der Leser 400.
  const sicher   = await baueMitKodierung(false);
  const unsicher = await baueMitKodierung(true);
  assert.equal(werteAusPdf(sicher).betrag, 400, 'Vorbedingung: WinAnsi ist lesbar');
  assert.equal(werteAusPdf(unsicher).betrag, 400,
    'Vorbedingung: auch mit eigener Kodierung liest der Leser den Betrag — ' +
    'genau deshalb reicht eine Nachprüfung über den Text NICHT');

  const a = await ersetzeBetrag(sicher, 250);
  assert.ok(a.daten, `WinAnsi wurde abgelehnt: ${a.grund}`);
  assert.equal(werteAusPdf(a.daten).betrag, 250);

  const b = await ersetzeBetrag(unsicher, 250);
  assert.equal(b.daten, null,
    'Eine Schrift mit eigener Kodierung wurde ersetzt. Die Zeichenkette LIEST sich ' +
    'dann als 250 und DRUCKT sich als Zeichensalat — und keine Nachprüfung über den ' +
    'Text würde das melden.');
  assert.ok(b.abgelehnt >= 1, `abgelehnt=${b.abgelehnt}, erwartet mindestens 1`);
  assert.match(String(b.grund), /eigene[rn]? Kodierung/,
    `Der Grund lautet „${b.grund}"`);
});

test('7. ein fremdes PDF ohne Marke wird seitenweise geraten', async () => {
  // Der Rückfall. Ein Stapel, wie LEGO ihn schickt, hat keine Marke. Zerlegt
  // werden MUSS er: Liest man den ganzen Stapel als einen Text, gewinnt die
  // längste Ziffernfolge des ganzen Haufens, und es käme EIN Gutschein heraus
  // statt zwei.
  const ziel = await PL.PDFDocument.create();
  for (const [betrag, nr, pin] of [['400', NR, '5225'],
                                   ['150', '5045076374450022277', '1234']]) {
    const doc = await PL.PDFDocument.load(await baueGutschein(betrag, nr, pin, null));
    (await ziel.copyPages(doc, doc.getPageIndices())).forEach(s => ziel.addPage(s));
  }
  const stapel = Buffer.from(await ziel.save());
  assert.equal((await PL.PDFDocument.load(stapel)).getPageCount(), 2);

  const zurueck = await seitenweiseLesen(stapel);
  assert.equal(zurueck.length, 2,
    `${zurueck.length} Gutscheine aus zwei Seiten — ohne Zerlegen wäre es einer`);
  assert.deepEqual(zurueck.map(w => w.nummer).sort(),
    [NR, '5045076374450022277'].sort());
  assert.deepEqual(zurueck.map(w => w.betrag).sort((a, b) => a - b), [150, 400]);
});

test('8. dieselbe Karte zweimal im Stapel ergibt EINEN Eintrag', async () => {
  const ziel = await PL.PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const doc = await PL.PDFDocument.load(await baueGutschein('400', NR, '5225', null));
    (await ziel.copyPages(doc, doc.getPageIndices())).forEach(s => ziel.addPage(s));
  }
  const zurueck = await seitenweiseLesen(Buffer.from(await ziel.save()));
  assert.equal(zurueck.length, 1,
    `${zurueck.length} Einträge für dieselbe Karte — ein Stapel mit einer Dublette ` +
    'soll keinen zweiten Eintrag ergeben');
});

test('9. die Nachprüfung fängt ein Ersetzen, das die Kartennummer trifft', async () => {
  // ── Woher dieser Fall kommt (Gegenprobe) ────────────────────────────────
  //
  // Die Gegenprobe „Nachprüfung entfernt" machte zunächst GAR NICHTS rot. Eine
  // Schranke ohne Fall ist keine Schranke, also musste der Fall her, für den
  // sie da ist — und er ist nicht konstruiert, sondern naheliegend:
  //
  // Die Kartennummer ist eine 19-stellige Ziffernfolge. Steht der Betrag
  // („400") AUCH darin, trifft ein Ersetzen über den ganzen Strom die Nummer
  // mit. Hier endet sie auf …400…, und aus 250 würde eine falsche Karte.
  //
  // Eine falsche Kartennummer ist schlimmer als ein nicht ersetzter Betrag:
  // Der Gutschein wäre unbrauchbar, und es stünde nirgends.
  const nummerMit400 = '5045076374400011166';
  const original = await baueGutschein('400', nummerMit400, '5225', null);
  const vorher = werteAusPdf(original);
  assert.equal(vorher.nummer, nummerMit400, 'Vorbedingung: die Nummer wird gelesen');
  assert.ok(nummerMit400.includes('400'),
    'Vorbedingung: der Betrag steht als Teilfolge in der Nummer');

  const r = await ersetzeBetrag(original, 250);
  if (r.daten) {
    // Ersetzt werden DARF — aber dann muss die Nummer heil sein. Beides
    // zusammen ist die Aussage, nicht „es wurde abgelehnt".
    const nachher = werteAusPdf(r.daten);
    assert.equal(nachher.nummer, vorher.nummer,
      `Die Kartennummer wurde zu ${nachher.nummer} verändert, und das PDF kam ` +
      'trotzdem zurück. Die Nachprüfung hat nicht gegriffen.');
    assert.equal(nachher.betrag, 250);
  } else {
    assert.match(String(r.grund), /Nummer|PIN|Betrag/,
      `Abgelehnt mit „${r.grund}" — der Grund soll sagen, was nicht stimmte`);
  }
});
