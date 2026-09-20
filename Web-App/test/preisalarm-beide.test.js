/**
 * Preisalarm — dieselbe Antwort in beiden Oberflächen.
 *
 * Wie test/bauabgleich-beide.test.js und test/lagerort-beide.test.js: Marcos
 * stehende Vorgabe ist „zwei saubere Apps, ansonsten identische Funktion".
 * Geprüft wird die NAHT; ob die Meldung zum richtigen Zeitpunkt kommt,
 * beantwortet test/preisalarm-db.test.js gegen echte Daten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');
const APP = path.join(WEB, '..', 'Android-App', 'app', 'src', 'main');
const lies = p => fs.readFileSync(p, 'utf8');
const web  = rel => lies(path.join(WEB, rel));

// Jeder Pfad in den Android-Baum AUSGESCHRIEBEN — siehe test/baumbruecken.test.js.
const KT_API    = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'data', 'api', 'BrickApiService.kt'));
const KT_FEAT   = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'ui', 'SetDetailFeature.kt'));
const KT_SECT   = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'ui', 'screens', 'SetDetailSections.kt'));
const KT_ABHOL  = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'alarm', 'Alarmabholung.kt'));
const KT_WORKER = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'alarm', 'PreisalarmWorker.kt'));
const KT_START  = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'BrickInventoryApp.kt'));
const KT_ALARMEINGABE = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'alarm', 'Alarmeingabe.kt'));
const KT_VM     = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'ui', 'MainViewModel.kt'));
const KT_EINST  = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'ui', 'screens', 'SettingsScreen.kt'));
const XML_EN    = lies(path.join(APP, 'res', 'values', 'strings.xml'));
const XML_DE    = lies(path.join(APP, 'res', 'values-de', 'strings.xml'));

test('beide Oberflächen sprechen dieselben drei Endpunkte an', () => {
  const route = web('routes/api_v1/sets.ts');
  for (const m of ['get', 'put', 'delete']) {
    assert.match(route, new RegExp(`router\\.${m}\\('/sets/:setNumber/alert'`),
      `Der Endpunkt ${m.toUpperCase()} fehlt`);
  }
  const js = web('public/js/07-admin.js');
  assert.match(js, /\/alert`\)/,  'Die Webapp liest den Alarm nicht');
  assert.match(js, /'PUT', `\/v1\/sets\/\$\{encodeURIComponent\(sn\)\}\/alert`/, 'Die Webapp setzt ihn nicht');
  assert.match(js, /'DELETE', `\/v1\/sets\/\$\{encodeURIComponent\(sn\)\}\/alert\?condition=/, 'Die Webapp löscht ihn nicht');

  assert.match(KT_API, /@GET\("api\/v1\/sets\/\{setNumber\}\/alert"\)/);
  assert.match(KT_API, /@PUT\("api\/v1\/sets\/\{setNumber\}\/alert"\)/);
  assert.match(KT_API, /@DELETE\("api\/v1\/sets\/\{setNumber\}\/alert"\)/);
});

test('ein Alarm gehört EINEM Konto — kein Blickfeld, nirgends', () => {
  // Der einzige Ort im Projekt, an dem `user_id` ohne scopeIds()/writableIds()
  // richtig ist: Wer eine Schwelle setzt, will selbst benachrichtigt werden.
  // Das Elternkonto hätte nichts davon, die Wünsche seiner Kinder per Mail zu
  // bekommen — und dürfte sie schon gar nicht löschen.
  //
  // Geprüft wird beides: dass die Route NICHT filtert, und dass sie es
  // begründet. Ohne die Begründung sieht die Stelle beim nächsten Lesen wie
  // ein vergessener Filter aus, und jemand „repariert" sie.
  const route = web('routes/api_v1/sets.ts');
  const i = route.indexOf("router.get('/sets/:setNumber/alert'");
  // Bis zur NAECHSTEN Route nach den Alarmen, nicht bis zu /storage: Zwischen
  // beiden stehen seit dem Lagerort-Vorrat vier weitere Routen, und die
  // filtern sehr wohl nach Konto. Der erste Entwurf schnitt bis /storage und
  // meldete deshalb genau die Zeilen, die richtig sind.
  const j = route.indexOf("router.get('/alerts/pending'");
  assert.ok(i > 0 && j > i, 'Die Alarm-Routen stehen nicht, wo erwartet');
  const block = route.slice(i, j);
  assert.doesNotMatch(block, /scopeIds|writableIds|parseScopeMode/,
    'Eine Alarm-Route filtert nach Blickfeld — dann bekämen Eltern die Mails der Kinder');
  assert.match(route.slice(Math.max(0, i - 900), i), /gehoert genau EINEM Konto/,
    'Die Ausnahme ist nicht begründet — beim nächsten Lesen sieht sie aus wie ein Versehen');

  assert.doesNotMatch(KT_API.slice(KT_API.indexOf('getPreisalarme'),
                                   KT_API.indexOf('// ── Lagerort')), /@Query\("accounts"\)/,
    'Die App schickt einen Kontofilter mit — der Server ignoriert ihn, aber die Absicht wäre falsch');
});

test('ein leeres Feld löscht — in beiden', () => {
  // Die natürliche Geste, einen Alarm loszuwerden, ist das Feld zu leeren.
  // Ein eigener Knopf daneben wäre ein zweiter Weg für dieselbe Absicht, und
  // eine „Schwelle 0" wäre ein Alarm, der nie oder immer meldet.
  //
  // Beide entscheiden es an derselben Stelle: „ist das eine Zahl > 0?". Die
  // Webapp misst es zusätzlich am Verhalten (test/alarm-entprellt.test.js),
  // die App an der Umrechnung (AlarmeingabeTest).
  assert.match(web('public/js/07-admin.js'), /const loeschen = !\(zahl > 0\);/,
    'Die Webapp löscht bei leerem Feld nicht');
  assert.match(KT_ALARMEINGABE, /return if \(z > 0\.0\) z else null/,
    'Die App löscht bei leerem Feld nicht');
  assert.match(KT_FEAT, /if \(schwelle == null\)\s*\n?\s*repo\.sets\.deletePreisalarm/,
    'Die App löscht bei leerem Feld nicht');
});

test('beide speichern beim TIPPEN, entprellt, mit derselben Ruhezeit', () => {
  // ── Marcos Befund ─────────────────────────────────────────────────────────
  //
  // „Der Preisalarm wird nicht gespeichert … soll gespeichert werden, wenn
  // man was einträgt. Analog dem Kaufpreis."
  //
  // Beide hingen am Verlassen des Feldes. Am Telefon tippt man die Zahl,
  // schliesst die Tastatur und geht zurück — dieser Fokuswechsel kommt nie.
  const js = require('./helpers/sources').ohneKommentare(web('public/js/07-admin.js'));
  assert.match(js, /data-input="alarmGetippt"/,
    'Das Schwellenfeld der Webapp hängt nicht am Tippen');
  assert.doesNotMatch(js, /id="m-alert-val"[^>]*data-change/,
    'Das Schwellenfeld hängt wieder am Fokuswechsel');
  assert.match(KT_SECT, /onValueChange = \{ schwelle = it; vm\.setzePreisalarm\(setNumber, richtung, it, zustand\) \}/,
    'Das Schwellenfeld der App hängt nicht am Tippen');
  assert.doesNotMatch(require('./helpers/sources').ohneKommentare(KT_SECT),
    /alarmFokus/, 'Die App speichert noch am Fokuswechsel');

  // Dieselbe Ruhezeit in beiden: Laufen sie auseinander, verhält sich
  // dasselbe Feld an zwei Stellen verschieden, ohne dass es jemandem auffiele.
  const webRuhe = /const ALARM_RUHE = (\d+);/.exec(js);
  const appRuhe = /const val RUHE_MS = (\d+)L/.exec(KT_ALARMEINGABE);
  assert.ok(webRuhe && appRuhe, 'Eine der beiden Ruhezeiten steht nicht mehr da');
  assert.equal(webRuhe[1], appRuhe[1],
    `Webapp ${webRuhe[1]} ms, App ${appRuhe[1]} ms — dasselbe Feld, zwei Takte`);
});

test('die Ruhezeit der App überlebt das Verlassen des Bildschirms', () => {
  // Ein LaunchedEffect mit delay() wäre die naheliegende Lösung und hätte
  // denselben Fehler nur verschoben: Er hängt an der Komposition. Wer während
  // der Ruhezeit zurückgeht, löst sie auf und bricht den Auftrag ab — wieder
  // nichts gespeichert, nur seltener.
  assert.match(KT_VM, /internal var alarmJob/,
    'Der Auftrag hängt nicht mehr am ViewModel');
  const f = require('./helpers/sources').ohneKommentare(KT_FEAT);
  assert.match(f, /alarmJob\?\.cancel\(\)\s*\n\s*alarmJob = viewModelScope\.launch/,
    'Die Ruhezeit läuft nicht im viewModelScope');
  assert.doesNotMatch(require('./helpers/sources').ohneKommentare(KT_SECT),
    /LaunchedEffect\([^)]*schwelle/,
    'Die Ruhezeit steht wieder in einem LaunchedEffect — sie stirbt mit dem Bildschirm');
  // Und die späte Antwort darf nicht im Zustand eines ANDEREN Sets landen.
  assert.match(f, /setDetail\?\.setNumber == setNumber/,
    'Eine späte Antwort schreibt die Alarme des vorigen Sets in den neuen Zustand');
});

test('beide zeigen, ob schon gemeldet wurde', () => {
  // Der Unterschied zwischen „der Alarm steht" und „der Alarm hat gefeuert".
  // Ohne diese Zeile fragt man sich, warum keine Mail mehr kommt — und die
  // Antwort (Hysterese) steht nirgends auf dem Bildschirm.
  assert.match(web('public/js/07-admin.js'), /a\.ausgeloest \? tRaw\('detail\.alert_fired'\)/,
    'Die Webapp zeigt den Merker nicht');
  assert.match(KT_SECT, /alarm\.ausgeloest\) R\.string\.detail_alert_fired/,
    'Die App zeigt den Merker nicht');
});

test('beide Sprachen sind gepflegt — in beiden Oberflächen', () => {
  for (const datei of ['public/locales/de.js', 'public/locales/en.js']) {
    const s = web(datei);
    for (const k of ['detail.alert', 'detail.alert_below', 'detail.alert_above',
                     'detail.alert_armed', 'detail.alert_fired']) {
      assert.ok(s.includes(`'${k}'`), `${datei}: ${k} fehlt`);
    }
  }
  for (const [datei, s] of [['res/values/strings.xml', XML_EN],
                            ['res/values-de/strings.xml', XML_DE]]) {
    for (const k of ['detail_alert', 'detail_alert_below', 'detail_alert_above',
                     'detail_alert_armed', 'detail_alert_fired']) {
      assert.ok(s.includes(`name="${k}"`), `${datei}: ${k} fehlt`);
    }
  }
});

test('die Prüfung hängt am Ende des Preislaufs, nicht an jedem Preisabruf', () => {
  // In fetchAndCachePrice() liefe sie pro Lauf tausendfach — auch bei
  // Cache-Treffern, bei denen sich nichts geändert hat — und meldete dieselbe
  // Schwelle mehrfach je Durchgang.
  const job = require('./helpers/sources').ohneKommentare(web('jobs/priceJob.ts'));
  assert.match(job, /pruefeSet/, 'Der Preislauf prüft keine Alarme');
  // Bis zur SCHLIESSENDEN Klammer der Funktion, nicht bis zur nächsten
  // Deklaration: Zwischen fetchAndCachePrice() und refreshPriceForSet() liegt
  // die Hauptschleife des Laufs — und genau dort steht die Prüfung richtig.
  // Der erste Entwurf schnitt bis dorthin und meldete deshalb die richtige
  // Stelle als Fehler.
  const i = job.indexOf('async function fetchAndCachePrice');
  assert.ok(i > 0, 'fetchAndCachePrice nicht gefunden');
  const fetchTeil = job.slice(i, job.indexOf('\n}', i));
  assert.doesNotMatch(fetchTeil, /pruefeSet/,
    'Die Prüfung hängt am einzelnen Preisabruf — dann meldet sie mehrfach je Lauf');
  assert.match(job, /SELECT DISTINCT set_number FROM price_alerts/,
    'Es müssen nur die Sets geprüft werden, auf die jemand wartet');
});

// ═══ Das Melden: die App fragt stündlich nach, die Webapp beim Öffnen ═══════
//
// Marcos Auftrag: „Ja gerne. Das Intervall aber bitte auf Stunde setzen."
//
// Echtes Push hiesse Firebase — ein Google-Projekt, eine Konfigurationsdatei
// im Baum, und jede Meldung liefe über fremde Server. Für eine selbst
// gehostete Sammlung ist das eine schwere Abhängigkeit für eine leichte
// Nachricht, und sie kauft fast nichts: Der Preislauf läuft selbst stündlich.

test('beide holen dieselbe Liste beim selben Endpunkt ab', () => {
  assert.match(web('routes/api_v1/sets.ts'), /router\.get\('\/alerts\/pending'/,
    'Der Endpunkt fehlt');
  assert.match(web('public/js/07-admin.js'), /'\/v1\/alerts\/pending'/,
    'Die Webapp fragt nicht nach');
  assert.match(KT_API, /@GET\("api\/v1\/alerts\/pending"\)/,
    'Die App fragt nicht nach');
  // Und die Webapp fragt auch TATSÄCHLICH — ein Aufruf, den niemand aufruft,
  // ist genau die Sorte Halbfertiges, die hier schon zweimal stehen blieb.
  //
  // ohneKommentare(): Die Gegenprobe zu dieser Zeile blieb GRÜN. Über dem
  // Aufruf in showApp() steht seine Begründung, und darin kommt der Name
  // vor — die Prüfung fand also ihre eigene Erklärung und hätte auch einen
  // gelöschten Aufruf durchgehen lassen. Dieselbe Falle wie in
  // household.test.js und ratschen.test.js.
  assert.match(require('./helpers/sources').ohneKommentare(web('public/js/01-core.js')),
    /zeigeOffeneAlarme/,
    'zeigeOffeneAlarme() wird beim Anmelden nicht aufgerufen');
});

test('die Marke kommt vom SERVER, nicht von der eigenen Uhr', () => {
  // Nähme jede Seite ihre eigene Uhr, entschiede die Gangabweichung zum
  // Server darüber, ob eine Meldung doppelt kommt (Uhr geht nach) oder
  // verloren geht (sie geht vor). Beides fällt niemandem als Uhrenproblem
  // auf — man sieht nur eine Meldung zu viel oder keine.
  assert.match(web('utils/preisalarm.ts'), /SELECT NOW\(\) AS jetzt/,
    'Der Server reicht seinen Zeitpunkt nicht mit');

  const js = require('./helpers/sources').ohneKommentare(web('public/js/07-admin.js'));
  const i = js.indexOf('export async function zeigeOffeneAlarme');
  assert.ok(i > 0, 'zeigeOffeneAlarme() nicht gefunden');
  const block = js.slice(i, js.indexOf('\nexport ', i + 10));
  assert.match(block, /localStorage\.setItem\(schluessel, String\(d\.now\)\)/,
    'Die Webapp merkt sich nicht den Zeitpunkt des Servers');
  assert.doesNotMatch(block, /Date\.now\(\)|new Date\(\)/,
    'Die Webapp nimmt ihre eigene Uhr');

  assert.match(KT_ABHOL, /antwort\.now\?\.takeIf/,
    'Die App nimmt nicht den Zeitpunkt des Servers als neue Marke');
  assert.doesNotMatch(KT_ABHOL, /System\.currentTimeMillis|Instant\.now/,
    'Die App nimmt ihre eigene Uhr');
});

test('der erste Durchgang meldet NICHTS — in beiden', () => {
  // Eine frisch eingerichtete App (oder ein frisch angemeldetes Konto am
  // Browser) soll nicht mit Schwellen aufschlagen, die vor Wochen gerissen
  // sind. Der Server liefert ohne `since` schon eine leere Liste; beide
  // Oberflächen sagen es trotzdem selbst, damit es im Code steht und nicht
  // nur als Nebenwirkung einer Serverantwort existiert.
  const js = require('./helpers/sources').ohneKommentare(web('public/js/07-admin.js'));
  const i = js.indexOf('export async function zeigeOffeneAlarme');
  assert.match(js.slice(i, js.indexOf('\nexport ', i + 10)), /if \(!marke\) return;/,
    'Die Webapp meldet beim ersten Besuch');
  assert.match(KT_ABHOL, /if \(marke\.isNullOrBlank\(\)\) return Ergebnis\.Markiert/,
    'Die App meldet beim ersten Durchgang');
});

test('der Abruf der App steht auf einer Stunde und ist abschaltbar', () => {
  assert.match(KT_WORKER, /PeriodicWorkRequestBuilder<PreisalarmWorker>\(1, TimeUnit\.HOURS\)/,
    'Das Intervall ist nicht eine Stunde — Marcos ausdrückliche Vorgabe');
  // Ohne Netz gar nicht erst anlaufen, statt vergeblich das Funkmodem zu
  // wecken. Das ist der grösste Einzelposten am Akkuverbrauch.
  assert.match(KT_WORKER, /setRequiredNetworkType\(NetworkType\.CONNECTED\)/,
    'Der Auftrag läuft auch ohne Netz an');
  // KEEP, nicht UPDATE: Sonst schöbe jeder App-Start den nächsten Lauf nach
  // hinten, und bei häufiger Benutzung fände der Abruf nie statt.
  assert.match(KT_WORKER, /ExistingPeriodicWorkPolicy\.KEEP/,
    'Ein häufig geöffneter App verschiebt den Abruf endlos');
  // Der Schalter muss den Auftrag SOFORT einplanen und abbestellen — sonst
  // wäre „eingeschaltet" eine Stunde lang eine Behauptung ohne Wirkung.
  assert.match(KT_EINST, /PreisalarmWorker\.einplanen\(context, neu\)/,
    'Der Schalter plant den Auftrag nicht ein');
  assert.match(KT_WORKER, /if \(!an\) \{ wm\.cancelUniqueWork\(NAME\); return \}/,
    'Ausschalten bestellt den Auftrag nicht ab');
  // Und beim Start wieder einplanen: WorkManager überlebt Neustarts, aber
  // nicht ein Zurücksetzen der App-Daten oder ein „Force Stop", nach dem
  // manche Hersteller die Aufträge verwerfen.
  assert.match(KT_START, /PreisalarmWorker\.einplanen\(this@BrickInventoryApp, true\)/,
    'Nach einem Zurücksetzen käme nie wieder eine Meldung');
});

test('beide formulieren die Meldung gleich', () => {
  // Wer beide benutzt, soll nicht zwei Formulierungen derselben Nachricht
  // lesen. Die Zahlen stehen mit zwei Nachkommastellen und in der Währung
  // des ALARMS, nicht der aktuellen Kontowährung: Die Schwelle wurde in
  // jener Währung gesetzt, und 200 CHF sind nicht 200 EUR.
  assert.match(KT_ABHOL, /a\.currencyCode/, 'Die App nimmt nicht die Währung des Alarms');
  assert.match(KT_ABHOL, /"%\.2f"/, 'Die App rundet nicht auf zwei Stellen');
  const js = web('public/js/07-admin.js');
  assert.match(js, /a\.currency_code/, 'Die Webapp nimmt nicht die Währung des Alarms');
  assert.match(js, /toFixed\(2\)/, 'Die Webapp rundet nicht auf zwei Stellen');
  // Dieselben zwei Richtungstexte wie im Detailfenster, nicht zwei neue.
  assert.match(js, /tRaw\('detail\.alert_below'\), ueber = tRaw\('detail\.alert_above'\)/,
    'Die Webapp erfindet eigene Richtungstexte');
  assert.match(KT_WORKER, /R\.string\.detail_alert_below/,
    'Die App erfindet eigene Richtungstexte');
});

test('die Benachrichtigung der App ist gepflegt und erklärt sich', () => {
  for (const [datei, s] of [['res/values/strings.xml', XML_EN],
                            ['res/values-de/strings.xml', XML_DE]]) {
    for (const k of ['alert_channel_name', 'alert_channel_desc',
                     'alert_notify', 'alert_notify_hint']) {
      assert.ok(s.includes(`name="${k}"`), `${datei}: ${k} fehlt`);
    }
  }
  // Ab Android 13 ist POST_NOTIFICATIONS eine Laufzeitberechtigung. Ohne sie
  // wirft notify() nicht — es passiert schlicht nichts.
  assert.match(lies(path.join(APP, 'AndroidManifest.xml')),
    /android\.permission\.POST_NOTIFICATIONS/, 'Die Berechtigung fehlt im Manifest');
  assert.match(KT_WORKER, /checkSelfPermission/,
    'Der Worker prüft die Berechtigung nicht — die Meldung verschwände lautlos');
});

test('der Alarm gilt für einen ZUSTAND, und der ist wählbar — in beiden', () => {
  // ── Was hier vorher stand ─────────────────────────────────────────────────
  //
  // `const ALARM_ZUSTAND = 'N'` in beiden Oberflächen, mit der Begründung:
  // „Die Oberfläche bietet vorerst den für NEU an … ein zweites Auswahlfeld
  // hier ist dagegen eine Zeile."
  //
  // Server und Tabelle konnten es die ganze Zeit: `price_alerts` führt den
  // Zustand im Schlüssel, und test/preisalarm-db.test.js prüft seit jeher
  // „der Zustand trennt die Alarme". Nur wählen liess er sich nicht. Neu und
  // gebraucht liegen oft um ein Vielfaches auseinander.
  const js = require('./helpers/sources').ohneKommentare(web('public/js/07-admin.js'));
  assert.doesNotMatch(js, /const ALARM_ZUSTAND = /,
    'Die Webapp hat den Zustand wieder festgenagelt');
  // Der Anker ist gewandert: Das Markup lag inline im Set-Dialog und trug
  // feste IDs. Seit das Wunsch-Detail denselben Alarm zeigt — derselbe
  // Eintrag in price_alerts, am selben Schluessel — steht es in
  // alarmBlock(praefix), und die ID entsteht aus dem Praefix. Geprueft wird
  // weiterhin, DASS es eine Zustandswahl gibt.
  assert.match(js, /id="\$\{p\}-alert-cond"/, 'Der Webapp fehlt die Zustandswahl');
  assert.match(js, /export function alarmBlock\(/,
    'Der Alarmblock ist nicht mehr gemeinsam — dann hat die Wunschliste eine zweite Maske');
  assert.match(js, /function alarmZustand\(\)/,
    'Die Webapp liest den gewählten Zustand nicht');

  const kt = require('./helpers/sources').ohneKommentare(KT_SECT);
  assert.match(kt, /var zustand by rememberSaveable/,
    'Der App fehlt die Zustandswahl — oder sie übersteht keine Drehung');
  assert.match(kt, /R\.string\.condition_used/,
    'Der App fehlt der Knopf für „gebraucht"');

  // ── Ein Wechsel LÄDT, er speichert nicht ─────────────────────────────────
  //
  // Ein Wechsel ist die Frage „was steht für gebraucht?", keine Eingabe.
  // Würde dabei gespeichert, legte schon das Umschalten einen Alarm im neuen
  // Zustand an — oder löschte ihn, wenn das Feld gerade leer ist.
  assert.match(js, /data-change="wechsleAlarmZustand"/,
    'Die Zustandswahl der Webapp hängt am Speichern statt am Laden');
  const i = js.indexOf('export function wechsleAlarmZustand');
  assert.ok(i > 0, 'wechsleAlarmZustand fehlt');
  const block = js.slice(i, js.indexOf('\n}', i));
  assert.doesNotMatch(block, /sendeAlarm|api\('PUT'|api\('DELETE'/,
    'Ein Zustandswechsel der Webapp schreibt');
  assert.match(kt, /onClick = \{ zustand = "U" \}/,
    'Der Zustandswechsel der App tut mehr als umschalten');
});
