/**
 * Vorschaubilder entstehen mit sharp, nicht mehr mit Jimp.
 * Ausführlich: docs/begruendungen/test/thumbs-sharp.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');

test('sharp lässt sich laden und kann webp', async () => {
  // Der Grund für den Umbau. Fällt das hier aus, ist die native Bibliothek
  // nicht da — dann greift der Rückfall, und dieser Test sagt warum.
  let sharp;
  try { sharp = require('sharp'); }
  catch (e) { assert.fail(`sharp lässt sich nicht laden: ${e.message}`); }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbtest-'));
  try {
    const webp = path.join(dir, 'q.webp');
    await sharp({ create: { width: 300, height: 200, channels: 4,
                            background: { r: 10, g: 200, b: 10, alpha: 0.5 } } })
      .webp().toFile(webp);
    const ziel = path.join(dir, 'out.jpg');
    await sharp(webp).flatten({ background: '#ffffff' })
      .resize(200, 200, { fit: 'cover' }).jpeg({ quality: 80 }).toFile(ziel);

    const meta = await sharp(ziel).metadata();
    assert.equal(meta.width, 200, `Breite ${meta.width} statt 200`);
    assert.equal(meta.height, 200, `Höhe ${meta.height} statt 200`);
    assert.equal(meta.format, 'jpeg');

    // Transparenz muss auf WEISS landen, nicht auf Schwarz. Ohne das
    // `flatten()` werden transparente PNGs beim Umwandeln nach JPEG dunkel —
    // eine Eigenschaft, die die Jimp-Fassung über die weisse Unterlage
    // herstellte.
    const roh = await sharp(ziel).raw().toBuffer();
    assert.ok(roh[0] > 120 && roh[1] > 120,
      `Grund zu dunkel (${roh[0]},${roh[1]},${roh[2]}) — Transparenz wurde nicht ` +
      'auf Weiss gelegt');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('der Code nutzt sharp und behält Jimp als Rückfall', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/katalog/bilder/thumbs.ts'), 'utf8');
  const i = src.indexOf('async function verkleinern(');
  assert.ok(i > 0, 'Die gemeinsame Verkleinerungs-Funktion fehlt');
  const fn = src.slice(i, src.indexOf('\n}\n', i));

  assert.match(fn, /require\('sharp'\)/, 'sharp wird nicht benutzt');
  assert.match(fn, /fit: 'cover'/, 'Der mittige Zuschnitt fehlt');
  assert.match(fn, /flatten\(\{ background: '#ffffff' \}\)/,
    'Ohne weissen Grund werden transparente Bilder beim Umwandeln schwarz');

  // Der Rückfall muss bleiben: sharp bringt eine native Bibliothek mit. Lässt
  // sie sich auf einer Plattform nicht laden, wäre der Ausfall sonst total.
  assert.match(fn, /require\('jimp'\)/, 'Der Rückfall auf Jimp ist weg');
  // Und er darf NUR beim Ladefehler greifen, nicht bei einem defekten Bild:
  // Ein defektes Bild soll scheitern und gemerkt werden, nicht zweimal
  // gerechnet.
  assert.match(fn, /catch \(e: any\) \{[\s\S]{0,200}nutze Jimp/,
    'Der Rückfall hängt nicht am LADEN von sharp');

  // Das unteilbare Schreiben bleibt.
  const ganz = src;
  assert.match(ganz, /\.tmp\.jpg/, 'Der temporäre Name ist weg');
  assert.match(ganz, /fs\.promises\.rename\(tmpThumb, thumbFs\)/,
    'Ohne rename() sehen parallele Anfragen eine halb geschriebene Datei');
});

test('sharp ist als Abhängigkeit eingetragen', () => {
  // Ohne Eintrag fehlt die Bibliothek im Docker-Image, und jede Vorschau liefe
  // still über den langsamen Rückfall — genau das, was der Umbau abschaffen
  // soll.
  const pkg = require(path.join(ROOT, 'package.json'));
  assert.ok(pkg.dependencies?.sharp, 'sharp fehlt in den dependencies');
  assert.ok(pkg.dependencies?.jimp, 'jimp muss als Rückfall erhalten bleiben');
});
