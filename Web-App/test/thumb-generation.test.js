/**
 * Previews REALLY arise — and missing ones heal themselves.
 *
 * Counter-check (carried out): temporary name turned back to `.tmp` →
 * the first substep turns red (no file, previewFrom delivers null).
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
  const vorschau = path.join(ordner, `${name}_thumb.jpg`);
  fs.rmSync(vorschau, { force: true });

  // A real JPEG — Jimp must be able to read it; a buffer full of zeros does not suffice.
  const bild = new Jimp({ width: 800, height: 600, color: 0xff0000ff });
  await bild.write(original);

  try {
    const { previewFrom } = _req('src/images/thumbs.js');
    const web = await previewFrom(`/images/sets/${name}.jpg`);

    assert.ok(
      web,
      'previewFrom lieferte null — der Fehler wird im catch verschluckt, ' +
        'typischerweise weil der temporäre Dateiname keine Bildendung trägt',
    );
    assert.ok(fs.existsSync(vorschau), 'die Vorschau-Datei fehlt trotz Erfolgsmeldung');
    assert.ok(
      fs.statSync(vorschau).size < fs.statSync(original).size,
      'die Vorschau muss KLEINER sein als das Original — sonst wäre sie nutzlos',
    );
    assert.ok(
      fs.readdirSync(ordner).filter(f => f.startsWith(name) && f.includes('.tmp')).length === 0,
      'es darf keine temporäre Datei zurückbleiben',
    );
  } finally {
    fs.rmSync(original, { force: true });
    fs.rmSync(vorschau, { force: true });
  }
});

test('both generators write temporarily to an IMAGE extension', () => {
  // The source text rule for the behavior test above: Jimp decides by the
  // extension, hence the temporary name must end in .jpg.
  // Location since an earlier round: src/images/proxyThumbs.ts.
  for (const datei of ['src/images/thumbs.ts', 'src/images/proxyThumbs.ts']) {
    const src = fs
      .readFileSync(path.join(ROOT, datei), 'utf8')
      .split('\n')
      .filter(l => !l.trim().startsWith('//'))
      .join('\n');
    assert.ok(
      /tmpThumb = .*\.tmp\.jpg`/.test(src),
      `${datei}: der temporäre Vorschau-Name endet nicht auf .jpg — Jimp wirft dann ` +
        '„Unsupported MIME type" und die Vorschau entsteht still gar nicht',
    );
  }
});

test('the image route triggers a missing preview itself', () => {
  // ohneKommentare() instead of a // filter: the filter left
  // block comments standing, and one of them contained "app.get('/images/*', …)"
  // as an example. indexOf() thereby landed in the file header instead of at the route.
  // The image route (routes/pages.ts) delivers via src/images/http/imageDelivery.ts;
  // originalInsteadOfPreview() triggers the preview there.
  const src = require('./helpers/sources').ohneKommentare(
    require('node:fs').readFileSync(path.join(__dirname, '..', 'src/images/http/imageDelivery.ts'), 'utf8'),
  );
  const start = src.indexOf('function originalInsteadOfPreview(');
  assert.ok(
    start > 0 && src.indexOf('originalInsteadOfPreview(', start + 10) > 0,
    'die Bildroute ruft den Vorschau-Rückfall nicht',
  );
  const block = src.slice(start, start + 4000);
  assert.ok(
    /previewFrom/.test(block),
    'ohne diesen Anstoss bleibt eine einmal verpasste Vorschau für immer aus — ' +
      'der Bilder-Nachlauf deckt sets nicht ab',
  );
  assert.ok(/setImmediate/.test(block), 'die Erzeugung darf die Anfrage nicht aufhalten (rund 150 ms Jimp je Kachel)');
});
