/**
 * Vorschaubilder entstehen WIRKLICH — und fehlende heilen sich selbst.
 *
 * ── Woher dieser Test kommt (Nachtrag 48) ───────────────────────────────────
 * Marco meldete: „In der Setgalerie werden für neue Sets keine Thumbs
 * angezeigt, sondern immer die grossen Bilder. Bei älter erfassten Sets wird
 * das Thumb korrekt genutzt." Und auf Nachfrage: die Datei `…_thumb.jpg`
 * existiert auf dem Server gar nicht.
 *
 * Zwei Ursachen, beide von mir eingebaut bzw. übersehen:
 *
 * 1. MEIN FEHLER AUS NACHTRAG 41. Beim Umbau auf atomares Schreiben bekam die
 *    temporäre Datei den Namen `<ziel>.<pid>.<zeit>.tmp`. Jimp leitet das
 *    Zielformat aber aus der DATEIENDUNG ab: `.tmp` ergibt „Unsupported MIME
 *    type: null". Der Fehler landete im umgebenden catch und wurde zu einem
 *    stillen `return null`. Seither entstand ÜBERHAUPT KEINE Vorschau mehr —
 *    weder lokal noch im Bild-Proxy. Sichtbar wurde es nur, weil ältere Sets
 *    ihre vor 41 erzeugte Vorschau behielten. Genau diese Sorte Fehler prüft
 *    der erste Teil hier: nicht „steht der rename im Code", sondern „liegt
 *    hinterher eine Datei da, und ist sie kleiner als das Original".
 *
 * 2. Die Vorschau war ein reines ERFASSUNGS-Ereignis: erzeugt nur direkt nach
 *    dem Download. Ging dabei etwas schief, entstand sie nie mehr — der
 *    Bilder-Nachlauf deckt `sets` nicht ab und repariert ohnehin nur fehlende
 *    Dateien, keine fehlenden Vorschauen. Deshalb stösst die Bildroute die
 *    Erzeugung jetzt an, wenn sie beim Ausliefern bemerkt, dass die Vorschau
 *    fehlt und das Original vorliegt.
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
  const { DATA_DIR } = _req('utils/appPaths.js');
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
    const { generateThumb } = _req('routes/thumbs.js');
    const web = await generateThumb(`/images/sets/${name}.jpg`);

    assert.ok(web, 'generateThumb lieferte null — der Fehler wird im catch verschluckt, ' +
                   'typischerweise weil der temporäre Dateiname keine Bildendung trägt');
    assert.ok(fs.existsSync(vorschau), 'die Vorschau-Datei fehlt trotz Erfolgsmeldung');
    assert.ok(fs.statSync(vorschau).size < fs.statSync(original).size,
      'die Vorschau muss KLEINER sein als das Original — sonst wäre sie nutzlos');
    assert.ok(fs.readdirSync(ordner).filter(f => f.startsWith(name) && f.includes('.tmp')).length === 0,
      'es darf keine temporäre Datei zurückbleiben');
  } finally {
    fs.rmSync(original, { force: true });
    fs.rmSync(vorschau, { force: true });
  }
});

test('beide Erzeuger schreiben temporär auf eine BILDendung', () => {
  // Die Quelltextregel zum Verhaltenstest oben: Jimp entscheidet über die
  // Endung, deshalb muss der temporäre Name auf .jpg enden.
  // Fundort seit Nachtrag 129: utils/proxyThumbs.ts.
  for (const datei of ['routes/thumbs.ts', 'utils/proxyThumbs.ts']) {
    const src = fs.readFileSync(path.join(ROOT, datei), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.ok(/tmpThumb = .*\.tmp\.jpg`/.test(src),
      `${datei}: der temporäre Vorschau-Name endet nicht auf .jpg — Jimp wirft dann ` +
      '„Unsupported MIME type" und die Vorschau entsteht still gar nicht');
  }
});

test('die Bildroute stösst eine fehlende Vorschau selbst an', () => {
  const src = require('./helpers/sources').startQuelle()
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const start = src.indexOf("app.get('/images/*'");
  const block = src.slice(start, start + 4000);
  assert.ok(/generateThumb/.test(block),
    'ohne diesen Anstoss bleibt eine einmal verpasste Vorschau für immer aus — ' +
    'der Bilder-Nachlauf deckt sets nicht ab');
  assert.ok(/setImmediate/.test(block),
    'die Erzeugung darf die Anfrage nicht aufhalten (rund 150 ms Jimp je Kachel)');
});
