# Invarianten — bitte vor Änderungen lesen

Kurze Liste von Dingen, die in diesem Projekt schon **mehrfach** kaputtgegangen
sind. Jeder Punkt ist durch einen Test abgesichert; schlägt einer fehl, ist die
Regel verletzt — dann den Code korrigieren, nicht den Test.

## Kamera-Autofokus

**Dateien:** `ui/screens/BarcodeScannerScreen.kt`, `ui/screens/SetupScreen.kt`
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

**Dateien:** `ui/BarcodeFeature.kt`, `ui/UiState.kt`, `AppNavigation.kt`
**Test:** `BarcodeDoubleAddGuardTest`

Der Zwischendialog nach dem Barcode-Scan reagiert träge; Nutzer tippen deshalb
zweimal auf „Hinzufügen", und das Set landete zweimal in der Galerie.

Die Sperre muss im ViewModel liegen: `confirmAddBarcode()` prüft
`_state.value.barcodeAdding` als Erstes und setzt das Flag **synchron vor**
`viewModelScope.launch`. Wandert die Zuweisung in den Coroutine-Block, ist das
Rennen wieder offen — beide Klicks kommen an der Prüfung vorbei, bevor der
erste das Flag setzt.

`enabled = !state.barcodeAdding` am Knopf ist Feedback, **kein** Schutz: Es
greift erst nach der Rekomposition, und genau die ist ja die langsame Stelle.

Jeder Ausgang von `confirmAddBarcode()` sowie `cancelBarcode()` müssen das Flag
zurücksetzen, sonst bleibt der Knopf nach einem Fehler dauerhaft gesperrt.

## Abgelaufene Sitzung (HTTP 401)

**Dateien:** `data/repository/BrickRepository.kt`, `di/AppModule.kt`,
`data/SessionExpiredSignal.kt`, `ui/MainViewModel.kt`
**Test:** `SessionAndLifecycleTest`

Ein 401 ist kein gewöhnlicher Serverfehler. Drei Regeln:

1. `safeCall()` markiert ihn per `unauthorized = true`. Ohne das ist er von
   einem Netzwerkfehler nicht unterscheidbar.

2. **`cached()` darf bei `unauthorized` NICHT auf den Plattenspeicher
   zurückfallen.** Sonst deckt der bis zu sieben Tage alte Cache die
   abgelaufene Sitzung zu: Der Nutzer sieht eine scheinbar normale Galerie,
   obwohl er längst nicht mehr angemeldet ist. Ein Fehlerzustand, der wie
   Normalbetrieb aussieht, ist schlimmer als eine Fehlermeldung.

3. Der Interceptor meldet nur, wenn **ein Token mitgeschickt wurde UND es der
   eigene Server war**. Fällt eine der beiden Bedingungen weg, würde ein
   fehlgeschlagener Login (noch kein Token) oder ein 401 von einem fremden CDN
   den Nutzer ausloggen.

## ImageLoader lebt genau einmal

**Dateien:** `di/AppModule.kt`, `MainActivity.kt`
**Test:** `SessionAndLifecycleTest`

Der ImageLoader gehört ins DI-Modul, nicht in `MainActivity.onCreate()`. Dort
gebaut entsteht bei jeder Bildschirmdrehung eine zweite Instanz auf demselben
Disk-Cache-Verzeichnis, und der Memory-Cache ist jedes Mal leer — alle
sichtbaren Thumbnails werden neu dekodiert.

## Polling hängt am Lifecycle

**Datei:** `ui/screens/MonitoringScreen.kt`
**Test:** `SessionAndLifecycleTest`

`LaunchedEffect` endet erst, wenn der Screen verlassen wird — **nicht** beim
Wechsel in den Hintergrund. Eine getaktete Schleife darin pollt also weiter,
solange die App auf dem Screen liegt. Jede solche Schleife gehört in
`repeatOnLifecycle(STARTED)`.

## Kein zweiter Barcode-Pfad

**Dateien:** `ui/BarcodeFeature.kt`, `ui/UiState.kt`
**Test:** `SessionAndLifecycleTest`

Es gab lange eine komplette, nie aufgerufene Zweitimplementierung des Scanners
(`BarcodeResolver`, `BarcodeResultDialog`, `onBarcodeDetected` &Co.). Darin
steckte ein blockierender `Call.execute()` aus dem `viewModelScope` ohne
`Dispatchers.IO` — die Server-Abfrage hat nie funktioniert, der Fehler wurde
vom umgebenden `catch` verschluckt. Genau so versteckt sich Fehler in totem
Code. Der live genutzte Pfad ist: Scanner-Screen → `vm.resolveBarcode()` →
`repo.resolveBarcode()`.

## Services sind lokalisiert — über den richtigen Context

**Dateien:** `service/CsvImportService.kt`, `service/PdfExportService.kt`,
`service/PdfExportManager.kt`, `util/LanguageManager.kt`
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

**Dateien:** `res/xml/file_paths.xml`, `service/PdfExportManager.kt`
**Test:** `ServicePolishTest`

