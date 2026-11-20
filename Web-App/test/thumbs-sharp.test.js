/**
 * Vorschaubilder der eigenen Bilder (vorschauErzeugenAus) entstehen mit sharp:
 * höchstens 200 je Seite, Seitenverhältnis erhalten (UX-Prüfung 25, B1).
 * Durchsichtige Bilder bleiben PNG mit Alpha (sonst im Dunkelmodus eine weisse
 * Fläche), deckende werden JPEG auf Weiss. Ohne sharp rechnet Jimp dasselbe.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln, dist neu gebaut), alle in
 * src/images/thumbs.ts:
 *   A  in verkleinern() die Prüfung `isOpaque` entfernt (immer JPEG auf Weiss)
 *      → rot: „sharp: durchsichtig …“ (jpeg statt png)
 *   B  `fit: 'inside'` → `fit: 'cover'` → rot: „sharp: durchsichtig …“ und
 *      „sharp: deckend …“ (200 × 200); fitJimp() wieder mit cover() → rot:
 *      „ohne sharp …“ (200 × 200)
 *   C  im catch um require('sharp') `throw e` statt Jimp → rot: „ohne sharp …“
 *   D  in jimpPreview() `transparent` fest false → rot: „ohne sharp …“ (jpeg)
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
const { vorschauErzeugenAus } = _req('src/images/thumbs.js');
const ordner = path.join(DATA_DIR, 'images', 'sets');

/** Ein grünes PNG 300 × 200 mit Alphakanal unter /images/sets/; `alpha` 0 = ganz durchsichtig, 1 = deckend. */
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

test('sharp: durchsichtig bleibt PNG mit Alpha, 200 × 133', async () => {
  const b = await put(`zz-sharp-${process.pid}`, 0);
  try {
    assert.equal(await vorschauErzeugenAus(b.web), b.web.replace('.png', '_thumb.jpg'));
    await checkPreview(b.vorschau, true);
  } finally {
    b.weg();
  }
});

test('sharp: deckend mit Alphakanal wird JPEG, 200 × 133', async () => {
  const b = await put(`zz-deckend-${process.pid}`, 1);
  try {
    assert.equal(await vorschauErzeugenAus(b.web), b.web.replace('.png', '_thumb.jpg'));
    await checkPreview(b.vorschau, false);
  } finally {
    b.weg();
  }
});

test('ohne sharp rechnet Jimp dieselbe Vorschau', async () => {
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
      assert.equal(await vorschauErzeugenAus(b.web), b.web.replace('.png', '_thumb.jpg'));
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

test('sharp und Jimp sind als Abhängigkeiten eingetragen', () => {
  // Ohne Eintrag fehlt sharp im Docker-Image und jede Vorschau liefe über den langsamen Rückfall.
  const pkg = require(path.join(ROOT, 'package.json'));
  assert.ok(pkg.dependencies?.sharp, 'sharp fehlt in den dependencies');
  assert.ok(pkg.dependencies?.jimp, 'jimp muss als Rückfall erhalten bleiben');
});
