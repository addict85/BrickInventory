/**
 * pdfkit erzeugt tatsächlich ein gültiges PDF — mit genau der API, die diese
 * Anwendung benutzt.
 *
 * ── Warum es diesen Test gibt (Nachtrag 137) ────────────────────────────────
 *
 * `npm ci` warnte:
 *     npm warn deprecated jpeg-exif@1.1.4: Package no longer supported.
 *
 * jpeg-exif ist keine eigene Abhängigkeit, sondern kam über pdfkit 0.15.2. In
 * pdfkit 0.20.1 ist sie ersatzlos weg — die Behebung war also ein Versionssprung
 * über fünf Minor-Versionen.
 *
 * Ein Sprung über eine Bibliothek, die PDFs zeichnet, verlangt mehr als „npm
 * install und Tests laufen lassen": Die vorhandenen Tests prüfen die
 * AUFTRAGSVERWALTUNG (pdf-jobs-db), nicht das Zeichnen. Ein pdfkit, das seine
 * API stillschweigend ändert, wäre grün durchgelaufen und erst bei Marcos
 * erstem Export aufgefallen.
 *
 * Geprüft wird deshalb der ganze Methodensatz, den die Anwendung wirklich
 * ruft — ermittelt aus routes/api_v1/pdf.ts und utils/instructions.ts:
 *   addPage, circle, currentLineHeight, end, font, fontSize, image,
 *   moveDown, moveTo, on, text
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/** Sammelt den Datenstrom eines Dokuments zu einem Puffer. */
function rendern(bauen) {
  const PDFDocument = require('pdfkit');
  return new Promise((fertig, fehler) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const teile = [];
    doc.on('data', c => teile.push(c));
    doc.on('error', fehler);
    doc.on('end', () => fertig(Buffer.concat(teile)));
    try { bauen(doc); doc.end(); } catch (e) { fehler(e); }
  });
}

function istGueltigesPdf(b, wo) {
  assert.equal(b.slice(0, 5).toString(), '%PDF-', `${wo}: kein PDF-Kopf`);
  assert.ok(b.slice(-1024).toString().includes('%%EOF'), `${wo}: keine EOF-Marke`);
  assert.ok(b.length > 500, `${wo}: nur ${b.length} Bytes — das kann kein Dokument sein`);
}

test('der Teilelisten-Export zeichnet ein gültiges PDF', async () => {
  // Derselbe Methodensatz wie in routes/api_v1/pdf.ts.
  const b = await rendern(doc => {
    doc.font('Helvetica-Bold').fontSize(16).text('Teileliste');
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10);
    const zeilenhoehe = doc.currentLineHeight();
    assert.ok(zeilenhoehe > 0, 'currentLineHeight() liefert keine Höhe mehr');
    doc.text('3001 · Brick 2x4 · Rot · 12×');
    doc.circle(120, 200, 6);
    doc.moveTo(50, 220);
    doc.addPage();
    doc.text('Seite 2');
  });
  istGueltigesPdf(b, 'Teileliste');
});

test('Bilder werden eingebettet — JPEG und PNG', async () => {
  // ── Warum gerade das ─────────────────────────────────────────────────────
  // jpeg-exif war pdfkits JPEG-Leser. Wenn ein Versionssprung das Einbetten
  // bricht, dann hier — und Bauanleitungen bestehen ausschliesslich aus
  // Bildseiten (utils/instructions.ts, buildImagePDF_fromBuffers).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfkit-'));
  const jpg = path.join(dir, 'p.jpg');
  const png = path.join(dir, 'p.png');
  fs.writeFileSync(jpg, Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
    'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
    'AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64'));
  fs.writeFileSync(png, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGA' +
    'hKmMIQAAAABJRU5ErkJggg==', 'base64'));

  try {
    const b = await rendern(doc => {
      doc.addPage({ size: [600, 800] });
      doc.image(jpg, 0, 0, { width: 600 });
      doc.addPage({ size: [600, 800] });
      doc.image(png, 0, 0, { width: 600 });
    });
    istGueltigesPdf(b, 'Bildseiten');
    // Beide Bildformate müssen als XObject im Dokument landen.
    const text = b.toString('latin1');
    assert.ok(text.includes('/DCTDecode'), 'Das JPEG wurde nicht eingebettet');
    assert.ok(text.includes('/FlateDecode'), 'Das PNG wurde nicht eingebettet');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('jpeg-exif ist nicht mehr im Abhängigkeitsbaum', () => {
  // Der Auslöser dieses Nachtrags. Wandert die Abhängigkeit über eine andere
  // Bibliothek zurück, soll das auffallen — die Warnung im Installationslog
  // liest niemand zuverlässig.
  const lock = require(path.join(__dirname, '..', 'package-lock.json'));
  const treffer = Object.keys(lock.packages || {}).filter(p => p.includes('jpeg-exif'));
  assert.deepEqual(treffer, [],
    'jpeg-exif ist zurück. Es wird nicht mehr gepflegt und kam zuletzt über ' +
    'pdfkit < 0.20 herein — dort ist es seither entfallen.');
});
