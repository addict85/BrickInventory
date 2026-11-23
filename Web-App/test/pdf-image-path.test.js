/**
 * The parts list PDF export reads images only from the image folder.
 *
 * The client sends the parts list; `image_local` used to go unchecked into
 * readFile. With `/data/uploads/<foreign-id>/…` or `/images/../../…` an
 * arbitrary JPEG or PNG file thus ended up in the PDF.
 *
 * Counter-check (measured on 27.10.): the check `startsWith(IMAGES_DIR + sep)`
 * removed → red: “foreign uploads”, “out of the image folder”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { pdfImagePath } = _req('src/catalog/pdf/pdfDrawing.js');
const { IMAGES_DIR, DATA_DIR } = _req('src/infra/appPaths.js');

test('a part image from the image folder is read', () => {
  assert.equal(pdfImagePath({ image_local: '/images/parts/3001_4.png' }), path.join(IMAGES_DIR, 'parts', '3001_4.png'));
});

test('foreign uploads', () => {
  assert.equal(pdfImagePath({ image_local: '/data/uploads/7/anleitung.png' }), null);
  assert.equal(pdfImagePath({ image_local: '/data/instructions/x.png' }), null);
});

test('out of the image folder', () => {
  for (const route of ['/images/../uploads/7/a.png', '/images/../../package.json', '/images/parts/../../../etc/passwd'])
    assert.equal(pdfImagePath({ image_local: route }), null, route);
  assert.ok(!String(pdfImagePath({ image_local: '/images/sets/a.png' })).startsWith(path.join(DATA_DIR, 'uploads')));
});

test('foreign addresses and nonsense', () => {
  assert.equal(pdfImagePath({ image_url: 'https://cdn.example/x.png' }), null);
  assert.equal(pdfImagePath({ image_local: '/api/img-proxy?url=%E0%A4%A' }), null, 'kaputte Kodierung');
  assert.equal(pdfImagePath({}), null);
});
