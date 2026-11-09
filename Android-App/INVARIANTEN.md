# Invarianten — bitte vor Änderungen lesen

Kurze Liste von Dingen, die in diesem Projekt schon **mehrfach** kaputtgegangen
sind. Die genannten Dateien und Tests gibt es (`InvariantenVerweiseTest` prüft das);
ob ein Test eine Regel noch ganz trägt, prüft das nicht. Schlägt einer fehl, ist die
Regel verletzt — dann den Code korrigieren, nicht den Test.

## Kamera-Autofokus

**Dateien:** `sammlung/ui/screens/BarcodeScannerScreen.kt`, `anmeldung/ui/screens/SetupQr.kt`
**Test:** `CameraFocusConfigTest`

1. `CONTROL_AF_MODE_CONTINUOUS_PICTURE` muss an **beiden** Use Cases stehen —
   Preview *und* ImageAnalysis. CameraX führt die Konfigurationen aller
   gebundenen Use Cases zu **einem** Repeating-Request zusammen. Steht der Modus
   nur an einem, entscheidet je nach Gerät die andere Konfiguration mit, und das
   Bild bleibt unscharf. Der Code sieht dabei völlig richtig aus.

2. **Kein periodisches `startFocusAndMetering`.** Ein im Takt laufender Aufruf
   („Fokus-Pump") zwingt die Kamera immer wieder in eine neue Messung, der Fokus
   wandert dauernd. Tap-to-Focus im Touch-Listener ist in Ordnung — eine
   Schleife, ein Timer oder ein `delay()` davor nicht.

Beides ist mindestens dreimal aufgetreten. Der Warnblock am Kopf beider Dateien
wiederholt die Regel dort, wo sie gebraucht wird.

## Doppelklick-Sperre im Barcode-Dialog

**Dateien:** `sammlung/ui/viewmodel/ErfassungViewModel.kt`, `sammlung/ui/ZustandErfassung.kt`, `sammlung/ui/dialogs/BarcodeResultDialog.kt`
**Test:** `ErfassungViewModelTest` („ein zweiter Klick auf Bestaetigen legt das Set nicht zweimal an“)

Der Zwischendialog nach dem Barcode-Scan reagiert träge; Nutzer tippen deshalb
zweimal auf „Hinzufügen", und das Set landete zweimal in der Galerie.

Die Sperre muss im ViewModel liegen: `confirmAddBarcode()` prüft
`_barcodeState.value.adding` als Erstes und setzt das Flag **synchron vor**
`viewModelScope.launch`. Wandert die Zuweisung in den Coroutine-Block, ist das
Rennen wieder offen — beide Klicks kommen an der Prüfung vorbei, bevor der
erste das Flag setzt.

`bestaetigenAn = !barcodeState.adding` am Knopf ist Feedback, **kein** Schutz: Es
greift erst nach der Rekomposition, und genau die ist ja die langsame Stelle.

Jeder Ausgang von `confirmAddBarcode()` sowie `cancelBarcode()` müssen das Flag
zurücksetzen, sonst bleibt der Knopf nach einem Fehler dauerhaft gesperrt.

## Abgelaufene Sitzung (HTTP 401)

**Dateien:** `data/repository/RepoBasis.kt`, `app/di/AppModule.kt`,
`data/SessionExpiredSignal.kt`, `zustand/ui/SitzungsDienst.kt`
**Test:** `SessionAndLifecycleTest`

Ein 401 ist kein gewöhnlicher Serverfehler. Drei Regeln:

1. `safeCall()` meldet ihn als eigene Art `Ergebnis.Error.Abgewiesen`. Ohne das
   ist er von einem Netzwerkfehler nicht unterscheidbar.

2. **`cached()` darf bei `Abgewiesen` NICHT auf den Plattenspeicher
   zurückfallen.** Sonst deckt der bis zu sieben Tage alte Cache die
   abgelaufene Sitzung zu: Der Nutzer sieht eine scheinbar normale Galerie,
   obwohl er längst nicht mehr angemeldet ist. Ein Fehlerzustand, der wie
   Normalbetrieb aussieht, ist schlimmer als eine Fehlermeldung.

3. Der Interceptor meldet nur, wenn **ein Token mitgeschickt wurde UND es der
   eigene Server war**. Fällt eine der beiden Bedingungen weg, würde ein
   fehlgeschlagener Login (noch kein Token) oder ein 401 von einem fremden CDN
   den Nutzer ausloggen.

## ImageLoader lebt genau einmal

**Dateien:** `app/di/AppModule.kt`, `MainActivity.kt`
**Test:** `SessionAndLifecycleTest`

Der ImageLoader gehört ins DI-Modul, nicht in `MainActivity.onCreate()`. Dort
gebaut entsteht bei jeder Bildschirmdrehung eine zweite Instanz auf demselben
Disk-Cache-Verzeichnis, und der Memory-Cache ist jedes Mal leer — alle
sichtbaren Thumbnails werden neu dekodiert.

## Polling hängt am Lifecycle

**Datei:** `verwaltung/ui/screens/MonitoringScreen.kt`
**Test:** `SessionAndLifecycleTest`

`LaunchedEffect` endet erst, wenn der Screen verlassen wird — **nicht** beim
Wechsel in den Hintergrund. Eine getaktete Schleife darin pollt also weiter,
solange die App auf dem Screen liegt. Jede solche Schleife gehört in
`repeatOnLifecycle(STARTED)`.

## Kein zweiter Barcode-Pfad

**Dateien:** `sammlung/ui/viewmodel/ErfassungViewModel.kt`, `sammlung/ui/ZustandErfassung.kt`
**Test:** `SessionAndLifecycleTest`

Es gab lange eine komplette, nie aufgerufene Zweitimplementierung des Scanners
(`BarcodeResolver`, `BarcodeResultDialog`, `onBarcodeDetected` &Co.). Darin
steckte ein blockierender `Call.execute()` aus dem `viewModelScope` ohne
`Dispatchers.IO` — die Server-Abfrage hat nie funktioniert, der Fehler wurde
vom umgebenden `catch` verschluckt. Genau so versteckt sich Fehler in totem
Code. Der live genutzte Pfad ist: Scanner-Screen → `vm.resolveBarcode()` →
`repo.resolveBarcode()`.

## Services sind lokalisiert — über den richtigen Context

**Dateien:** `dienste/service/CsvImportService.kt`, `data/service/PdfExportService.kt`,
`data/service/PdfExportManager.kt`, `data/util/LanguageManager.kt`
**Test:** `ServicePolishTest`

`setApplicationLocales()` lokalisiert nur Activities. Ein Service, der
`getString()` auf seinem eigenen Context aufruft, bekommt unterhalb von
Android 13 die **System**-Sprache — genau deshalb waren die
Benachrichtigungstexte lange hartkodiert deutsch. Beides ist falsch: Texte
gehören in `strings.xml`/`strings-de.xml`, und Services holen sie über
`LanguageManager.localizedContext(this)`.

Ausserdem: `setSmallIcon()` braucht ein **monochromes** Drawable
(`ic_stat_brick`), Android rendert Status-Icons nur über den Alpha-Kanal —
das adaptive Launcher-Icon erscheint als graues Quadrat.

## FileProvider: nur pdf/

**Dateien:** `res/xml/file_paths.xml`, `data/service/PdfExportManager.kt`
**Test:** `ServicePolishTest`

Über die Provider-Authority wird ausschliesslich das exportierte
Teilelisten-PDF geteilt. `file_paths.xml` deckt deshalb nur `pdf/` ab —
niemals wieder ganze Wurzeln (`path="."`), sonst ist auch der API-Cache
(Inventar im Klartext-JSON) erreichbar. Zwei Seiten derselben Regel: Der
`PdfExportManager` muss ins `pdf/`-Unterverzeichnis schreiben, sonst wirft
`getUriForFile()` eine SecurityException.

## Ein OkHttp-Interceptor-Stack, keine Nebenclients

**Dateien:** `finanzen/ui/pdf/AnleitungsLader.kt`, `zustand/ui/AppViewModel.kt`
**Test:** `AnleitungsDownloadTest`

Jeder eigenständig gebaute `OkHttpClient.Builder()` läuft am DI-Interceptor
vorbei: kein Bearer-Token, kein Klartext-Verbot, keine 401-Meldung — jede
Regel müsste dort von Hand nachgezogen werden (und genau so eine
handgepflegte Kopie stand hier bereits). Abweichende Timeouts holt man sich
per `newBuilder()` vom injizierten api-Client, nicht mit einem neuen Client.

## Kamera-Screens räumen ihre Ressourcen auf

**Dateien:** `sammlung/ui/screens/BarcodeScannerScreen.kt`, `anmeldung/ui/screens/SetupQr.kt`
**Test:** `ResourceAndCacheTest`

`remember { }` hat **keinen** Aufräum-Hook. Was darin erzeugt wird und
freigegeben werden muss — hier der Analyse-Executor und der ML-Kit-Client
mit nativen Ressourcen — braucht ein `DisposableEffect(Unit) { onDispose { … } }`.
Ohne das überlebt beides jeden Besuch des Screens.

Die Kamera selbst ist davon nicht betroffen: Sie hängt am `lifecycleOwner`
und wird von CameraX entbunden. Das Aufräumen läuft **nach** dem Verlassen
des Screens und darf den Autofokus nie berühren.

## PDF-Ansichts-Cache mit Budget

**Datei:** `finanzen/ui/pdf/AnleitungsLader.kt`
**Test:** `ResourceAndCacheTest`

Angesehene Anleitungen bleiben absichtlich liegen (Resume, erneutes Öffnen
ohne Neudownload), verschlüsselt über `AnleitungsAblage` (`AnleitungsAblageTest`)
und beim Abmelden gelöscht. Bei Dateien bis 300 MB braucht das eine Obergrenze:
`prunePdfCache()` hält den Cache unter `PDF_CACHE_BUDGET_BYTES`, älteste
zuerst. Die gerade angeforderte Datei ist ausgenommen — sonst löscht das
Aufräumen den Teil-Download, auf dem der Resume-Mechanismus aufsetzen will.

## Abmelden leert beide Caches

**Datei:** `data/SitzungsBereinigung.kt`
**Test:** `ResourceAndCacheTest`

Zum API-Cache gehört der Bild-Cache: Beide enthalten Daten des angemeldeten
Kontos. Memory-Cache **vor** Disk-Cache leeren — sonst schreibt Coil beim
nächsten Speicher-Treffer sofort wieder auf die Platte.

## Ein CSV-Statuspfad, nicht zwei

**Dateien:** `dienste/service/CsvImportService.kt`, `data/CsvImportSseClient.kt`
**Test:** `ResourceAndCacheTest`

Der Service pollte früher unabhängig vom ViewModel denselben Endpoint — zwei
Implementierungen desselben Sachverhalts. Jetzt: SSE zuerst, Polling nur als
Rückfallebene, und die Statuslogik steht in genau einer Funktion
(`applyStatus`).

Dabei nötig ist der **Anlaufschutz**: Der Service startet im selben Moment
wie der Upload, der Server meldet aber "idle", bis der Import-Job angelegt
ist. Ohne das Fenster in `applyStatus()` beendet die erste idle-Antwort den
Service, und der Nutzer sieht nie einen Fortschritt.

## Debug-Builds haben eine feste Version

**Datei:** `app/build.gradle.kts`
**Test:** `ResourceAndCacheTest`

Die zeitbasierte Version ist für Release gewollt, macht Debug-Builds aber bei
jedem Durchlauf "out of date". Die Überschreibung muss über die Variant-API
laufen (`androidComponents { onVariants … }`): In `buildTypes { debug { … } }`
liesse sich nur ein `versionNameSuffix` setzen, der Name selbst wechselte
weiter minütlich.

## Ergebnis hat genau zwei Varianten — kein `else`

**Datei:** `data/repository/Ergebnis.kt`
**Test:** `ResultAndStateSplitTest`

`safeCall()` liefert nur `Success` oder `Error`. Die frühere dritte Variante
`Loading` wurde nie erzeugt und hatte einen einzigen Effekt: Jedes `when`
brauchte einen `else`-Zweig — und `else -> {}` verschluckt stillschweigend
auch jeden Fall, der später dazukommt.

Mit zwei Varianten ist jedes `when` erschöpfend, und eine neue Variante
bricht den Build an genau den Stellen, die sie behandeln müssen. Deshalb:
**keinen `else`-Zweig nachrüsten**, weder in `Result` selbst noch in einem
`when` darüber. Der Test prüft das für alle Quelldateien — und zwar je Block
auf dessen eigener Ebene, damit ein verschachteltes `when` nicht als
Error-Zweig des äusseren durchgeht.

## Zustand ist nach Domänen getrennt

**Dateien:** `*/ui/Zustand*.kt`, `zustand/ui/AppViewModel.kt`, `MainActivity.kt`
**Test:** `ResultAndStateSplitTest`

`AppUiState` hält nur noch, was App-weit gilt: Sitzung, Einstellungen, Sets,
Dashboard-Zahlen, Barcode-Dialog. Alles Bereichsspezifische hat einen eigenen
Flow — `PartsUiState`, `FinanceUiState`, dazu die schon länger getrennten
`CatalogUiState`, `SetDetailUiState`, `ManualItemDetailUiState`,
`CsvImportUiState`.

Der Grund ist immer derselbe: Ein Flow rekomponiert **alle** seine
Sammelstellen. Lag `partsLoading` im Haupt-State, rekomponierte jedes
Blättern durch die Teileliste auch Galerie und Navigationsleiste.

Zwei Folgeregeln:
- `MainActivity` sammelt **nicht** den ganzen Zustand für das Design, sondern
  `vm.appTheme` (abgeleitet, `distinctUntilChanged`). An der Wurzel der
  Composition ist ein breiter Flow am teuersten.
- `logout()` muss **jeden** dieser Flows zurücksetzen. Ein vergessener Flow
  zeigt dem nächsten Nutzer auf demselben Gerät fremde Daten.

## Zielplattform SDK 36

**Dateien:** `app/build.gradle.kts`, `AndroidManifest.xml`
**Test:** `TargetSdkConfigTest`

`compileSdk` und `targetSdk` stehen beide auf 36 und werden bewusst
gleichgezogen: Ein höherer `compileSdk` wäre erlaubt, verdeckt aber, welche
Verhaltensänderungen tatsächlich aktiv sind. `minSdk` ist 30 (Android 11, siehe
`TargetSdkConfigTest`): Darunter gibt es keine Sicherheitsupdates mehr.

Der Sprung ist deshalb harmlos, weil die App zwei Dinge **nicht** tut:

- **Kein eigener `BackHandler`.** Vorhersagendes Zurückwischen ist unter 36
  standardmässig an; Zurück liegt komplett bei der Navigation-Compose-
  Voreinstellung. Kommt später ein `BackHandler` dazu, muss die Wischgeste auf
  einem Gerät nachgeprüft werden — der Test schlägt dann an und sagt das.
- **Kein `screenOrientation`, kein `resizeableActivity`.** Beides würde unter
  36 auf grossen Displays ignoriert; die Attribute würden nur eine Erwartung
  wecken, die das System nicht mehr erfüllt.

Edge-to-edge war schon unter 35 erzwungen und ändert sich nicht.

**Offen:** 16-KB-Speicherseiten. Die nativen Bibliotheken kommen aus CameraX
1.3.4, ML Kit und DataStore — Fassungen, die älter sind als die
16-KB-Ausrichtung. `useLegacyPackaging = true` löst das nicht. Betrifft nur
Geräte mit 16-KB-Seiten; eine Aktualisierung von CameraX berührt den
Kamera-Autofokus und gehört deshalb in eine eigene Runde mit Gerätetest.

## 16-KB-Speicherseiten

**Dateien:** `gradle/libs.versions.toml`, `app/build.gradle.kts`,
`AndroidManifest.xml`
**Test:** `SixteenKbAlignmentTest`

Vier native Bibliotheken lagen im APK, alle 4-KB-ausgerichtet. Stand:

| Bibliothek | Quelle | Lösung |
|---|---|---|
| `libimage_processing_util_jni.so` | CameraX | 1.6.1 (ab 1.4.0 ausgerichtet) |
| `libbarhopper_v3.so` | ML Kit | unbundled → nicht mehr im APK |
| `libdatastore_shared_counter.so` | DataStore | 1.1.7 |
| `libandroidx.graphics.path.so` | Compose | graphics-path 1.1.0 — am APK prüfen |

Drei Fallen, die alle mit einer Zeile wieder aufgehen:

- **ML Kit bleibt unbundled.** Das gebündelte `com.google.mlkit:barcode-scanning`
  war auch in 17.3.0 noch unausgerichtet. Beim unbundled Paket liegt das
  Modell in den Play-Diensten und kommt gar nicht erst ins APK. Preis:
  Play-Dienste nötig, Modul wird geladen — der `meta-data`-Eintrag
  `com.google.mlkit.vision.DEPENDENCIES` zieht das auf die Installation vor,
  sonst wäre der erste Scan ohne Netz nicht möglich.
- **DataStore bleibt auf 1.1.7.** 1.2.0 ist wieder unausgerichtet — die
  Ausrichtung ist dort zurückgefallen. Deshalb per `resolutionStrategy.force`
  festgenagelt, nicht bloss deklariert: Eine transitive Anhebung würde es
  still kaputt machen.
- **`useLegacyPackaging` bleibt `false`.** Legacy Packaging komprimiert die
  `.so`-Dateien und entpackt sie bei der Installation — an der ELF-Ausrichtung
  im Bibliothekskörper ändert das nichts, es verschiebt das Problem nur aus
  dem Archiv ins Dateisystem. Unkomprimiert richtet AGP ab 8.5.1 auf 16 KB aus.

`graphics-path` wird **direkt** deklariert, nicht transitiv über Compose
bezogen. Es hat eine eigene Versionslinie (aktuell 1.1.0), während die
Compose-BOM von 2024.09.03 eine 1.0.x zieht. Der direkte Eintrag hebt nur
diese eine Bibliothek — ein BOM-Sprung wäre eine breite Änderung quer durch
die gesamte Oberfläche und hier nicht nötig.

Ob 1.1.0 die Ausrichtung wirklich behebt, ist nicht belegt; das zeigt erst das
fertige APK. Compose selbst zu ersetzen ist **kein** gangbarer Weg: Die
Oberfläche besteht aus rund 9.000 Zeilen und 86 Composables — ein Umbau stünde
in keinem Verhältnis zu einer 40 KB grossen Bibliothek.

**Prüfen lässt sich das Ergebnis nur am fertigen APK**, nicht am Quelltext:
`check_elf_alignment.sh` aus dem NDK, oder der APK Analyzer in Android Studio.

## CameraX 1.6.x — Provider absichern, Autofokus unangetastet

**Dateien:** `gradle/libs.versions.toml`, `sammlung/ui/screens/BarcodeScannerScreen.kt`,
`anmeldung/ui/screens/SetupQr.kt`
**Test:** `CameraXUpgradeTest`

CameraX steht auf 1.6.1. Zwei Dinge gehören dazu:

**`future.get()` gehört ins try.** Ab 1.4.0 prüft CameraX strenger, ob die
Kamera verfügbar ist, und wirft, wenn sie belegt oder defekt ist — unter 1.3.4
gab es diese Prüfung nicht. Das `try` umschliesst den **gesamten** Listener,
nicht nur `bindToLifecycle`.

**Der Autofokus bleibt, wie er ist.** 1.6.0 hat den Unterbau auf CameraPipe
umgestellt; der Autofokus hängt über `Camera2Interop` direkt daran. Die Regel
ist unverändert: `CONTROL_AF_MODE_CONTINUOUS_PICTURE` an Preview UND
ImageAnalysis, kein getakteter Fokus-Trigger. Wer hier etwas ändert, muss auf
einem Gerät gegenprüfen — der Test fängt nur die Form, nicht das Verhalten.

**Nicht auf RGBA umstellen.** Die Analyse läuft auf `YUV_420_888` und reicht
das `mediaImage` direkt an ML Kit. Bei RGBA lädt CameraX zusätzlich
`libimage_processing_util_jni.so` — dieselbe Bibliothek, um die es beim
16-KB-Thema geht — und kostet Rechenzeit je Bild.

**Erledigt:** `libbarhopper_v3.so` ist weg — ML Kit läuft unbundled (siehe
Abschnitt "16-KB-Speicherseiten"). Der Google Code Scanner wäre der falsche
Weg gewesen: Er gäbe die Doppelbestätigung im Scanner auf.

## Wie man das prüft

```
./gradlew test
```

Läuft ohne Android-Gerät. Die Kamera-Prüfungen lesen nur die Quelldateien.

## Preisverlauf-Diagramm: Nullen und Zeitachse

**Dateien:** `gemeinsam/ui/PriceChartMath.kt`, `gemeinsam/ui/SetDetailComponents.kt`
**Test:** `PriceChartMathTest`

Der Server liefert fertige Diagrammreihen mit **gemeinsamer** x-Achse. Kürzere
Reihen sind vorne mit `0` aufgefüllt, damit alle Reihen gleich lang sind.

1. Eine `0` vor `firstRealIndex` heisst **„kein Wert"**, nicht „Preis null".
   Wer sie zeichnet, erhält eine Linie, die bei null beginnt und senkrecht
   hochspringt — das sieht aus wie ein Kurssturz, den es nie gab.

2. Die x-Position kommt vom **Datum**. Indexbasiert (`i / (n-1) * width`)
   werden zwei unterschiedlich lange Reihen beide über die volle Breite
   gestreckt; Punkte aus verschiedenen Monaten liegen dann übereinander. Für
   viele Sets setzen Gebrauchtpreise später ein als Neupreise — das ist der
   Normalfall, nicht die Ausnahme.

3. **Eine** Skala für beide Linien. Der interessante Vergleich ist der Abstand
   zwischen Neu und Gebraucht; getrennte Skalen machen genau den unsichtbar.

Beides sieht im Fehlerfall wie eine echte Preisbewegung aus — deshalb liegt die
Rechnung Compose-frei in einer eigenen Datei und nicht im Canvas-Block.

## Bewertung hängt an der Erfassung, nicht am Set

**Dateien:** `finanzen/ui/screens/FinanceScreen.kt`, `model/data/model/FinanzModels.kt`
**Test:** `PriceHistorySerializationTest`

Ein Set hat **keinen** einzelnen Zustand für die Bewertung. Jede Erfassung wird
mit dem Marktpreis ihres eigenen Zustands bewertet; der Server liefert die
Zeilen fertig (`acquisitions` in der Bewertungsantwort).

Nicht in der App nachrechnen — auch nicht „nur schnell" für eine Summe. Die
Regel lebt in `utils/setValue.ts` im Manager; eine zweite Fassung hier wäre
genau die Doppelung, an der in diesem Projekt schon mehrere Zahlen
auseinandergelaufen sind.

## Rollpositionen werden ausdrücklich wiederhergestellt

**Dateien:** `ui/ScrollMemory.kt` (Helfer), `app/nav/CollectionGraph.kt`,
`app/nav/ToolsGraph.kt`
**Test:** `ListScrollPositionTest`

Jeder Reiter mit einer Liste ruft `ScrollPositionKeeper(...)` in seinem
Navigationsziel auf. Der Helfer schreibt die Position mit und springt beim
Betreten ausdrücklich mit `scrollToItem(index, offset)` zurück.

Ein hochgezogener `LazyGridState` allein reicht NICHT. Das Objekt überlebt zwar
den Ausflug in die Detailseite, das Raster misst beim Wiederanhängen aber nicht
zuverlässig dieselbe Stelle heraus — die Liste landet „verschoben". Die
hochgezogenen Zustände bleiben trotzdem, weil der Helfer eine stabile
Objektreferenz braucht.

Im Helfer gilt eine **Reihenfolge**, und beide Fallen sind hier schon einmal
zugeschnappt:

- Der Merker (`wiederhergestellt`) ist `remember`, **nie** `rememberSaveable`.
  Als Saveable überlebt er den Ausflug und schaltet die Wiederherstellung nach
  dem ersten Betreten dauerhaft ab.
- Der Melder hängt am Merker. Ein frisch angehängtes Raster steht auf null, und
  `snapshotFlow` gibt diesen Wert sofort heraus.
- `wiederhergestellt = true` steht **nach** dem `scrollToItem`.

Die Position lebt in einer schlichten Karte im ViewModel, **nicht** in einem
StateFlow: Sie ändert sich bei jeder Rollbewegung, und im beobachteten Zustand
würde der ganze Bildschirm bei jedem Bildlauf neu zusammengesetzt.

Bei einem **Filterwechsel** muss `scrollMemory.vergiss(...)` gerufen werden —
die alte Stelle zeigt sonst auf Einträge, die es so nicht mehr gibt.

## Scroll-Zustände von Listen liegen ausserhalb ihres Navigationsziels

**Dateien:** `AppNavigation.kt`, `app/nav/CollectionGraph.kt`, `app/nav/ToolsGraph.kt`
**Test:** `ListScrollPositionTest`

Führt eine Liste in eine Detailansicht, gehört ihr `LazyGridState` /
`LazyListState` **oberhalb des NavHost** angelegt und als Parameter
hereingereicht — nicht per `rememberLazyGridState()` im Screen selbst.

Grund: Die Detailansicht ist ein eigenes Navigationsziel. Beim Wechsel verlässt
die Liste die Komposition, und ein Zustand, der im Ziel entsteht, beginnt bei
der Rückkehr wieder bei null. Für den Benutzer sieht das so aus, als hätte die
App die Stelle vergessen, an der er war.

Betroffen und so gelöst: Galerie, Teile, Minifiguren (Raster), Finanzen und
Teileliste (Spalten).

Der Auslöser muss keine Detailseite sein — jedes Verlassen des Ziels zählt. Bei
der Teileliste ist es der Barcode-Scanner.

**Vollständigkeit:** `ListScrollPositionTest` zählt die Reiter. Kommt einer dazu,
der einen Rollbereich hat, wird die Prüfung rot, bis er eingetragen ist. Diese
Zählung gibt es, weil derselbe Fehler dreimal einzeln gemeldet werden musste.

**Eine bewusste Ausnahme:** Der Katalog führt alle `total` Plätze und lädt
seitenweise nach; ausserdem muss die Position bei einem Filterwechsel auf null
zurück, weil sie sonst auf Sets zeigt, die es in der neuen Liste nicht gibt.
Er merkt sich die Position deshalb im ViewModel und springt einmal zurück,
sobald die Länge steht (`CatalogScreen.kt`). Nicht „vereinheitlichen".

Dort gilt zusätzlich eine **Reihenfolge**: erst zurückspringen, DANN wieder
melden.

- Der Merker (`wiederhergestellt`) ist `remember`, **nie** `rememberSaveable`.
  Als Saveable überlebt er den Ausflug in die Detailseite — und schaltet die
  Wiederherstellung nach dem allerersten Betreten für immer ab.
- Der Melder hängt am Merker. Ein frischer `LazyGridState` steht auf null, und
  `snapshotFlow` gibt diesen Wert sofort heraus; läuft der Melder ungebremst,
  überschreibt er die gemerkte Position, bevor jemand sie lesen kann.
- `wiederhergestellt = true` steht **nach** dem `scrollToItem`, nicht davor.

## Bildschirme sind zustandslos, Routen kennen das ViewModel

**Dateien:** `*/ui/screens/*`, `*/ui/dialogs/*`, `*/ui/viewmodel/*Aktionen.kt`
**Test:** `ScreenViewModelWiringTest`

Nur ein Composable, dessen Name auf `Route` endet, nimmt ein ViewModel. Die
Route sammelt die Flüsse und reicht eine Zustandsklasse und eine
`…Aktionen`-Schnittstelle weiter, die das ViewModel umsetzt. Feature-Bildschirme
holen sich kein ViewModel per `hiltViewModel()` oder `aktivitaetsViewModel()`.

Grund: So lässt sich jeder Bildschirm mit festem Zustand und einer Attrappe
zeigen und prüfen (Vorschau, Roborazzi), ohne Hilt und Server.

**Ausnahme, bewusst:** Navigations-Rückrufe und Rollzustände bleiben Parameter.
Nur der Navigationsgraph kennt den NavController.

## Der Navigationsaufbau baut Navigation

**Dateien:** `AppNavigation.kt`, `ui/dialogs/`
**Test:** `NavigationHostSizeTest`

`BrickInventoryManagerApp()` hält die Scroll-Zustände, ein paar
`LaunchedEffect`s und den NavHost. Dialoge gehören **nicht** hinein — sie
bekommen eine eigene Datei unter `ui/dialogs/`.

Der **Aufruf** bleibt im Navigationsaufbau, samt seiner Bedingung
(`if (state.barcodeResult != null)`). Damit steht an genau einer Stelle, WANN
ein Dialog erscheint; das WIE steht in seiner eigenen Datei.

Grund: Die Funktion war 277 Zeilen lang, wovon rund fünfzehn der eigentliche
NavHost waren — den grössten Block machte ein Erfassungsformular aus. Wer an
der Navigation etwas ändern wollte, las erst daran vorbei. Dasselbe Muster
hatte das Webfrontend in `js/07-admin.js`.

Dialoge lesen ihren Zustand selbst vom ViewModel, wie die Reiter-Bildschirme.

## Grosse Bildschirme werden in Abschnitte geteilt

**Dateien:** `*/ui/screens/*Sections.kt`
**Test:** `ScreenSectionSplitTest`

Ein Bildschirm-Composable bleibt unter 300 Zeilen. Seine Abschnitte stehen in
einer `*Sections.kt`-Datei daneben.

**Listenabschnitte sind `fun LazyListScope.x(…)`, nicht `@Composable`.** Sie
tragen `item { … }` in eine LazyColumn ein; als @Composable liessen sie sich
dort gar nicht aufrufen. Nur Abschnitte in einer gewöhnlichen `Column` (Katalog)
sind @Composable.

**Zustand, den ein Abschnitt SETZT, wird als `MutableState` übergeben** — der
Bildschirm hält ihn dann als `val x = remember { mutableStateOf(…) }` statt per
`by`. Als Wert übergeben wäre es eine Kopie, und die Zuweisung ginge ins Leere.
Betrifft `detailRetryState`, `activeCategory` und die drei Katalog-Blätter.

**Beim Herauslösen:** Den Rumpf WORTGLEICH übernehmen und nur die Einrückung
ändern. Die Parameterliste aus den freien Namen des Blocks bestimmen. Und danach
prüfen, dass jede Codezeile des Originals genau einmal wieder vorkommt — ein
Schnitt, der mitten durch ein `if (…) {` läuft, fällt sonst erst dem Compiler
auf.

**Der Barcode-Scanner** ist entlang derselben Regel geteilt: Die
Bildanalyse-Schleife steht in `BarcodeAnalyzer.kt`, die Kamera-Vorschau bleibt
im Bildschirm. Die Kamerasteuerung (`_kameraCtrl`) gehört zur VORSCHAU — sie
wird erst beim Binden gefüllt.

**Beim Aufteilen einer Datei die WILDCARD-Importe mitnehmen.** Eine
herausgelöste Datei erbt `androidx.compose.material3.*`,
`androidx.compose.material.icons.filled.*` und so weiter von ihrer Quelle.

Grund: Wer nur die Einzelimporte vergleicht, sieht die per Wildcard gedeckten
Namen gar nicht — sie können also nicht als fehlend auffallen. Genau daran ist
der Build in Nachtrag 100 gescheitert (`Unresolved reference 'ArrowDropDown'`).
`SplitFileImportsTest` prüft beides in Millisekunden; der Gradle-Lauf, der
denselben Fehler findet, braucht Minuten.

**Beim Aufteilen auf `private` achten.** `private` gilt in Kotlin DATEIWEIT. Ein
Block, der in eine andere Datei wandert, verliert den Zugriff auf alle privaten
Nachbarn seiner Quelle — ohne dass sich an Namen oder Importen etwas ändert.

Die Antwort ist `internal` an der Deklaration: sichtbar im Modul, weiterhin
nicht Teil einer öffentlichen Schnittstelle. Betrifft `ThemeRow`, `sortLabel`
(CatalogScreen) und `BricksetQueueRow` (MonitoringSections).

`SplitFileImportsTest` prüft das mit; keine Import-Prüfung kann es sehen, weil
es eine reine Sichtbarkeitsfrage ist.

**Beim Aufteilen auch `@OptIn` mitnehmen.** Die Annotation steht an der
DEKLARATION (oder mit `@file:` an der Datei) — ein herausgelöster Block erbt sie
nicht. Betrifft `ModalBottomSheet`, `TopAppBar`, `PullToRefreshBox`,
`combinedClickable`, `stickyHeader`, `FlowRow` und Verwandte.

Damit sind es DREI Dinge, die eine Aufteilung mitnehmen muss und die keine
Import-Prüfung sieht: die Wildcards der Quelle, die Sichtbarkeit (`private` →
`internal`) und die Opt-ins. Alle drei prüft `SplitFileImportsTest`.

**ViewModel-Erweiterungen:** Es gibt keine mehr (kein `fun AppViewModel.x`); die
Feature-Funktionen sind Methoden der Bereichs-ViewModels. Der Erweiterungs-Import
entfällt, die Zählung unten stammt aus der Zeit davor.

Damit sind es VIER Dinge, die eine Aufteilung mitnehmen muss und die keine
gewöhnliche Import-Prüfung sieht: die Wildcards der Quelle, die Sichtbarkeit
(`private` → `internal`), die Opt-ins und die Erweiterungs-Importe. Alle vier
prüft `SplitFileImportsTest`.

**Fünftens: Parametertypen sind zu PRÜFEN, nicht zu schätzen.** Beim Aufteilen
entsteht für jeden freien Namen ein Parameter — und dessen Typ steht in der
Quelldatei, nicht im Bauchgefühl. Drei Fallen, alle in Nachtrag 104 eingetreten:

- Ein lokales `fun fmtPrice(v: Double?)` wird als Parameter zu
  `fmtPrice: (Double?) -> String`, und der Aufruf braucht `::fmtPrice`.
  Ohne `::` meldet Kotlin „Function invocation expected".
- Ein früher Ausstieg (`if (valuation == null) return`) erzeugt einen
  SMART-CAST. Der Rumpf darunter greift ohne `?.` zu — die Signatur muss also
  den NICHT-nullbaren Typ verlangen, nicht `?`.
- Nullbarkeit nachschlagen statt annehmen: `authToken` ist `String`, nicht
  `String?`; `pnlPct` ist `String?`, nicht `Double?`.

**Sechstens: Importe nicht raten.** Beim Erzeugen einer neuen Datei entsteht die
Versuchung, für einen unbekannten Namen einen plausiblen Import zu schreiben —
`import ch.brickinventoryapp.util.fmtPrice` gibt es nicht, dort heissen die
Funktionen `fmtMoney`, `fmtMoneyOrDash` und `fmtInt`. `SplitFileImportsTest`
prüft, dass jeder projekteigene Import ein Ziel hat.

## Endlos-Scroll: Sperre vor dem launch, Schlüssel beim Anhängen sieben

**Datei:** `sammlung/ui/Galerie.kt` · **Test:** `GalerieTest` („zwei Nachlade-Aufrufe im selben Takt holen Seite 2 nur einmal“)

Der Auslöser hängt an einem `snapshotFlow`, dessen `LaunchedEffect` bei jeder
Änderung von `sets.size` neu startet und sofort wieder auswertet — beim
schnellen Wischen feuert er mehrfach im selben Frame.

`galleryLoadingMore` wird deshalb **synchron vor dem `launch`** gesetzt. Steht
es innerhalb der Koroutine, lesen zwei Aufrufe im selben Frame beide `false`
und fordern DIESELBE Seite an.

Und beim Anhängen werden bekannte `setNumber` ausgesiebt. Ein doppelter
Schlüssel in `items(sets, key = …)` lässt LazyVerticalGrid eine Position auf das
ERSTE Vorkommen auflösen — die Liste springt dann auf immer dieselbe Zeile,
auch beim Zurückkehren aus der Detailansicht.

Wer die Sperre vor dem `launch` setzt, muss sie in JEDEM Ausgang wieder lösen —
auch bei der verworfenen Antwort nach einem Filterwechsel.

## In verschlüsselten Listen hat jeder Eintrag einen Schlüssel

**Test:** `LazyGridItemKeyTest`

Stehen `items(…, key = { … })` und ein `item { … }` OHNE Schlüssel in derselben
Liste, bekommt der schlüssellose einen Ersatz aus seinem INDEX. Wächst die
Liste, wechselt dieser Ersatz — für das Raster verschwindet ein Eintrag und ein
anderer erscheint.

Betraf den Lade-Eintrag der Galerie und den der Teile-Liste. Die Kopfzeilen in
Teilen und Minifiguren hatten längst welche (`key = "manual-header"`).

## Ein Abschluss ist ein ÜBERGANG, kein Zustand

**Datei:** `zustand/ui/viewmodel/CsvImportViewModel.kt` · **Test:** `CsvStatusReloadTest`

`handleCsvStatus()` lädt die Daten nur nach, wenn vorher tatsächlich ein Import
LIEF. Der SSE-Strom meldet den Status fortlaufend, auch lange nach dem
Abschluss — „läuft gerade nicht" trifft dann dauerhaft zu.

Vorher lief deshalb alle paar Sekunden ein `loadSets()`, das die Galerie durch
Seite 1 ersetzte; das Raster landete auf der letzten noch vorhandenen Zeile.
Genau der Rücksprung, den Marco über Wochen beobachtete.

Der Wächter `csvFinishing` half nicht: Er wird nach fünf Sekunden freigegeben —
im Takt der Meldungen.

Denselben Fehler gab es zweimal im Manager: beim Takt der Anleitungs-Schlange
(Nachtrag 142) und beim Bild-Job (217). Eine Handlung hing an einem ZUSTAND
statt an dem Ereignis, das sie auslösen soll.

## Erfassungen: zwei Preisfelder, ein Erzeuger je Art

**Datei:** `model/data/model/HaushaltModels.kt` · **Test:** `KaeufeViewModelTest` („ein Set schickt purchase_price, Teile und Figuren unit_price“)

Der Server liest das Preisfeld unter dem Namen der jeweiligen SPALTE:

    Sets                    → purchase_price
    Teile und Minifiguren   → unit_price

`UpdateAcquisitionRequest` trägt beide Felder. Gebaut wird der Rumpf
ausschliesslich über `fuerSet()` bzw. `fuerStueck()` — jeder setzt genau eines,
das andere bleibt null und wird nicht mitgeschickt.

Grund: Die App schickte für alles `purchase_price`. Bei Teilen und Minifiguren
fand der Server damit gar kein Preisfeld und liess den Preis stehen — ohne
Fehler. Es wirkte wie „wird nicht gespeichert".

## Barcodescanner: genau EIN Touch-Listener

**Datei:** `sammlung/ui/screens/BarcodeScannerScreen.kt` · **Test:** `CameraFocusConfigTest`

`setOnTouchListener` fügt nicht hinzu, es ERSETZT. Stehen zwei auf derselben
`previewView`, gewinnt der zuletzt gesetzte — und welcher das ist, hängt davon
ab, wann der Kamera-Rückruf eintrifft.

Der gewollte Listener steht in der `factory` und nutzt `disableAutoCancel()`.
Ohne das fällt die Kamera nach wenigen Sekunden auf ihre eigene Wahl zurück:
Man tippt, es wird scharf, und gleich darauf ist es wieder weg.

`CONTROL_AF_MODE_CONTINUOUS_PICTURE` steht an BEIDEN Use Cases — seit Nachtrag
99 in zwei Dateien (Vorschau im Screen, Analyse in `BarcodeAnalyzer.kt`).

## Erfolgloser Scan → manuelle Erfassung

**Feld:** `AppUiState.manuelleErfassungAnfordern` · **Test:** `ManualEntryAfterScanTest`

Vier Wege enden ohne Setnummer und setzen das Feld: EAN nicht auflösbar, EAN
ohne Setnummer, Texterkennung ohne Treffer, Katalogabfrage gescheitert. Alle
vier liegen im ViewModel — kein Bildschirm muss sie einzeln kennen.

Wer den Scanner einbindet, liest das Feld, öffnet SEINE Erfassung und
QUITTIERT (`manuelleErfassungQuittieren()`). Ohne Quittierung geht die
Erfassung beim nächsten Zusammensetzen erneut auf.

Die Galerie öffnet ihren Dialog; die Teileliste hat keinen und setzt stattdessen
den Cursor in ihr Eingabefeld.

**Das Erfassen-Formular setzt den Cursor immer ins Set-Feld** — über
`LaunchedEffect(Unit)`, das bei jeder Anzeige genau einmal läuft, mit kurzer
Pause, weil das Feld beim ersten Durchlauf noch nicht angeordnet ist.

## Reiter antippen fängt oben an, Zurückkehren behält die Stelle

**Dateien:** `MainScaffold.kt`, `ui/ScrollMemory.kt` · **Test:** `TabOpensAtTopTest`

Der Scroll-Merker ist für das ZURÜCKKEHREN aus einer Detailansicht da. Beim
Antippen eines Reiters in der unteren Leiste wird seine Position VERWORFEN
(`vergissReiter(route)`) — sonst öffnet sich der Reiter irgendwo in der Mitte,
und die manuell erfassten Einträge ganz oben sind nicht zu sehen.

Unterschieden wird in der unteren Leiste, denn nur dort ist der Unterschied
bekannt: Im Bildschirm sehen beide Fälle gleich aus.

Der Aufruf muss VOR der Navigation stehen — danach kann der Bildschirm die alte
Stelle bereits gelesen haben. Und JEDE `MainScaffold`-Einbindung reicht den
Rückruf durch, sonst hinge es davon ab, über welchen Reiter man kommt.

Die Routennamen sind zugleich die Schlüssel des Merkers (`gallery`, `parts`,
`minifigs`, `finance`) — eine zweite Zuordnungstabelle wäre eine zweite
Wahrheit.

## Fehlermeldungen entstehen an einer Stelle

Die Datenschicht (`BrickRepository`, `CsvImportSseClient`) formuliert KEINE
Sätze für den Nutzer. Sie hat keinen `Context` und kann nicht übersetzen — jeder
Satz, den sie selbst bildet, ist für die halbe Nutzerschaft in der falschen
Sprache. Sie meldet stattdessen die Art des Fehlers (geschlossene Hierarchie
`Ergebnis.Error`: Netz, Zeitueberschreitung, Abgebrochen, LeereAntwort,
Abgewiesen, Server, Klartext, Unbekannt); den Satz bildet `AppTexte.meldung()`.

Vorrang hat immer die Meldung des SERVERS. Er kennt seine Fälle genauer als
jede Aufzählung in der App (Kaufdatum-Konflikt, Währung passt nicht, Code schon
eingelöst) und antwortet in der Sprache des Kontos. Nur wenn er keine schickt,
formuliert die App selbst. `Result.Error.message` leer heisst deshalb nicht
„kein Fehler", sondern „kein Text vom Server".

Zwei Felder sind ausdrücklich NICHT für die Anzeige:
`Result.Error.technisch` und `CsvImportSseClient.Event.Failed.technisch` tragen
Bibliothekstexte („unexpected end of stream"), die englisch sind und mit der
Bibliotheksversion wechseln. Sie gehören ins Log.

Gesichert durch `ErrorMessageLayerTest` und `AppTexteTest`.

## Der gemeinsame Zustand hat Domänengrenzen

`AppUiState` ist ein gemeinsames Objekt, aber kein Freibrief: Jede
Feature-Datei schreibt nur die Felder ihrer eigenen Domäne. `isLoading` und
`error` sind querschneidend und für alle offen — sie sind auch der Grund,
warum es das gemeinsame Objekt noch gibt.

Vier Übergriffe sind erlaubt und stehen mit Begründung in
`StateDomainBoundaryTest`. Wächst diese Liste, ist das das Signal, das
betroffene Feld in einen eigenen Zustand zu ziehen — so ist es bei Teilen,
Finanzen, Katalog und Haushalt auch gelaufen. Ein zweiter Test schlägt an, wenn
eine Ausnahme nicht mehr gebraucht wird: Eine Erlaubnis, die niemand mehr
braucht, ist eine Erlaubnis, die niemand mehr prüft.

## Bewusst nicht gemacht

Damit der nächste Durchgang nicht dieselben Fragen neu aufwirft:

- **Kein `SavedStateHandle`.** Nach Prozesstod sind Filter und Rollposition
  weg. Alles lädt ohnehin vom Server nach, und der Scroll-Merker ist eine
  Bequemlichkeit innerhalb einer Sitzung — nicht etwas, das einen Prozesstod
  überleben muss.
- **Kein detekt/ktlint.** Beide koppeln an die Kotlin-Version; ein Sprung von
  Kotlin bricht sonst den Build an einer Stelle, die mit dem Code nichts zu tun
  hat. Bei diesem Kommentaranteil ist der Zusatznutzen klein. Falls doch: nur
  mit `ignoreFailures`, damit es meldet statt blockiert — wie lint es hier
  schon tut.

## Daten auf dem Gerät

Datenklassen und wo sie liegen. **Geheim** heisst: Wer es hat, handelt im Namen
des Nutzers oder löst Geld ein. **Vertraulich** heisst: privat, aber ohne
Handlungsmacht.

| Klasse | Inhalt | Ablage |
|---|---|---|
| geheim | Token | nur AES-GCM mit Keystore-Schlüssel (`TokenTresor`) |
| geheim | Gutschein-PIN, Passwörter, TOTP-Schlüssel, Wiederherstellungscodes | **nie** auf der Platte; die PIN wird vor dem Ablegen entfernt (`GutscheineRepository.ohneGeheimnis`), ein Gutschein-PDF liegt nur im Speicher (memfd, `PdfViewerScreen`) |
| vertraulich | Sets, Teile, Figuren, Merkliste, Bewertungen, Gutschein-Nummer und -Betrag (Room `bestand.db`), Ausgang | SQLCipher |
| vertraulich | API-Antworten, Widget-Zahlen, Vorschaubilder, Bild-Zwischenspeicher, Bauanleitungen | `AblageChiffre` (AES-GCM, Schlüssel aus dem Keystore umhüllt); Anleitungen angezeigt aus memfd oder namenloser Datei |
| vertraulich | Teileliste-PDF | Klartext für die Ziel-App, nach 30 Minuten gelöscht |
| Integrität | Zertifikat-Pins, Schalter „Nutzer-CAs vertrauen“ | `Vertrauenschiffre` (AES-GCM, eigener Ablageschlüssel, überlebt das Abmelden); unlesbar heisst „nicht vertraut“ (`VertrauenVerschluesseltTest`) |

Für alle gilt: `allowBackup="false"`, Cloud-Sicherung und Geräteumzug
ausgeschlossen (`NetzsicherheitTest`), beim Abmelden geleert, und jede Ablage
gehört Server und Konto (`CacheBereichTest`). Ein neues Fach in `Bestandsart`
lässt `CacheBereichTest` scheitern, bis es hier eingeordnet ist.

## Restrisiken, bewusst getragen (pruef6)

- **H2 — Pin auf eine System-Wurzel:** Hat der Nutzer beim Erstkontakt ein
  öffentlich gültiges Zertifikat bestätigt, gilt danach jede öffentlich gültige
  Kette für diesen Host, und zwar nur über die System-Prüfung samt Certificate
  Transparency, auch wenn der Server die Wurzel mitschickt (sec11 H6,
  `ZertifikatPinTest`). Sonst fragte die App bei jedem Wechsel der
  Zwischenstelle (Let's Encrypt) neu. Restrisiko: ein fehlausgestelltes, aber
  protokolliertes öffentliches Zertifikat für den Host. Wer das ausschliessen will, betreibt
  eine eigene CA (Caddy `sign_with_root`); deren Pin bleibt an ihren Schlüssel
  gebunden.
- **H7 — keine Root- oder Integritätserkennung:** Die App wird ausserhalb von
  Play verteilt; Play Integrity bestätigte dort nichts Brauchbares, und eine
  Root-Erkennung im Client lässt sich auf einem gerooteten Gerät umgehen. Die
  Geheimnisse sind dafür im Keystore (Token) oder gar nicht auf dem Gerät.
- **H9 — Widget mit Sammlungswert:** Der Nutzer legt es selbst auf den
  Startbildschirm; es zeigt eine Summe, keine Einzelheiten, und wird beim
  Abmelden geleert. Wer den Wert nicht zeigen will, legt es nicht an.
- **QR-Code beim ersten Einrichten (seit sec10 N2 geschlossen):** Ein `fp`
  gilt ohne Abtippen nur als System-Wurzel oder als schon bestätigter Pin;
  sonst die letzten 24 Zeichen aus der Webapp (`AnmeldungViewModel.mussAbtippen`).
- **Schritt-Schutz ohne Displaysperre (sec10 H3):** Es gibt nichts zu prüfen;
  die App warnt darum (`OhneSperreWarnung`), und erst ein „Ungeschützt
  fortfahren“ öffnet den Schritt. Eine Bestätigung gilt 60 s und verfällt,
  sobald die App in den Hintergrund geht.
- **Token-Schlüssel ohne Nutzerauthentisierung (sec10 H1):** Preisalarm,
  Widget, Ausgang und nachgeholte Entwertung lesen das Token im Hintergrund,
  ohne dass jemand entsperren könnte. Wer Code mit der UID der App ausführt,
  kommt an das Token wie die App; dagegen stehen 180 Tage Höchstdauer,
  Rotation und Entwertung beim Abmelden.
- **Eigener Schlüssel für die Update-Beschreibung (sec11 H1):** Kennt die App
  einen Beschreibungsschlüssel (`res/raw/beschreibungs_schluessel.pem`), gilt
  nur dessen Signatur; der APK-Schlüssel signiert dann nichts, was sie als
  Beschreibung annimmt. Bis der Betreiber ihn einrichtet (README,
  „Beschreibungsschlüssel“), gilt der Übergangsweg über die Signierer der App.
  Auf dem Runner liegen beide nur verschlüsselt und werden nach dem Schritt
  gelöscht. Solange das Secret `BESCHREIBUNG_SCHLUESSEL` fehlt, warnt der
  Release-Lauf (sec12 H1); einrichten muss es der Betreiber.
- **Unsignierte `version.json` bis 01.02.2027 (sec12 H3):** nur für Fassungen vor
  sec8 N4, die die signierte Beschreibung nicht kennen. Die Frist wird nicht
  verlängert; danach löscht der Release-Lauf den Anhang selbst.
- **Teileliste 30 Minuten im Klartext (sec12 H4):** Die Ziel-App liest sie über
  den FileProvider und kann keinen Geheimtext lesen; gelöscht nach der Frist,
  beim Start und beim Abmelden.
- **Token-Schlüssel bei gesperrtem Gerät (sec12 H7), keine RESILIENCE-Prüfungen
  (sec12 H10):** Begründung in README, „Daten auf dem Gerät“ und
  „Manipulationsschutz“. Pins liegen seit sec12 H6 verschlüsselt; wer Code mit
  der UID der App ausführt, kann den Keystore aber weiterhin benutzen wie die App.
- **Anleitung in einer namenlosen Datei (sec12 N1):** Über 64 MB wird zur Anzeige
  in eine Datei entschlüsselt, deren Name vor dem ersten Byte gelöscht ist. Der
  Klartext liegt dann in freien Blöcken des (dateibasiert verschlüsselten)
  Speichers, erreichbar nur über den offenen Deskriptor. Ein memfd dieser Grösse
  kostete Arbeitsspeicher, den das System der App mit einem Kill zurückholte.
- **Endmarker im verschlüsselten Dateisystem (sec12 H9):** Jeder flush schliesst
  mit einem Marker ab, weil OkHttp sein Journal nach jeder Zeile flusht und nie
  schliesst. Eine Kürzung genau auf einen früheren flush bleibt darum unentdeckt;
  sie setzt nur das Journal auf einen älteren Stand zurück. Ein Zähler oder die
  Länge im Marker hülfe nicht (sec13 H7): Der frühere Marker trug den Stand, der
  damals galt, und nach einem Absturz muss genau dieser Stand lesbar sein. Erkennen
  liesse sich die Kürzung nur mit einer zweiten Ablage je Datei, die bei jedem flush
  mitgeschrieben wird. Ein zurückgesetztes Journal ist für OkHttp ein Absturzfall
  (fehlende Einträge sind Fehltreffer); eine gekürzte Anleitung ist kein gültiges PDF mehr.

## Token nur an die eigene Herkunft

Ein Token geht nur an die Herkunft (Schema, Host, Port), die ihn ausgab
(`netz/di/ServerWaechter.kt`, Modul `core-netz`). Was eine Antwort auslöst — Nachfassen mit Token,
Tausch und Wiederholung nach `token_rotation_noetig`, Abmelden, Rechteentzug —
gilt nur der Sitzung, in der die Anfrage hinausging: Der Wächter liest die
Generation der `TokenSchranke` vor dem Token und vergleicht danach; beim
Nachfassen prüft er die Bindung zum Zeitpunkt des Nachfassens neu.
`TokenTausch.noetig` liefert nur einen Token derselben Herkunft und
Generation. Beim Wechsel auf eine andere Herkunft brechen alle Server-Clients
ihre laufenden Aufrufe ab. Umleitungen folgen die Server-Clients nur innerhalb
derselben Herkunft. Liegt der Server unter einem Pfad (`https://host/brick`),
geht der Token nur an Adressen darunter, Umleitungen eigener Anfragen bleiben
darunter, und ein anderer Pfad auf demselben Host gilt als anderer Server
(`NetworkPolicy.imBasisPfad`, `gleicherServer`). Geprüft: `ServerwechselTest`,
`TokenTauschTest` (core-data), `UmleitungTest` und `BasisPfadTest` (core-netz).

Abmelden entwertet den Token am Server. Gelingt das in 3 s nicht (kein Netz,
5xx), geht ein Auftrag mit dem verschlüsselten Token an WorkManager
(`data/Entwertung.kt`, `EntwertungsWorker`), der mit Rückzug wiederholt, bis
der Server bestätigt oder 401 sagt. Ein gesperrter Keystore heisst „später“,
nie „abgemeldet“ (`data/util/Tresorbefund.kt`). Geprüft: `EntwertungTest`,
`TresorSperreTest`.

## Delegierte Zustands-Properties erlauben keinen Smart Cast

Die Reiter-Bildschirme holen ihren Zustand mit
`val state by vm.xyzState.collectAsStateWithLifecycle()`. Das ist ein
DELEGIERTES Property: Jeder Zugriff ruft erneut `getValue()` auf. Der Compiler
kann deshalb nicht garantieren, dass `state.feld` zwischen einer Null-Prüfung
und der Verwendung derselbe Wert ist — und verweigert den Smart Cast:

```
Smart cast to 'String' is impossible, because 'error' is a delegated property
```

Solange der Zustand ein PARAMETER war, ging das durch. Beim Umbau auf das
ViewModel-lesende Muster (Nachtrag 115) fällt es auf.

Der Weg ist, den Wert einmal in eine lokale Variable zu heben:

```kotlin
val fehlertext = state.error
when {
    fehlertext != null -> Text(fehlertext)
}
```

Bewusst NICHT `state.error ?: ""` — das zeigt im Fehlerfall einen leeren Text
und versteckt die Ursache. Wo `!!` schon dasteht (BarcodeResultDialog), ist
nichts zu tun; die Frage stellt sich nur beim Smart Cast.

KEIN Test dafür: Der Versuch, die Stellen per Muster zu finden, hat beim ersten
Lauf fünf Fehlalarme erzeugt (überall dort, wo `!!` bereits stand). Ein Test,
der korrekten Code anmeckert, wird abgeschaltet statt befolgt — hier meldet es
der Compiler ohnehin, und zwar genau.

## Der Barcode-Zustand hat einen eigenen Fluss

Die zwölf Felder rund um Scanner und Barcode-Dialog liegen in
`BarcodeUiState`, nicht in `AppUiState`. Ein Scan erzeugt viele Zwischenstände
(Auflösen der EAN, Sperre gegen den zweiten Klick, Leeren nach dem Erfassen);
lagen sie im gemeinsamen Objekt, rekomponierte jeder davon Galerie, Teile,
Minifiguren und Finanzen mit.

Die Feldnamen tragen den `barcode`-Vorsatz NICHT mehr — innerhalb der Klasse
wäre er eine Wiederholung des Klassennamens. Am Zugriffsort steht dafür
`barcodeState.setName`.

`logout()` setzt auch diesen Fluss zurück. Ohne das trüge ein offener
Barcode-Dialog Setname, Bild und Nummer des vorigen Kontos.
