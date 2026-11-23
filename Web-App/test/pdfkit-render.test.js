/**
 * pdfkit actually produces a valid PDF — with exactly the API that this
 * application uses.
 *
 * Counter-check: the JPEG replaced by the PNG in the test document → red “images are embedded — JPEG and PNG”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/** Collects the data stream of a document into a buffer. */
function render(bauen) {
  const PDFDocument = require('pdfkit');
  return new Promise((fertig, error) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const parts = [];
    doc.on('data', c => parts.push(c));
    doc.on('error', error);
    doc.on('end', () => fertig(Buffer.concat(parts)));
    try {
      bauen(doc);
      doc.end();
    } catch (e) {
      error(e);
    }
  });
}

function isValidPdf(b, wo) {
  assert.equal(b.slice(0, 5).toString(), '%PDF-', `${wo}: no PDF header`);
  assert.ok(b.slice(-1024).toString().includes('%%EOF'), `${wo}: no EOF marker`);
  assert.ok(b.length > 500, `${wo}: only ${b.length} bytes — that cannot be a document`);
}

test('the parts list export draws a valid PDF', async () => {
  // The same set of methods as in routes/api/pdf.ts.
  const b = await render(doc => {
    doc.font('Helvetica-Bold').fontSize(16).text('Teileliste');
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10);
    const lineHeight = doc.currentLineHeight();
    assert.ok(lineHeight > 0, 'currentLineHeight() no longer returns a height');
    doc.text('3001 · Brick 2x4 · Rot · 12×');
    doc.circle(120, 200, 6);
    doc.moveTo(50, 220);
    doc.addPage();
    doc.text('Seite 2');
  });
  isValidPdf(b, 'Teileliste');
});

test('images are embedded — JPEG and PNG', async () => {
  // ── Why exactly this ─────────────────────────────────────────────────────
  // jpeg-exif was pdfkit's JPEG reader. If a version jump breaks the embedding,
  // then here — and building instructions consist exclusively of
  // image pages (src/catalog/instructions.ts, buildImagePDF_fromBuffers).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfkit-'));
  const jpg = path.join(dir, 'p.jpg');
  const png = path.join(dir, 'p.png');
  fs.writeFileSync(
    jpg,
    Buffer.from(
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
        'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
        'AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
      'base64',
    ),
  );
  fs.writeFileSync(
    png,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGA' + 'hKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );

  try {
    const b = await render(doc => {
      doc.addPage({ size: [600, 800] });
      doc.image(jpg, 0, 0, { width: 600 });
      doc.addPage({ size: [600, 800] });
      doc.image(png, 0, 0, { width: 600 });
    });
    isValidPdf(b, 'Bildseiten');
    // Both image formats must end up as an XObject in the document.
    const text = b.toString('latin1');
    assert.ok(text.includes('/DCTDecode'), 'The JPEG was not embedded');
    assert.ok(text.includes('/FlateDecode'), 'The PNG was not embedded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('jpeg-exif is no longer in the dependency tree', () => {
  // The trigger of this addition. If the dependency comes back via another
  // library, that should stand out — nobody reliably reads the warning
  // in the installation log.
  const lock = require(path.join(__dirname, '..', 'package-lock.json'));
  const treffer = Object.keys(lock.packages || {}).filter(p => p.includes('jpeg-exif'));
  assert.deepEqual(
    treffer,
    [],
    'jpeg-exif is back. It is no longer maintained and last came in via ' +
      'pdfkit < 0.20 — it has been dropped there since.',
  );
});
