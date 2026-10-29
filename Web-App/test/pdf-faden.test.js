/**
 * Die Teileliste wird in einem eigenen Faden gezeichnet: Das PDF entsteht,
 * und die Ereignisschleife des Prozesses bleibt dabei frei. pdfkit zeichnet
 * synchron; im Primär-Worker, der auch Anfragen beantwortet, stand sonst jede
 * Anfrage still, solange eine lange Liste gezeichnet wurde.
 *
 * Gegenprobe (am 29.10.2026 gemessen): zeichnePdfImFaden() ruft buildPdf()
 * direkt auf → rot: „die Ereignisschleife bleibt frei“ (längste Pause
 * mehrere hundert Millisekunden statt unter 150).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { zeichnePdfImFaden } = _req('jobs/pdfZeichnen.js');

test('die Ereignisschleife bleibt frei, während das PDF entsteht', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-faden-'));
  const ziel = path.join(dir, 'liste.pdf');
  // Eine Farbe: pdfkit zeichnet die ganze Gruppe ohne Unterbrechung.
  const parts = Array.from({ length: 6000 }, (_, i) => ({
    part_number: `p${i}`, part_name: `Teil ${i}`, color_id: 1, color_name: 'Rot', color_hex: 'C91A09', quantity: 1 + (i % 3),
  }));
  let letzte = Date.now(), laengste = 0;
  const takt = setInterval(() => { const j = Date.now(); laengste = Math.max(laengste, j - letzte); letzte = j; }, 5);
  try {
    await zeichnePdfImFaden([{ set_number: '1-1' }], parts, ziel);
  } finally { clearInterval(takt); }
  try {
    assert.equal(fs.readFileSync(ziel).subarray(0, 5).toString(), '%PDF-');
    assert.ok(laengste < 150, `längste Pause der Ereignisschleife: ${laengste} ms`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
