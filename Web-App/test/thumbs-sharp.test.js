/**
 * Previews of the own images (previewFrom) arise with sharp:
 * at most 200 per side, aspect ratio preserved (UX check 25, B1).
 * Transparent images stay PNG with alpha (otherwise a white surface in dark
 * mode), opaque ones become JPEG on white. Without sharp Jimp computes the same.
 *
 * Counter-checks (measured 14.11.2026, each on its own, dist rebuilt), all in
 * src/images/thumbs.ts:
 *   A  the check `isOpaque` removed in verkleinern() (always JPEG on white)
 *      → red: “sharp: transparent …” (jpeg instead of png)
 *   B  `fit: 'inside'` → `fit: 'cover'` → red: “sharp: transparent …” and
 *      “sharp: opaque …” (200 × 200); fitJimp() again with cover() → red:
 *      “without sharp …” (200 × 200)
 *   C  in the catch around require('sharp') `throw e` instead of Jimp → red: “without sharp …”
 *   D  in jimpPreview() `transparent` fixed false → red: “without sharp …” (jpeg)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = /** @type {{ _load: (anfrage: string, ...rest: unknown[]) => unknown }} */ (
  /** @type {unknown} */ (require('node:module'))
);

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const sharp = require('sharp');
const { DATA_DIR } = _req('src/infra/appPaths.js');
const { previewFrom } = _req('src/images/thumbs.js');
const ordner = path.join(DATA_DIR, 'images', 'sets');

/** A green PNG 300 × 200 with alpha channel under /images/sets/; `alpha` 0 = fully transparent, 1 = opaque. */
async function put(name, alpha) {
  fs.mkdirSync(ordner, { recursive: true });
  const datei = path.join(ordner, `${name}.png`);
  await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 10, g: 200, b: 10, alpha } } })
    .png()
    .toFile(datei);
  return {
    web: `/images/sets/${name}.png`,
    vorschau: path.join(ordner, `${name}_thumb.jpg`),
    weg: () => {
      fs.rmSync(datei, { force: true });
      fs.rmSync(path.join(ordner, `${name}_thumb.jpg`), { force: true });
    },
  };
}

async function checkPreview(datei, transparent) {
  const meta = await sharp(datei).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], [transparent ? 'png' : 'jpeg', 200, 133]);
  const { data, info } = await sharp(datei).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  if (transparent) assert.equal(data[3], 0, 'Transparenz ging verloren');
  else assert.ok(data[1] > 150 && data[3] === 255, `Grund (${[...data.subarray(0, 4)]}) ist nicht das deckende Grün`);
}

test('sharp: transparent stays PNG with alpha, 200 × 133', async () => {
  const b = await put(`zz-sharp-${process.pid}`, 0);
  try {
    assert.equal(await previewFrom(b.web), b.web.replace('.png', '_thumb.jpg'));
    await checkPreview(b.vorschau, true);
  } finally {
    b.weg();
  }
});

test('sharp: opaque with alpha channel becomes JPEG, 200 × 133', async () => {
  const b = await put(`zz-deckend-${process.pid}`, 1);
  try {
    assert.equal(await previewFrom(b.web), b.web.replace('.png', '_thumb.jpg'));
    await checkPreview(b.vorschau, false);
  } finally {
    b.weg();
  }
});

test('without sharp Jimp computes the same preview', async () => {
  for (const [alpha, transparent] of [
    [0, true],
    [1, false],
  ]) {
    const b = await put(`zz-jimp-${alpha}-${process.pid}`, alpha);
    const laden = Module._load;
    const warnings = [];
    const warn = console.warn;
    Module._load = function (/** @type {string} */ anfrage, /** @type {unknown[]} */ ...rest) {
      if (anfrage === 'sharp') throw new Error('Cannot find module sharp');
      return laden.call(this, anfrage, ...rest);
    };
    console.warn = (...a) => warnings.push(a.join(' '));
    try {
      assert.equal(await previewFrom(b.web), b.web.replace('.png', '_thumb.jpg'));
    } finally {
      Module._load = laden;
      console.warn = warn;
    }
    try {
      await checkPreview(b.vorschau, transparent);
      assert.ok(
        warnings.some(w => /sharp nicht verfügbar.*Jimp/.test(w)),
        warnings.join('\n'),
      );
    } finally {
      b.weg();
    }
  }
});

test('sharp and Jimp are registered as dependencies', () => {
  // Without an entry sharp is missing in the Docker image and every preview would run via the slow fallback.
  const pkg = require(path.join(ROOT, 'package.json'));
  assert.ok(pkg.dependencies?.sharp, 'sharp fehlt in den dependencies');
  assert.ok(pkg.dependencies?.jimp, 'jimp muss als Rückfall erhalten bleiben');
});
