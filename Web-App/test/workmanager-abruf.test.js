/**
 * WorkManager faehrt auf ABRUF hoch — und die beiden Haelften davon bleiben
 * zusammen.
 * Ausführlich: docs/begruendungen/test/workmanager-abruf.test.js.md#kopf
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const WURZEL   = path.join(__dirname, '..', '..', 'Android-App', 'app', 'src', 'main');
const MANIFEST = path.join(WURZEL, 'AndroidManifest.xml');
const APP      = path.join(WURZEL, 'java', 'ch', 'brickinventoryapp', 'app', 'BrickInventoryApp.kt');

test('WorkManager: Manifest-Ausbau und Configuration.Provider gehoeren zusammen', () => {
  const manifest = fs.readFileSync(MANIFEST, 'utf8');
  const app      = fs.readFileSync(APP, 'utf8');

  // Der meta-data-Eintrag muss da stehen UND auf remove gesetzt sein. Ein
  // blosses Suchen nach "WorkManagerInitializer" genuegte nicht: Der Name
  // steht auch in dem Kommentar darueber, der erklaert, warum er entfernt ist.
  const ausgebaut = /<meta-data[^>]*androidx\.work\.WorkManagerInitializer[\s\S]*?tools:node\s*=\s*"remove"\s*\/>/.test(manifest);

  // `: Application(), Configuration.Provider` — die Schnittstelle an der
  // Klasse, nicht irgendwo im Text.
  const schnittstelle = /class\s+BrickInventoryApp\s*:[^{]*\bConfiguration\.Provider\b/.test(app);
  const eigenschaft   = /override\s+val\s+workManagerConfiguration\s*:\s*Configuration/.test(app);

  assert.equal(
    ausgebaut, schnittstelle,
    ausgebaut
      ? 'Das Manifest nimmt WorkManagerInitializer heraus, aber BrickInventoryApp '
        + 'implementiert Configuration.Provider NICHT. Der erste WorkManager.getInstance() '
        + 'wirft dann „WorkManager is not initialized properly".'
      : 'BrickInventoryApp implementiert Configuration.Provider, aber das Manifest laesst '
        + 'WorkManagerInitializer stehen. Dann faehrt WorkManager weiter im ContentProvider '
        + 'hoch — vor onCreate — und die Umstellung bringt nichts.',
  );

  if (schnittstelle) {
    assert.ok(
      eigenschaft,
      'Configuration.Provider ist angegeben, aber `override val workManagerConfiguration` '
      + 'fehlt. Ohne sie ist die Schnittstelle nicht erfuellt.',
    );
  }
});

test('Der erste WorkManager-Zugriff liegt in einem runCatching', () => {
  const roh = fs.readFileSync(APP, 'utf8');

  // Kommentare raus, BEVOR Klammern gezaehlt werden. In dieser Datei stehen
  // geschweifte Klammern auch in Fliesstext; wer sie mitzaehlt, bekommt eine
  // Tiefe, die es nicht gibt.
  const app = roh
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  // `.einplanen(` und nicht `PreisalarmWorker.einplanen`: Der Aufruf steht seit
  // dem 25.09. ueber zwei Zeilen, weil er sein Ergebnis auswertet. Eine Suche
  // nach der zusammenhaengenden Zeichenkette fand ihn dadurch nicht mehr — und
  // diese Pruefung meldete, der Alarm werde beim Start gar nicht mehr …
  // Ausführlich: docs/begruendungen/test/workmanager-abruf.test.js.md#stelle
  const stelle = app.indexOf('.einplanen(');
  assert.ok(stelle > 0, 'einplanen() wird in BrickInventoryApp gar nicht mehr gerufen — '
    + 'dann plant den Alarm beim Start niemand wieder ein.');

  // Klammern zaehlen und mitschreiben, WELCHE davon ein runCatching geoeffnet
  // hat. Die erste Fassung dieser Pruefung suchte statt dessen rueckwaerts
  // nach dem letzten `runCatching` und schloss aus der Einrueckung — die
  // Gegenprobe (runCatching entfernt) blieb gruen, weil dann einfach das
  // runCatching der Token-Uebernahme eine Zeile darueber gefunden wurde.
  const stapel = [];
  let drin = false;
  for (let i = 0; i < stelle; i++) {
    if (app[i] === '{') {
      const davor = app.slice(Math.max(0, i - 40), i);
      stapel.push(/(?:runCatching|fangeAusserAbbruch)\s*$/.test(davor));
    } else if (app[i] === '}') {
      stapel.pop();
    }
  }
  drin = stapel.some(Boolean);

  assert.ok(
    drin,
    'einplanen() steht in KEINEM runCatching. Scheitert WorkManager beim Hochfahren — '
    + 'und genau das faehrt es jetzt an dieser Stelle —, reisst es den App-Start mit. '
    + 'Der ganze Zweck der Umstellung war, dass der Alarm ausfallen kann, ohne dass '
    + 'die App stirbt.',
  );

  // Die zweite Haelfte, seit dem 25.09.
  // Ausführlich: docs/begruendungen/test/workmanager-abruf.test.js.md#worker
  const worker = fs.readFileSync(path.join(__dirname, '..', '..', 'Android-App', 'core-dienste', 'src', 'main',
    'java', 'ch', 'brickinventoryapp', 'dienste', 'alarm', 'PreisalarmWorker.kt'), 'utf8');
  assert.match(worker, /fun einplanen\([^)]*\)\s*:\s*Throwable\?/,
    'einplanen() gibt keinen Fehler mehr zurueck — dann wirft es wieder, und die '
    + 'Aufrufstelle am Schalter hat kein Netz.');
});