Über die Provider-Authority wird ausschliesslich das exportierte
Teilelisten-PDF geteilt. `file_paths.xml` deckt deshalb nur `pdf/` ab —
niemals wieder ganze Wurzeln (`path="."`), sonst ist auch der API-Cache
(Inventar im Klartext-JSON) erreichbar. Zwei Seiten derselben Regel: Der
`PdfExportManager` muss ins `pdf/`-Unterverzeichnis schreiben, sonst wirft
`getUriForFile()` eine SecurityException.

## Ein OkHttp-Interceptor-Stack, keine Nebenclients

**Dateien:** `ui/screens/PdfViewerScreen.kt`, `ui/MainViewModel.kt`
**Test:** `ServicePolishTest`

Jeder eigenständig gebaute `OkHttpClient.Builder()` läuft am DI-Interceptor
vorbei: kein Bearer-Token, kein Klartext-Verbot, keine 401-Meldung — jede
Regel müsste dort von Hand nachgezogen werden (und genau so eine
handgepflegte Kopie stand hier bereits). Abweichende Timeouts holt man sich
per `apiHttpClient.newBuilder()`, nicht mit einem neuen Client.

## Kamera-Screens räumen ihre Ressourcen auf

**Dateien:** `ui/screens/BarcodeScannerScreen.kt`, `ui/screens/SetupScreen.kt`
**Test:** `ResourceAndCacheTest`

`remember { }` hat **keinen** Aufräum-Hook. Was darin erzeugt wird und
freigegeben werden muss — hier der Analyse-Executor und der ML-Kit-Client
mit nativen Ressourcen — braucht ein `DisposableEffect(Unit) { onDispose { … } }`.
Ohne das überlebt beides jeden Besuch des Screens.

Die Kamera selbst ist davon nicht betroffen: Sie hängt am `lifecycleOwner`
und wird von CameraX entbunden. Das Aufräumen läuft **nach** dem Verlassen
des Screens und darf den Autofokus nie berühren.

## PDF-Ansichts-Cache mit Budget

**Datei:** `ui/screens/PdfViewerScreen.kt`
**Test:** `ResourceAndCacheTest`

Angesehene Anleitungen bleiben absichtlich liegen (Resume, erneutes Öffnen
ohne Neudownload). Bei Dateien bis 300 MB braucht das eine Obergrenze:
`prunePdfCache()` hält den Cache unter `PDF_CACHE_BUDGET_BYTES`, älteste
zuerst. Die gerade angeforderte Datei ist ausgenommen — sonst löscht das
Aufräumen den Teil-Download, auf dem der Resume-Mechanismus aufsetzen will.

## Abmelden leert beide Caches

**Datei:** `ui/SessionFeature.kt`
**Test:** `ResourceAndCacheTest`

Zum API-Cache gehört der Bild-Cache: Beide enthalten Daten des angemeldeten
Kontos. Memory-Cache **vor** Disk-Cache leeren — sonst schreibt Coil beim
nächsten Speicher-Treffer sofort wieder auf die Platte.

## Ein CSV-Statuspfad, nicht zwei

**Dateien:** `service/CsvImportService.kt`, `data/CsvImportSseClient.kt`
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

## Result hat genau zwei Varianten — kein `else`

**Datei:** `data/repository/BrickRepository.kt`
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

**Dateien:** `ui/UiState.kt`, `ui/MainViewModel.kt`, `MainActivity.kt`
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
Verhaltensänderungen tatsächlich aktiv sind. `minSdk` bleibt bei 26.

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

**Dateien:** `gradle/libs.versions.toml`, `ui/screens/BarcodeScannerScreen.kt`,
`ui/screens/SetupScreen.kt`
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

**Dateien:** `ui/PriceChartMath.kt`, `ui/screens/SetDetailComponents.kt`
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

**Dateien:** `ui/screens/FinanceScreen.kt`, `data/model/Models.kt`
**Test:** `PriceHistorySerializationTest`

Ein Set hat **keinen** einzelnen Zustand für die Bewertung. Jede Erfassung wird
mit dem Marktpreis ihres eigenen Zustands bewertet; der Server liefert die
Zeilen fertig (`acquisitions` in der Bewertungsantwort).

Nicht in der App nachrechnen — auch nicht „nur schnell" für eine Summe. Die
Regel lebt in `utils/setValue.ts` im Manager; eine zweite Fassung hier wäre
genau die Doppelung, an der in diesem Projekt schon mehrere Zahlen
auseinandergelaufen sind.

## Rollpositionen werden ausdrücklich wiederhergestellt

**Dateien:** `ui/ScrollMemory.kt` (Helfer), `nav/CollectionGraph.kt`,
`nav/ToolsGraph.kt`
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

**Dateien:** `AppNavigation.kt`, `nav/CollectionGraph.kt`, `nav/ToolsGraph.kt`
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

## Reiter-Bildschirme lesen ihren Zustand vom ViewModel

