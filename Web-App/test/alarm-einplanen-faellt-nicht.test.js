/**
 * Den Preisalarm einzuplanen darf die App nicht schliessen.
 * Ausführlich: docs/begruendungen/test/alarm-einplanen-faellt-nicht.test.js.md#kopf
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
const { androidDatei } = require('./helpers/android');

// Die App-Quellen über alle Module: androidDatei() meldet eine fehlende Datei mit Namen.
const app = (rel) => ohneKommentare(fs.readFileSync(androidDatei(rel), 'utf8'));

test('1. einplanen() kann nicht werfen und meldet zurück', () => {
  const worker = app('dienste/alarm/PreisalarmWorker.kt');
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
  // Der Schalter selbst plant nicht ein; er meldet den Wunsch an das ViewModel,
  // und das plant über den AlarmPlaner ein.
  assert.doesNotMatch(app('konto/ui/screens/EinstellungenAlarme.kt'), /einplanen\(/,
    'Der Bildschirm plant wieder selbst ein — dann läuft es auf dem Hauptthread.');
  const vm = app('zustand/ui/viewmodel/GeraeteEinstellungenViewModel.kt');
  assert.match(vm, /planer\.einplanen\(/, 'Das ViewModel plant nicht mehr ein — umgebaut?');

  const s = app('dienste/alarm/WorkManagerAlarmPlaner.kt');
  const i = s.indexOf('PreisalarmWorker.einplanen(');
  assert.ok(i >= 0, 'Der AlarmPlaner plant nicht mehr ein — umgebaut?');
  // Der umgebende Ausschnitt muss den Wechsel auf den IO-Dispatcher zeigen …
  const umfeld = s.slice(Math.max(0, i - 200), i);
  assert.match(umfeld, /withContext\(\s*io\s*\)/, 'Der Aufruf steht wieder auf dem Hauptthread.');
  assert.match(s, /@param:Dispatcher\(BrickDispatchers\.IO\)\s+private val io: CoroutineDispatcher/,
    'Der Dispatcher des Planers ist nicht der IO-Dispatcher.');
  // … und der IO-Dispatcher ist wirklich Dispatchers.IO.
  assert.match(app('data/di/KoroutinenModule.kt'),
    /@Dispatcher\(BrickDispatchers\.IO\)\s*fun \w+\(\)\s*:\s*CoroutineDispatcher\s*=\s*Dispatchers\.IO/,
    'Der IO-Dispatcher zeigt nicht auf Dispatchers.IO.');
});

test('3. und wirft den Fehler nicht weg', () => {
  // Ein Schalter auf „an", von dem nie eine Meldung kommt, ist die zweite
  // Hälfte desselben Fehlers: Die App stürzt nicht mehr ab, der Alarm läuft
  // aber trotzdem nicht — und niemand erfährt es.
  const s = app('zustand/ui/viewmodel/GeraeteEinstellungenViewModel.kt');
  const i = s.indexOf('planer.einplanen(');
  const danach = s.slice(i, i + 400);
  assert.match(danach, /meldungen\.zeige\(/,
    'Ein Fehlschlag des Einplanens wird nicht gemeldet.');
  assert.match(danach, /alert_schedule_failed/,
    'Für den Fehlschlag gibt es keinen eigenen Text.');

  // Beide Sprachen — sonst steht auf dem einen Gerät ein Platzhalter.
  for (const rel of ['../Android-App/core-ressourcen/src/main/res/values/strings.xml',
                     '../Android-App/core-ressourcen/src/main/res/values-de/strings.xml']) {
    const xml = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(xml, /name="alert_schedule_failed"/, `${rel}: Text fehlt`);
    assert.match(xml, /alert_schedule_failed">[^<]*%1\$s/,
      `${rel}: Der Text nennt die Ursache nicht — genau die brauchen wir vom Gerät.`);
  }
});

test('4. der Start plant ebenfalls über denselben Weg ein', () => {
  // Er darf nicht wieder eine eigene Fassung bekommen: Zwei Wege zu derselben
  // Einplanung waren der Ausgangspunkt dieses Fehlers.
  const s = app('app/BrickInventoryApp.kt');
  assert.match(s, /PreisalarmWorker\s*\n?\s*\.einplanen\(/,
    'Der App-Start plant nicht mehr ein — dann überlebt der Alarm kein Zurücksetzen der App-Daten.');
});
