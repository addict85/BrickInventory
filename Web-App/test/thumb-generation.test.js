/**
 * Previews REALLY arise — and missing ones heal themselves.
 *
 * Counter-check (carried out): temporary name turned back to `.tmp` →
 * the first substep turns red (no file, previewFrom delivers null).
 * 22.11.2026: the same for createProxyPreview turns thumb-atomic.test.js red; the image route
 * creating a missing preview runs in image-route-db.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();

test('previewFrom() actually creates a smaller file', async () => {
  const { Jimp } = require(path.join(ROOT, 'node_modules', 'jimp'));
  const { DATA_DIR } = _req('src/infra/appPaths.js');
  const ordner = path.join(DATA_DIR, 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });

  const name = `zz-thumbtest-${process.pid}`;
  const original = path.join(ordner, `${name}.jpg`);
  const preview = path.join(ordner, `${name}_thumb.jpg`);
  fs.rmSync(preview, { force: true });

  // A real JPEG — Jimp must be able to read it; a buffer full of zeros does not suffice.
  const image = new Jimp({ width: 800, height: 600, color: 0xff0000ff });
  await image.write(original);

  try {
    const { previewFrom } = _req('src/images/thumbs.js');
    const web = await previewFrom(`/images/sets/${name}.jpg`);

    assert.ok(
      web,
      'previewFrom returned null — the error is swallowed in the catch, ' +
        'typically because the temporary file name carries no image extension',
    );
    assert.ok(fs.existsSync(preview), 'the preview file is missing despite a success message');
    assert.ok(
      fs.statSync(preview).size < fs.statSync(original).size,
      'the preview must be SMALLER than the original — otherwise it would be useless',
    );
    assert.ok(
      fs.readdirSync(ordner).filter(f => f.startsWith(name) && f.includes('.tmp')).length === 0,
      'no temporary file may be left behind',
    );
  } finally {
    fs.rmSync(original, { force: true });
    fs.rmSync(preview, { force: true });
  }
});
