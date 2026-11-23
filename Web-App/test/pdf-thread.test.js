/**
 * The parts list is drawn in its own thread: the PDF arises,
 * and the event loop of the process stays free meanwhile. pdfkit draws
 * synchronously; in the primary worker, which also answers requests, every
 * request otherwise stood still while a long list was being drawn.
 *
 * Counter-check (measured on 29.10.2026): drawPdfInThread() calls buildPdf()
 * directly → red: “the event loop stays free” (longest pause
 * several hundred milliseconds instead of below 150).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { drawPdfInThread } = _req('src/catalog/pdf/pdfDrawing.js');

test('the event loop stays free while the PDF is being created', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-faden-'));
  const ziel = path.join(dir, 'liste.pdf');
  // One color: pdfkit draws the whole group without interruption.
  const parts = Array.from({ length: 6000 }, (_, i) => ({
    part_number: `p${i}`,
    part_name: `Teil ${i}`,
    color_id: 1,
    color_name: 'Rot',
    color_hex: 'C91A09',
    quantity: 1 + (i % 3),
  }));
  let letzte = Date.now(),
    longest = 0;
  const clock = setInterval(() => {
    const j = Date.now();
    longest = Math.max(longest, j - letzte);
    letzte = j;
  }, 5);
  try {
    await drawPdfInThread([{ set_number: '1-1' }], parts, ziel);
  } finally {
    clearInterval(clock);
  }
  try {
    assert.equal(fs.readFileSync(ziel).subarray(0, 5).toString(), '%PDF-');
    assert.ok(longest < 150, `longest pause of the event loop: ${longest} ms`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
