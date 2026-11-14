/**
 * Vorschaubilder der eigenen Bilder (generateThumb) entstehen mit sharp:
 * 200 × 200, mittig zugeschnitten, Transparenz auf Weiss. Lässt sich sharp
 * nicht laden, rechnet Jimp dasselbe.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, dist neu gebaut), alle in
 * src/bilder/thumbs.ts:
 *   A  `.flatten({ background: '#ffffff' })` entfernt → rot: „sharp: 200 × 200 …“
 *      (Ecke schwarz)
 *   B  `fit: 'cover'` → `fit: 'inside'` → rot: ebenda (200 × 133)
 *   C  im catch um require('sharp') `throw e` statt Jimp → rot: „ohne sharp …“
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
const { generateThumb } = _req('src/bilder/thumbs.js');
const ordner = path.join(DATA_DIR, 'images', 'sets');

/** Ein halbdurchsichtiges grünes PNG 300 × 200 unter /images/sets/. */
async function lege(name) {
  fs.mkdirSync(ordner, { recursive: true });
  const datei = path.join(ordner, `${name}.png`);
  await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 10, g: 200, b: 10, alpha: 0 } } })
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

async function pruefeVorschau(datei) {
  const meta = await sharp(datei).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 200, 200]);
  const roh = await sharp(datei).raw().toBuffer();
  assert.ok(roh[0] > 200 && roh[1] > 200 && roh[2] > 200, `Grund (${roh[0]},${roh[1]},${roh[2]}) ist nicht weiss`);
}

test('sharp: 200 × 200, mittig zugeschnitten, Transparenz auf Weiss', async () => {
  const b = await lege(`zz-sharp-${process.pid}`);
  try {
    assert.equal(await generateThumb(b.web), b.web.replace('.png', '_thumb.jpg'));
    await pruefeVorschau(b.vorschau);
  } finally {
    b.weg();
  }
});

test('ohne sharp rechnet Jimp dieselbe Vorschau', async () => {
  const b = await lege(`zz-jimp-${process.pid}`);
  const laden = Module._load;
  const warnungen = [];
  const warn = console.warn;
  Module._load = function (/** @type {string} */ anfrage, /** @type {unknown[]} */ ...rest) {
    if (anfrage === 'sharp') throw new Error('Cannot find module sharp');
    return laden.call(this, anfrage, ...rest);
  };
  console.warn = (...a) => warnungen.push(a.join(' '));
  try {
    assert.equal(await generateThumb(b.web), b.web.replace('.png', '_thumb.jpg'));
  } finally {
    Module._load = laden;
    console.warn = warn;
  }
  try {
    await pruefeVorschau(b.vorschau);
    assert.ok(
      warnungen.some(w => /sharp nicht verfügbar.*Jimp/.test(w)),
      warnungen.join('\n'),
    );
  } finally {
    b.weg();
  }
});

test('sharp und Jimp sind als Abhängigkeiten eingetragen', () => {
  // Ohne Eintrag fehlt sharp im Docker-Image und jede Vorschau liefe über den langsamen Rückfall.
  const pkg = require(path.join(ROOT, 'package.json'));
  assert.ok(pkg.dependencies?.sharp, 'sharp fehlt in den dependencies');
  assert.ok(pkg.dependencies?.jimp, 'jimp muss als Rückfall erhalten bleiben');
});
