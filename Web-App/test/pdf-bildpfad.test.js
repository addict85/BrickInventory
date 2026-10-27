/**
 * Der Teilelisten-PDF-Export liest Bilder nur aus dem Bildordner.
 *
 * Die Teileliste schickt der Client; `image_local` stand vorher ungeprüft in
 * readFile. Mit `/data/uploads/<fremde-id>/…` oder `/images/../../…` landete
 * so eine beliebige JPEG- oder PNG-Datei im PDF.
 *
 * Gegenprobe (am 27.10. gemessen): die Prüfung `startsWith(IMAGES_DIR + sep)`
 * entfernt → rot: „fremde Uploads", „aus dem Bildordner heraus".
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { pdfBildPfad } = _req('routes/api_v1/pdf.js');
const { IMAGES_DIR, DATA_DIR } = _req('utils/appPaths.js');

test('ein Teilebild aus dem Bildordner wird gelesen', () => {
  assert.equal(pdfBildPfad({ image_local: '/images/parts/3001_4.png' }),
    path.join(IMAGES_DIR, 'parts', '3001_4.png'));
});

test('fremde Uploads', () => {
  assert.equal(pdfBildPfad({ image_local: '/data/uploads/7/anleitung.png' }), null);
  assert.equal(pdfBildPfad({ image_local: '/data/instructions/x.png' }), null);
});

test('aus dem Bildordner heraus', () => {
  for (const weg of ['/images/../uploads/7/a.png', '/images/../../package.json',
                     '/images/parts/../../../etc/passwd'])
    assert.equal(pdfBildPfad({ image_local: weg }), null, weg);
  assert.ok(!String(pdfBildPfad({ image_local: '/images/sets/a.png' })).startsWith(path.join(DATA_DIR, 'uploads')));
});

test('fremde Adressen und Unsinn', () => {
  assert.equal(pdfBildPfad({ image_url: 'https://cdn.example/x.png' }), null);
  assert.equal(pdfBildPfad({ image_local: '/api/img-proxy?url=%E0%A4%A' }), null, 'kaputte Kodierung');
  assert.equal(pdfBildPfad({}), null);
});