**Dateien:** `ui/screens/{Gallery,Parts,Minifigs,Finance}Screen.kt`
**Test:** `ScreenViewModelWiringTest`

Ein Reiter-Bildschirm nimmt `vm: MainViewModel` entgegen und liest Zustand und
Aktionen selbst. Er hat höchstens sechs Parameter.

Grund: Vorher waren es 26 (Galerie), 21 (Finanzen), 20 (Teile) und 15
(Minifiguren). Jede Erweiterung fasste dadurch DREI Dateien an — Screen, Graph,
ViewModel. Beim Kontofilter und beim Scroll-Zustand war das jedes Mal spürbar.
Die schlanke Bauart gab es längst: `ManualItemDetailScreen` und
`AcquisitionManagementScreen` kamen mit sechs bis acht aus.

**Ausnahme, bewusst:** Navigations-Rückrufe (`onSetClick`, `onOpenDetail`,
`onScanBarcode`, `onManualClick`) und der Scroll-Zustand bleiben Parameter. Nur
der Navigationsgraph kennt den NavController; ein Screen, der selbst navigiert,
wäre an seinen Platz im Graphen gebunden.

**Beim Umbauen:** Nur den KOPF tauschen und die Werte unter ihren alten Namen
neu binden. Dann bleibt der Rumpf Zeile für Zeile unverändert — wichtig, solange
Kotlin nicht kompiliert werden kann. `ScreenViewModelWiringTest` hält jeden
`state.X`-Zugriff gegen die Datenklassen in `UiState.kt`; das ist der Ersatz für
den fehlenden Compiler.

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

**Dateien:** `ui/screens/*Sections.kt`
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

**ViewModel-Erweiterungen brauchen `import ch.brickinventoryapp.ui.*`.** Die
Feature-Funktionen (`loadSets`, `setScope`, `addPart`, …) sind Erweiterungen auf
`MainViewModel` im Paket `ch.brickinventoryapp.ui`. Die Screens liegen in
`…ui.screens` — `import …ui.MainViewModel` holt nur die KLASSE, nicht ihre
Erweiterungen.

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

**Datei:** `ui/GalleryFeature.kt` · **Test:** `GalleryLoadMoreRaceTest`

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

**Datei:** `ui/MainViewModel.kt` · **Test:** `CsvStatusReloadTest`

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

**Datei:** `data/model/Models.kt` · **Test:** `AcquisitionPriceFieldTest`

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

**Datei:** `ui/screens/BarcodeScannerScreen.kt` · **Test:** `CameraFocusConfigTest`

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
Sprache. Sie meldet stattdessen eine `Fehlerart`; den Satz bildet
`MainViewModel.meldung()`.

Vorrang hat immer die Meldung des SERVERS. Er kennt seine Fälle genauer als
jede Aufzählung in der App (Kaufdatum-Konflikt, Währung passt nicht, Code schon
eingelöst) und antwortet in der Sprache des Kontos. Nur wenn er keine schickt,
formuliert die App selbst. `Result.Error.message` leer heisst deshalb nicht
„kein Fehler", sondern „kein Text vom Server".

Zwei Felder sind ausdrücklich NICHT für die Anzeige:
`Result.Error.technisch` und `CsvImportSseClient.Event.Failed.technisch` tragen
Bibliothekstexte („unexpected end of stream"), die englisch sind und mit der
Bibliotheksversion wechseln. Sie gehören ins Log.

Gesichert durch `ErrorMessageLayerTest`.

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

- **Der Bearer-Token liegt unverschlüsselt in DataStore**
  (`app_prefs.preferences_pb`). Auf einem nicht gerooteten Gerät schützt das
  App-Verzeichnis zusammen mit `allowBackup="false"` und
  `data_extraction_rules`. `androidx.security-crypto` ist abgekündigt, es gibt
  also keinen gepflegten Aufrüstweg. Der wirksamere Hebel liegt serverseitig:
  `TOKEN_IDLE_DAYS` löscht ungenutzte Tokens.
- **Kein `SavedStateHandle`.** Nach Prozesstod sind Filter und Rollposition
  weg. Alles lädt ohnehin vom Server nach, und der Scroll-Merker ist eine
  Bequemlichkeit innerhalb einer Sitzung — nicht etwas, das einen Prozesstod
  überleben muss.
- **Kein detekt/ktlint.** Beide koppeln an die Kotlin-Version; ein Sprung von
  Kotlin bricht sonst den Build an einer Stelle, die mit dem Code nichts zu tun
  hat. Bei diesem Kommentaranteil ist der Zusatznutzen klein. Falls doch: nur
  mit `ignoreFailures`, damit es meldet statt blockiert — wie lint es hier
  schon tut.

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

Eine Ausnahme bleibt und ist Absicht: `BarcodeFeature` schreibt weiterhin
`gallerySearchFoundSetNumber` in `AppUiState`. Der Scanner findet ein Set, das
schon im Bestand liegt, und die Galerie soll dorthin springen — die Übergabe
ist der Zweck des Scans. Sie steht mit Begründung in `StateDomainBoundaryTest`.
