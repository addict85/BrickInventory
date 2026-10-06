/**
 * Die drei Werte eines Gutscheins aus seinem PDF lesen.
 *
 * ── Warum hier KEIN echter Gutschein liegt ──────────────────────────────────
 *
 * Marco hat ein echtes Gutschein-PDF beigelegt (400 CHF, Nummer
 * 5045076374450011166, PIN 5225). Der Auszug wurde daran GEMESSEN und
 * lieferte alle vier Werte richtig — am 06.10., einmalig, ausserhalb des
 * Baums.
 *
 * Diese Datei liegt trotzdem nicht bei, und das ist kein Versehen: Das
 * Repository ist OEFFENTLICH (nachgesehen: private=false). Nummer und PIN
 * sind alles, was zum Einloesen noetig ist — ein Commit haette den Gutschein
 * verschenkt, und zwar unwiderruflich, weil Git sich alles merkt.
 *
 * Der Test erzeugt deshalb sein PDF selbst, mit erfundenen Zahlen. Was er
 * damit prueft, ist die Zuordnung „welche Zahl ist was" — genau der Teil, der
 * schiefgehen kann. Dass das Verfahren an einem ECHTEN LEGO-PDF
 * funktioniert, kann nur die einmalige Messung oben sagen; ein Test kann es
 * ohne die Datei nicht, und diese Grenze wird hier benannt statt kaschiert.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { werteAusPdf, werteAusText, zahlLesen, pdfText } = _req('utils/gutscheinPdf.js');
// `require('pdfkit')` und NICHT ueber den Verzeichnispfad: pdfkit 0.20 hat
// kein `main` mehr, nur noch `exports` — ein Pfad auf das Verzeichnis umgeht
// die Aufloesung und scheitert. Der Baum macht es an seinen beiden eigenen
// Stellen (routes/api_v1/pdf.ts, utils/instructions.ts) genauso.
const PDFDocument = require('pdfkit');

/** Ein PDF mit den uebergebenen Zeilen bauen — je Zeile ein Textoperator. */
function pdfMit(zeilen) {
  return new Promise((fertig) => {
    const doc = new PDFDocument({ compress: true });
    const stuecke = [];
    doc.on('data', s => stuecke.push(s));
    doc.on('end', () => fertig(Buffer.concat(stuecke)));
    doc.fontSize(12);
    for (const z of zeilen) doc.text(z);
    doc.end();
  });
}

test('Gutschein-PDF: die drei Werte landen an der richtigen Stelle', async (t) => {

  await t.test('ein Gutschein in der Form von Marcos Beispiel', async () => {
    const buf = await pdfMit([
      'Bauen und spielen!',
      'Ihre LEGO-Geschenkkarte im Wert von 250 CHF:',
      '5045076374450019999',
      'PIN: 4711',
      'Um Ihr Geschenk einzuloesen, gehen Sie zu shop.LEGO.com',
    ]);
    const w = werteAusPdf(buf);
    assert.equal(w.nummer, '5045076374450019999', 'die Kartennummer');
    assert.equal(w.pin, '4711', 'der PIN');
    assert.equal(w.betrag, 250, 'der Betrag');
    assert.equal(w.waehrung, 'CHF', 'die Waehrung');
  });

  await t.test('kurze Zahlen werden nicht zur Kartennummer', async () => {
    // ── Diese Zusicherung gibt es wegen einer GEGENPROBE ──────────────────
    //
    // Der Test darueber sollte die Laengengrenze (>= 13 Stellen) absichern.
    // Die Gegenprobe zeigte, dass er das nicht tat: Die Grenze von 13 auf 3
    // herunterzusetzen liess ihn gruen — er bestand allein wegen des
    // PIN-Ausschlusses, also aus einem anderen Grund als behauptet.
    //
    // Hier stehen deshalb Zahlen, die KEIN PIN sind und trotzdem keine
    // Kartennummer sein duerfen. Mit einer zu niedrigen Grenze wuerde eine
    // davon stillschweigend zur Nummer.
    const buf = await pdfMit([
      'LEGO Store, Postfach 8005 Zuerich',
      'Ausgestellt 2025, Filiale 4711',
      'Ihre LEGO-Geschenkkarte im Wert von 50 EUR:',
    ]);
    const w = werteAusPdf(buf);
    assert.equal(w.nummer, null, 'Postleitzahl, Jahr oder Filialnummer sind keine Kartennummer');
  });

  await t.test('ein PDF ohne Gutscheindaten liefert ueberall null', async () => {
    // Der wichtigste Fall: ehrlich scheitern. Ein falsch ausgelesener
    // Gutschein ist schlimmer als ein nicht ausgelesener, weil niemand ihn
    // nachprueft — die Oberflaeche faellt dann auf die manuelle Eingabe
    // zurueck.
    const buf = await pdfMit(['Rechnung Nr. 12', 'Vielen Dank fuer Ihren Einkauf.']);
    const w = werteAusPdf(buf);
    assert.deepEqual(w, { nummer: null, pin: null, betrag: null, waehrung: null });
  });

  await t.test('etwas, das gar kein PDF ist, wirft nicht', async () => {
    // Der Upload-Filter laesst nur application/pdf durch, aber ein MIME-Typ
    // ist eine Behauptung des Klienten, keine Tatsache.
    const w = werteAusPdf(Buffer.from('das ist kein PDF, sondern Text'));
    assert.equal(w.nummer, null);
  });
});

