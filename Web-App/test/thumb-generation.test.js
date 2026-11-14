/**
 * Vorschaubilder entstehen WIRKLICH — und fehlende heilen sich selbst.
 *
 * Gegenprobe (durchgeführt): temporären Namen zurück auf `.tmp` gedreht →
 * der erste Teilschritt wird rot (keine Datei, generateThumb liefert null).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();

test('generateThumb() legt tatsächlich eine kleinere Datei an', async () => {
  const { Jimp } = require(path.join(ROOT, 'node_modules', 'jimp'));
  const { DATA_DIR } = _req('src/infra/appPaths.js');
  const ordner = path.join(DATA_DIR, 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });

  const name = `zz-thumbtest-${process.pid}`;
  const original = path.join(ordner, `${name}.jpg`);
  const vorschau = path.join(ordner, `${name}_thumb.jpg`);
  fs.rmSync(vorschau, { force: true });

  // Echtes JPEG — Jimp muss es lesen können; ein Buffer voller Nullen genügt nicht.
  const bild = new Jimp({ width: 800, height: 600, color: 0xff0000ff });
  await bild.write(original);

  try {
    const { generateThumb } = _req('src/bilder/thumbs.js');
    const web = await generateThumb(`/images/sets/${name}.jpg`);

    assert.ok(
      web,
      'generateThumb lieferte null — der Fehler wird im catch verschluckt, ' +
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

test('beide Erzeuger schreiben temporär auf eine BILDendung', () => {
  // Die Quelltextregel zum Verhaltenstest oben: Jimp entscheidet über die
  // Endung, deshalb muss der temporäre Name auf .jpg enden.
  // Fundort seit einer früheren Runde: src/bilder/proxyThumbs.ts.
  for (const datei of ['src/bilder/thumbs.ts', 'src/bilder/proxyThumbs.ts']) {
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

test('die Bildroute stösst eine fehlende Vorschau selbst an', () => {
  // ohneKommentare() statt eines //-Filters: Der Filter liess
  // Blockkommentare stehen, und einer davon enthielt "app.get('/images/*', …)"
  // als Beispiel. indexOf() landete dadurch im Dateikopf statt an der Route.
  // Die Bildroute (routes/seiten.ts) liefert über src/bilder/http/bildAuslieferung.ts;
  // die Vorschau stösst originalStattVorschau() dort an.
  const src = require('./helpers/sources').ohneKommentare(
    require('node:fs').readFileSync(path.join(__dirname, '..', 'src/bilder/http/bildAuslieferung.ts'), 'utf8'),
  );
  const start = src.indexOf('function originalStattVorschau(');
  assert.ok(
    start > 0 && src.indexOf('originalStattVorschau(', start + 10) > 0,
    'die Bildroute ruft den Vorschau-Rückfall nicht',
  );
  const block = src.slice(start, start + 4000);
  assert.ok(
    /generateThumb/.test(block),
    'ohne diesen Anstoss bleibt eine einmal verpasste Vorschau für immer aus — ' +
      'der Bilder-Nachlauf deckt sets nicht ab',
  );
  assert.ok(/setImmediate/.test(block), 'die Erzeugung darf die Anfrage nicht aufhalten (rund 150 ms Jimp je Kachel)');
});
