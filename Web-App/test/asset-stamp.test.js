/**
 * Der `?v=`-Stempel kommt aus der DATEI, nicht aus einer gesetzten Zahl.
 *
 * ── Gegenproben (durchgeführt, Ergebnisse abgeschrieben) ────────────────────
 *
 *   A  `stempleAssetsGecacht(...)` aus src/profile/indexHtml.ts entfernt
 *      → „der Renderer stempelt wirklich" rot
 *   B  im Stempel die Grösse weggelassen (nur mtime)
 *      → „eine geänderte Datei bekommt eine neue Adresse" rot — aber erst an
 *        der ZWEITEN Zusicherung (gleiche mtime, andere Grösse). Die erste
 *        bliebe grün, weil Schreiben auch die mtime ändert.
 *   C  Stempel aus `Date.now()` statt aus der Datei
 *      → „eine unveränderte Datei behält ihre Adresse" rot.
 *        Beim ersten Versuch war C GRÜN: Ohne Pause fielen beide Aufrufe in
 *        dieselbe Millisekunde. Der Fall bestand aus Zufall. Seither liegt
 *        eine Pause dazwischen — die Gegenprobe hat die Prüfung repariert,
 *        nicht umgekehrt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { stempleAssets, fileStamp } = _req('src/infra/assetStempel.js');

/** Ein Wegwerf-Verzeichnis mit einer Datei darin. */
function build(inhalt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stempel-'));
  fs.writeFileSync(path.join(dir, 'a.css'), inhalt);
  return dir;
}
const HTML = '<link rel="stylesheet" href="/a.css?v=alt">';
const stampFrom = s => (s.match(/\?v=([^"]*)/) || [])[1];

test('a changed file gets a new address', () => {
  const dir = build('.a{color:red}');
  try {
    const vorher = stampFrom(stempleAssets(HTML, dir));
    assert.ok(vorher && vorher !== 'alt', `Kein Stempel gesetzt: ${vorher}`);

    fs.writeFileSync(path.join(dir, 'a.css'), '.a{color:blue;padding:1px}');
    const nachher = stampFrom(stempleAssets(HTML, dir));
    assert.notEqual(
      nachher,
      vorher,
      'Nach dem Ändern steht dieselbe Adresse da — dann behält jeder Browser ' +
        'seine alte Kopie, bis zu sieben Tage lang. Genau das war Marcos Befund.',
    );

    // Und der Fall, der die GRÖSSE im Stempel rechtfertigt: gleiche mtime,
    // anderer Inhalt. Ohne die Grösse wäre das nicht zu unterscheiden.
    const st = fs.statSync(path.join(dir, 'a.css'));
    fs.writeFileSync(path.join(dir, 'a.css'), '.a{color:blue;padding:1px}/*x*/');
    fs.utimesSync(path.join(dir, 'a.css'), st.atime, st.mtime);
    assert.notEqual(
      stampFrom(stempleAssets(HTML, dir)),
      nachher,
      'Bei gleicher Änderungszeit, aber anderer Grösse bleibt die Adresse ' +
        'gleich — dann fehlt die Grösse im Stempel.',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unchanged file keeps its address', async () => {
  // Die Hälfte, die man vergisst: Ein Stempel, der sich IMMER ändert (etwa
  // aus der Uhrzeit), bestünde den Fall darüber und entwertete bei jedem
  // Seitenaufruf 223 KB Bündel und sechs Designs.
  //
  // Gegenprobe C, nicht das Nachdenken.
  const dir = build('.a{color:red}');
  try {
    const a = stampFrom(stempleAssets(HTML, dir));
    await new Promise(r => setTimeout(r, 20));
    const b = stampFrom(stempleAssets(HTML, dir));
    assert.equal(
      a,
      b,
      'Zwei Aufrufe liefern verschiedene Adressen, obwohl sich nichts geändert ' +
        'hat — dann lädt der Browser bei jedem Aufruf alles neu.',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing file leaves the existing value in place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stempel-leer-'));
  try {
    assert.equal(
      stempleAssets(HTML, dir),
      HTML,
      'Für eine Datei, die es nicht gibt, wurde etwas gestempelt — eine ' +
        'fehlende Datei ist ein anderes Problem und darf die Adressen der ' +
        'übrigen nicht verwackeln.',
    );
    assert.equal(fileStamp(path.join(dir, 'gibtsnicht.css')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a reference without ?v= stays untouched', () => {
  const dir = build('.a{}');
  try {
    const roh = '<link href="/a.css"><script src="/b.js"></script>';
    assert.equal(stempleAssets(roh, dir), roh, 'Ein bewusst unversionierter Verweis wurde angefasst.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the renderer really stamps', () => {
  // Eine Regel, die niemand aufruft, ist die teuerste Art, nichts zu tun —
  // und die Fälle oben blieben dabei grün, weil sie die Funktion direkt
  // aufrufen. Dieselbe Lücke wie bei sitzung-beruehrung und
  // sitzung-leerlauf, dort mit derselben Begründung geschlossen.
  const idx = fs.readFileSync(path.join(ROOT, 'src/profile/indexHtml.ts'), 'utf8');
  assert.match(
    idx,
    /return stempleAssetsGecacht\(out, PUBLIC_DIR\)/,
    'src/profile/indexHtml.ts stempelt die Assets nicht mehr — dann gilt wieder die ' +
      'Zahl aus package.json, und die steht still, wenn niemand den Bumper läuft.',
  );
  // ZULETZT, nach dem Sprachtausch: Die Sprachdatei trägt selbst ein `?v=`.
  //
  // Der Anker ist `lang !== ` und NICHT `/locales/`. Erster Versuch nahm
  // letzteres — und traf einen Kommentar weiter oben (Position 3150 statt
  // 4882), wodurch der Fall rot wurde, obwohl die Reihenfolge stimmte. Eine
  // Prüfung, die am falschen Wort hängt, misst das falsche.
  assert.ok(
    idx.indexOf('stempleAssetsGecacht(out') > idx.indexOf('lang !== '),
    'Gestempelt wird vor dem Austausch der Sprachdatei — dann hängt der ' +
      'Stempel der deutschen Datei an der englischen.',
  );
});