test('Gutschein-PDF: Zahlen in allen drei Schreibweisen', async (t) => {
  // Dieselbe Summe, drei Laender. Ohne diese Zuordnung wuerde aus 1'234.50
  // je nach Schreibweise 123450 oder 1.234 — beides stillschweigend falsch.
  await t.test('Schweiz, Deutschland, USA ergeben dieselbe Zahl', () => {
    assert.equal(zahlLesen("1'234.50"), 1234.5, 'Schweiz');
    assert.equal(zahlLesen('1.234,50'), 1234.5, 'Deutschland');
    assert.equal(zahlLesen('1,234.50'), 1234.5, 'USA');
  });

  await t.test('ein einzelner Trenner mit drei Ziffern ist Tausender', () => {
    // 1.234 ist mehrdeutig. Entschieden wird fuer 1234, weil es Gutscheine
    // ueber 1234 CHF gibt und keine ueber 1,234 CHF.
    assert.equal(zahlLesen('1.234'), 1234);
    assert.equal(zahlLesen('1,234'), 1234);
  });

  await t.test('ganze Betraege und Rappen', () => {
    assert.equal(zahlLesen('400'), 400);
    assert.equal(zahlLesen('99,90'), 99.9);
    assert.equal(zahlLesen('99.90'), 99.9);
  });

  await t.test('was keine Zahl ist, wird keine', () => {
    assert.equal(zahlLesen('CHF'), null);
    assert.equal(zahlLesen(''), null);
    assert.equal(zahlLesen('12-34'), null);
  });
});

test('Gutschein-PDF: der Betrag wird an der benannten Stelle gelesen', async (t) => {
  await t.test('die englische Formulierung ebenso', () => {
    const w = werteAusText('Your LEGO gift card with a value of 75 GBP:\n5045076374450011111\nPIN: 1234');
    assert.equal(w.betrag, 75);
    assert.equal(w.waehrung, 'GBP');
  });

  await t.test('„im Wert von" schlaegt eine Zahl aus dem Kleingedruckten', () => {
    // Die Reihenfolge der Muster ist der Schutz. Stuende hier nur „irgendeine
    // Zahl neben einem Waehrungscode", gewaenne der erste Treffer im Text —
    // und das Kleingedruckte steht nun einmal auch im PDF.
    const text = [
      'Mindestbestellwert 20 EUR gemaess AGB.',
      'Ihre LEGO-Geschenkkarte im Wert von 400 CHF:',
      '5045076374450011166',
    ].join('\n');
    const w = werteAusText(text);
    assert.equal(w.betrag, 400, 'der benannte Betrag, nicht der erste im Text');
    assert.equal(w.waehrung, 'CHF');
  });

  await t.test('Waehrung vor dem Betrag wird auch gelesen', () => {
    const w = werteAusText('Geschenkkarte CHF 120\n5045076374450012222');
    assert.equal(w.betrag, 120);
    assert.equal(w.waehrung, 'CHF');
  });

  await t.test('ein Dreibuchstabenwort allein ist noch keine Waehrung', () => {
    // Die Waehrungsliste ist geschlossen. Ohne das faengt dieselbe Regel
    // „PDF", „LEGO" oder „AGB" — und der Betrag haengt dann an einem Wort.
    const w = werteAusText('Datei 400 PDF\nkeine Karte');
    assert.equal(w.betrag, null);
    assert.equal(w.waehrung, null);
  });
});

test('Gutschein-PDF: der Textauszug trennt die Operatoren', async () => {
  // Die Kartennummer steht im Beispiel ALLEIN in einem Textoperator. Wuerde
  // alles zu einem Fliesstext verklebt, grenzte sie an den Doppelpunkt davor
  // und an „PIN" dahinter.
  const buf = await pdfMit(['Erste Zeile', 'Zweite Zeile']);
  const text = pdfText(buf);
  assert.match(text, /Erste Zeile/);
  assert.match(text, /Zweite Zeile/);
  assert.ok(!/Erste ZeileZweite/.test(text), 'zwei Operatoren duerfen nicht verkleben');
});
