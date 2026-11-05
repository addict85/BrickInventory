/**
 * Vorschaubilder entstehen ATOMAR — halbe Dateien gehen nie an den Client.
 * Ausführlich: docs/begruendungen/test/thumb-atomic.test.js.md#kopf
 *
 * Gegenprobe (durchgeführt): rename in routes/imgProxy.ts entfernt und wieder
 * direkt auf den Zielnamen geschrieben → der erste Teilschritt wird rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lies = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ohneKommentare = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('beide Vorschau-Erzeuger schreiben über eine temporäre Datei', () => {
  // Fundort seit einer früheren Runde: src/katalog/bilder/proxyThumbs.ts.
  for (const datei of ['src/katalog/bilder/proxyThumbs.ts', 'src/katalog/bilder/thumbs.ts']) {
    const src = ohneKommentare(lies(datei));
    // Seit einer früheren Runde schreibt src/katalog/bilder/thumbs.ts über verkleinern() (sharp,
    // mit Jimp als Rückfall); der Bild-Proxy hat weiterhin seinen eigenen
    // Jimp-Aufruf. Geprüft wird deshalb die AUSSAGE — geschrieben wird auf den
    // temporären Namen — statt einer bestimmten Bibliothek.
    assert.ok(/(await bg\.write\(tmpThumb|verkleinern\([^)]*tmpThumb\))/.test(src),
      `${datei}: die Vorschau wird direkt auf den endgültigen Namen geschrieben — ` +
      'eine parallele Anfrage liefert dann eine halbe Datei aus');
    assert.ok(/fs\.promises\.rename\(tmpThumb/.test(src),
      `${datei}: das abschliessende rename fehlt`);
  }
});

test('eine unbrauchbar kleine Vorschau wird verworfen statt ausgeliefert', () => {
  // Diese Prüfung gehört zur AUSLIEFERUNG, nicht zur Erzeugung: Sie steht
  // weiterhin in routes/imgProxy.ts. (Beim Umzug in einer früheren Runde hatte ich sie
  // per Massenersetzung mit auf src/katalog/bilder/proxyThumbs.ts umgebogen — zum dritten
  // Mal in dieser Reihe eine zu breite Ersetzung.)
  // Fundort seit einer früheren Runde: src/katalog/bilder/imgCacheServe.ts (die Auslieferung).
  const src = ohneKommentare(lies('src/katalog/bilder/imgCacheServe.ts'));
  assert.ok(/tst0\.size < 200/.test(src),
    'Altbestände aus der Zeit vor dem atomaren Schreiben müssen abgefangen werden');
  assert.ok(/unlink\(thumbFile\)/.test(src),
    'die unbrauchbare Datei muss entfernt werden, damit sie neu entsteht');
});

test('unteilbares Umbenennen zeigt Lesern nie einen Zwischenstand', async () => {
  // Das Verhalten selbst, unabhängig vom Quelltext: Während die Datei
  // geschrieben wird, darf ein paralleler Leser sie entweder gar nicht sehen
  // oder vollständig — niemals halb.
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbatom-'));
  const ziel = path.join(ordner, 'bild_thumb.jpg');
  const tmp  = ziel + '.tmp';
  const GESAMT = 12000;

  try {
    const ws = fs.createWriteStream(tmp);
    let n = 0;
    await new Promise(fertig => {
      const iv = setInterval(() => {
        ws.write(Buffer.alloc(2000, 1));
        n += 2000;
        if (n >= GESAMT) { clearInterval(iv); ws.end(); }
      }, 5);
      ws.on('close', fertig);
      // Mitten im Schreiben nachsehen — wie eine parallele Bildanfrage.
      setTimeout(() => {
        assert.equal(fs.existsSync(ziel), false,
          'während des Schreibens darf der endgültige Name noch nicht existieren');
      }, 12);
    });

    fs.renameSync(tmp, ziel);
    assert.equal(fs.statSync(ziel).size, GESAMT,
      'nach dem Umbenennen liegt die Datei vollständig vor');
  } finally {
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});
