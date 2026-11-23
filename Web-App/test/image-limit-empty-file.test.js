/**
 * An empty or truncated file is not an image.
 *
 * ── Counter-checks (performed) ──────────────────────────────────────────────
 *
 *   a) the barrier removed → cases 1 and 2 red.
 *   b) a REAL small image must still pass (case 3) — otherwise the
 *      barrier would simply have rejected everything and the cases before would be
 *      meaningless.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { readableImage } = _req('src/images/imageGuard.js');

/** A file with exactly this content, in its own directory. */
function file(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bildschranke-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

test('an EMPTY file is rejected', async () => {
  const p = file('leer.jpg', Buffer.alloc(0));
  assert.equal(
    await readableImage(p),
    false,
    'A file with zero bytes got through the barrier. Behind it the ' +
      'downscaler fails with „unsupported image format“ — on every tick anew ' +
      'as long as the file stays.',
  );
});

test('a TRUNCATED file is rejected', async () => {
  // The first three bytes of a JPEG, then nothing more: exactly the picture of an
  // aborted download.
  const p = file('halb.jpg', Buffer.from([0xff, 0xd8, 0xff]));
  assert.equal(await readableImage(p), false, 'A partial JPEG got through — the decoder cannot do anything with it');
});

test('a REAL small image still goes through', async () => {
  // The core. Without this case the barrier would also be “right" if it
  // rejected EVERYTHING — and then there would be no preview images at all anymore.
  //
  // A 1×1 GIF, 35 bytes: the smallest complete image that can be written
  // down, and at 35 bytes clearly above the barrier of 10.
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  assert.equal(gif.length, 42, `The sample is ${gif.length} bytes — expected 42`);
  const p = file('eins.gif', gif);
  assert.equal(
    await readableImage(p),
    true,
    'A valid 1×1 GIF was rejected — then no ' +
      'thumbnails are created at all anymore, and the barrier is worse than the problem',
  );
});

test('a file that does not exist is rejected', async () => {
  // That was already so before (the catch below in readableImage) and stays so —
  // recorded here so that the new barrier does not hide this path.
  assert.equal(await readableImage('/gibt/es/nicht/x.jpg'), false);
});
