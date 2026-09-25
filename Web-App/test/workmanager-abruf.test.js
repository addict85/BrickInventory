/**
 * WorkManager faehrt auf ABRUF hoch — und die beiden Haelften davon bleiben
 * zusammen.
 *
 * ── Woher diese Datei kommt ─────────────────────────────────────────────────
 *
 * Marco: „Die Android-App startet nicht mehr." Absturz beim Oeffnen, kein
 * Geraetezugriff, kein logcat.
 *
 * Der einzige neue Code im Startpfad war WorkManager. Der meldet sich ueber
 * androidx.startup an, und das laeuft in einem ContentProvider — also VOR
 * Application.onCreate(). Alles, was dort schiefgeht, toetet die App, bevor
 * eine eigene Zeile gelaufen ist; das `runCatching` um den Alarm sitzt eine
 * Stufe zu spaet und kann gar nichts auffangen.
 *
 * Ein abschaltbarer stuendlicher Abruf, in der Vorgabe AUS, gehoert nicht in
 * den Pfad, den jeder Start durchlaufen muss. Deshalb steht der Eintrag jetzt
 * per tools:node="remove" nicht mehr im Manifest, und WorkManager faehrt beim
 * ersten getInstance() hoch — das ist einplanen(), und das steht im
 * runCatching.
 *
 * ── Warum es dafuer eine Pruefung braucht ───────────────────────────────────
 *
 * Die Umstellung hat ZWEI Haelften, und wer nur eine macht, baut einen
 * Absturz ein, den kein Uebersetzer findet:
 *
 *   * Nur das Manifest geaendert  -> der erste getInstance() wirft
 *     „WorkManager is not initialized properly … your Application does not
 *     implement Configuration.Provider". Uebersetzt sauber.
 *   * Nur die Application geaendert -> WorkManager faehrt weiter beim Start
 *     hoch, die Configuration.Provider wird nie gefragt. Uebersetzt sauber,
 *     und der Grund fuer die ganze Uebung ist stillschweigend weg.
 *
 * Beides faellt erst auf dem Geraet auf. Hier faellt es vor dem Push auf.
 *
 * ── Warum im Web-Testbaum ───────────────────────────────────────────────────
 *
 * Dieselbe Begruendung wie bei app-vm-importe.test.js: In diesem Baum ist die
 * GitHub-Action der einzige Kotlin-Compiler. Ein Kotlin-Test meldete dasselbe
 * neun Minuten spaeter. Die Pfade sind ausgeschrieben (baumbruecken.test.js).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const WURZEL   = path.join(__dirname, '..', '..', 'Android-App', 'app', 'src', 'main');
const MANIFEST = path.join(WURZEL, 'AndroidManifest.xml');
const APP      = path.join(WURZEL, 'java', 'ch', 'brickinventoryapp', 'BrickInventoryApp.kt');

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
  // diese Pruefung meldete, der Alarm werde beim Start gar nicht mehr
  // eingeplant. Sie hatte recht in der Form und unrecht in der Sache; das ist
  // der Unterschied zwischen „liest den Quelltext" und „liest den Baum".
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
      stapel.push(/runCatching\s*$/.test(davor));
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

  // ── Die zweite Haelfte, seit dem 25.09. ──────────────────────────────────
  //
  // Dieses runCatching hier war die EINZIGE Absicherung, und genau darin lag
  // der naechste Absturz: Am Schalter im Einstellungsbildschirm stand derselbe
  // Aufruf nackt, und dort ist es der Hauptthread einer sichtbaren
  // Oberflaeche. Marco: „Sobald ich den Schalter Preisalarm in der App
  // aktivieren will, wird die App geschlossen."
  //
  // Seither faengt einplanen() selbst. Diese Pruefung bleibt trotzdem stehen:
  // Sie sichert den START, und das Lesen der Einstellung davor kann ebenfalls
  // scheitern. Dass die Funktion nicht mehr werfen KANN, prueft
  // test/alarm-einplanen-faellt-nicht.test.js — hier steht nur der Verweis,
  // damit niemand die eine fuer die andere haelt.
  const worker = fs.readFileSync(
    APP.replace(/BrickInventoryApp\.kt$/, 'alarm/PreisalarmWorker.kt'), 'utf8');
  assert.match(worker, /fun einplanen\([^)]*\)\s*:\s*Throwable\?/,
    'einplanen() gibt keinen Fehler mehr zurueck — dann wirft es wieder, und die '
    + 'Aufrufstelle am Schalter hat kein Netz.');
});
