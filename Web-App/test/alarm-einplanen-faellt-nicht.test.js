/**
 * Den Preisalarm einzuplanen darf die App nicht schliessen.
 *
 * ── Marcos Befund vom 25.09. ────────────────────────────────────────────────
 *
 *   „Sobald ich den Schalter Preisalarm in der App aktivieren will, wird die
 *    App geschlossen."
 *
 * ── Was dort stand ──────────────────────────────────────────────────────────
 *
 * Derselbe Aufruf an zwei Stellen, einmal abgesichert und einmal nicht:
 *
 *     BrickInventoryApp.onCreate   runCatching { … einplanen(…) }
 *     SettingsScreen, am Schalter  einplanen(context, neu)
 *
 * Das runCatching am Start gibt es nicht ohne Grund: WorkManager ist auf
 * Marcos Gerät schon einmal beim Hochfahren gescheitert — der Manifest-Eintrag
 * dazu schliesst mit „WARUM er gescheitert ist, weiss bis heute niemand".
 * Seither fährt WorkManager beim ERSTEN Zugriff hoch, und dieser Zugriff ist
 * einplanen(). Am Start fängt ihn das runCatching ab; am Schalter fing ihn
 * nichts ab, und das ist der Hauptthread einer sichtbaren Oberfläche.
 *
 * ── Warum die Regel an der FUNKTION hängt, nicht an den Aufrufern ───────────
 *
 * Eine Regel „jeder Aufruf steht in einem runCatching" wäre die naheliegende
 * und die schwächere: Sie muss jede neue Aufrufstelle einzeln einfangen, und
 * genau das ist hier schiefgegangen — die zweite Stelle kam später dazu und
 * niemand sah, dass die erste eine Absicherung trug.
 *
 * Geprüft wird deshalb die Form, die das Problem unmöglich macht:
 * einplanen() fängt selbst und GIBT DEN FEHLER ZURÜCK. Ein Rückgabewert
 * `Throwable?` lässt sich nicht versehentlich werfen — und dass er nicht
 * stillschweigend weggeworfen wird, prüft Schritt 3.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Das runCatching aus einplanen() entfernt      → Schritt 1 rot.
 *   b) Den Rückgabetyp auf Unit gesetzt              → Schritt 1 rot.
 *   c) Die Auswertung im Einstellungsbildschirm weg  → Schritt 3 rot.
 *   d) Den Aufruf zurück auf den Hauptthread gelegt  → Schritt 2 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');

// Als EIN Pfad und nicht als acht Segmente: test/baumbruecken.test.js zählt die
// Brücken zwischen den beiden Bäumen und will sie lesen können.
const APP = path.join(ROOT, '../Android-App/app/src/main/java/ch/brickinventoryapp');
const app = (rel) => ohneKommentare(fs.readFileSync(path.join(APP, rel), 'utf8'));

test('1. einplanen() kann nicht werfen und meldet zurück', () => {
  const worker = app('alarm/PreisalarmWorker.kt');
  const i = worker.indexOf('fun einplanen(');
  assert.ok(i >= 0, 'einplanen() nicht gefunden — umbenannt?');
  const kopf = worker.slice(i, worker.indexOf('\n', worker.indexOf('runCatching', i)) + 1);

  assert.match(kopf, /fun einplanen\([^)]*\)\s*:\s*Throwable\?/,
    'einplanen() gibt keinen Fehler zurück — dann wirft es entweder oder verschluckt.');
  assert.match(kopf, /runCatching\s*\{/,
    'einplanen() fängt nicht selbst — die nächste Aufrufstelle vergisst es.');
  assert.match(worker.slice(i), /\.exceptionOrNull\(\)/,
    'Das Ergebnis des runCatching wird nicht als Fehler zurückgegeben.');
});

test('2. der Schalter ruft es NICHT auf dem Hauptthread', () => {
  // Beim ersten Zugriff fährt WorkManager hoch und liest dabei von der Platte.
  // Auf dem Hauptthread einer sichtbaren Oberfläche ist das im besten Fall ein
  // Ruckeln — und es war die Stelle, an der die App starb.
  const s = app('ui/screens/SettingsScreen.kt');
  const i = s.indexOf('PreisalarmWorker.einplanen(');
  assert.ok(i >= 0, 'Der Schalter plant nicht mehr ein — umgebaut?');
  // Der umgebende Ausschnitt muss den Wechsel auf einen anderen Thread zeigen.
  const umfeld = s.slice(Math.max(0, i - 400), i);
  assert.match(umfeld, /withContext\(\s*kotlinx\.coroutines\.Dispatchers\.IO\s*\)/,
    'Der Aufruf steht wieder auf dem Hauptthread.');
});

test('3. und wirft den Fehler nicht weg', () => {
  // Ein Schalter auf „an", von dem nie eine Meldung kommt, ist die zweite
  // Hälfte desselben Fehlers: Die App stürzt nicht mehr ab, der Alarm läuft
  // aber trotzdem nicht — und niemand erfährt es.
  const s = app('ui/screens/SettingsScreen.kt');
  const i = s.indexOf('PreisalarmWorker.einplanen(');
  const danach = s.slice(i, i + 500);
  assert.match(danach, /showSnackbar\(/,
    'Der Einstellungsbildschirm zeigt einen Fehlschlag nicht an.');
  assert.match(danach, /alert_schedule_failed/,
    'Für den Fehlschlag gibt es keinen eigenen Text.');

  // Beide Sprachen — sonst steht auf dem einen Gerät ein Platzhalter.
  for (const rel of ['../Android-App/app/src/main/res/values/strings.xml',
                     '../Android-App/app/src/main/res/values-de/strings.xml']) {
    const xml = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(xml, /name="alert_schedule_failed"/, `${rel}: Text fehlt`);
    assert.match(xml, /alert_schedule_failed">[^<]*%1\$s/,
      `${rel}: Der Text nennt die Ursache nicht — genau die brauchen wir vom Gerät.`);
  }
});

test('4. der Start plant ebenfalls über denselben Weg ein', () => {
  // Er darf nicht wieder eine eigene Fassung bekommen: Zwei Wege zu derselben
  // Einplanung waren der Ausgangspunkt dieses Fehlers.
  const s = app('BrickInventoryApp.kt');
  assert.match(s, /PreisalarmWorker\s*\n?\s*\.einplanen\(/,
    'Der App-Start plant nicht mehr ein — dann überlebt der Alarm kein Zurücksetzen der App-Daten.');
});
