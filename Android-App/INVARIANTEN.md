# Invarianten — bitte vor Änderungen lesen

Regeln, die in diesem Projekt schon gebrochen wurden: je eine Regel, die Dateien, an denen
sie hängt, und der Test, der sie hält. Die Geschichte einer Regel steht in den Commits
(`git log -S '<Stichwort>' -- Android-App/INVARIANTEN.md`; die lange Fassung zuletzt in 94184d8). `InvariantenVerweiseTest` prüft, dass jede genannte Datei und Testklasse existiert;
ob der Test die Regel noch ganz trägt, prüft er nicht. Schlägt ein Test fehl, ist die Regel
verletzt — den Code korrigieren, nicht den Test.

## Kamera

**Autofokus.** `CONTROL_AF_MODE_CONTINUOUS_PICTURE` steht an Preview **und** ImageAnalysis
(CameraX legt beide zu einem Request zusammen; steht er nur an einem, entscheidet das
Gerät). Kein getaktetes `startFocusAndMetering`; Tap-to-Focus nur im Touch-Listener.
Genau **ein** Touch-Listener (`setOnTouchListener` ersetzt), in der `factory`, mit
`disableAutoCancel()`. Änderungen daran nur mit Gerätetest.
Dateien: `sammlung/ui/screens/BarcodeScannerScreen.kt`, `BarcodeAnalyzer.kt`,
`anmeldung/ui/screens/SetupQr.kt` · Test: `CameraFocusConfigTest`

**CameraX 1.6.** `future.get()` und das ganze Binden stehen im `try` des Listeners (ab 1.4
wirft CameraX bei belegter Kamera). Die Analyse bleibt `YUV_420_888`; RGBA lädt eine
unausgerichtete native Bibliothek nach. Test: `CameraXUpgradeTest`

**Aufräumen.** Was in `remember { }` entsteht und freigegeben werden muss (Executor,
ML-Kit-Client), braucht `DisposableEffect { onDispose { … } }`. Test: `ResourceAndCacheTest`

## Barcode und Erfassung

**Doppelklick-Sperre.** `confirmAddBarcode()` prüft `adding` zuerst und setzt es synchron
**vor** `viewModelScope.launch`; jeder Ausgang und `cancelBarcode()` setzt es zurück. Der
gesperrte Knopf ist nur Rückmeldung, kein Schutz.
Dateien: `sammlung/ui/viewmodel/ErfassungViewModel.kt`, `sammlung/ui/ZustandErfassung.kt`,
`sammlung/ui/dialogs/BarcodeResultDialog.kt` · Test: `ErfassungViewModelTest`

**Ein Barcode-Pfad.** Scanner → `vm.resolveBarcode()` → `repo.resolveBarcode()`; keine
Zweitimplementierung. Test: `SessionAndLifecycleTest`

**Eigener Fluss.** Scanner- und Dialogfelder liegen in `BarcodeUiState`, nicht in
`AppUiState` (sonst rekomponiert jeder Zwischenstand alle Reiter); Abmelden leert ihn.

**Erfolgloser Scan.** Die vier Wege ohne Setnummer setzen
`AppUiState.manuelleErfassungAnfordern`; wer den Scanner einbindet, öffnet seine Erfassung
und quittiert. Test: `ManualEntryAfterScanTest`

**Zwei Preisfelder.** Sets schicken `purchase_price`, Teile und Figuren `unit_price`; der
Rumpf entsteht nur über `fuerSet()` bzw. `fuerStueck()`.
Datei: `vertrag/HaushaltModels.kt` · Test: `KaeufeViewModelTest`

## Sitzung und Netz

**HTTP 401.** `sicherAufrufen()` meldet ihn als `Ergebnis.Error.Abgewiesen`; `abgeglichen()` und
`abgeglichenEinzeln()` fallen dann **nicht** auf die Ablage zurück; der Interceptor meldet nur, wenn ein Token mitging
und es der eigene Server war.
Dateien: `data/repository/Abruf.kt`, `app/di/AppModule.kt`, `data/SessionExpiredSignal.kt`,
`sitzung/SitzungsDienst.kt` · Test: `SessionAndLifecycleTest`

**Token nur an die eigene Herkunft** (Schema, Host, Port, Basispfad). Was eine Antwort
auslöst, gilt nur der Sitzung, in der die Anfrage hinausging (Generation der
`TokenSchranke`); Umleitungen bleiben in der Herkunft. Abmelden entwertet am Server oder
über `EntwertungsWorker`; ein gesperrter Keystore heisst „später“, nie „abgemeldet“.
Dateien: `netz/di/ServerWaechter.kt`, `data/Entwertung.kt`, `sicherheit/Tresorbefund.kt` ·
Tests: `ServerwechselTest`, `TokenTauschTest`, `UmleitungTest`, `BasisPfadTest`,
`EntwertungTest`, `TresorSperreTest`

**Schrittschutz nur mit Attestation.** Der Geräteschlüssel entsteht mit der Nonce des
Servers und geht nur als Kette hinaus; jede Absage (auch 404) hält an, es gibt keinen
blossen Schlüssel und keinen Rückfall auf die Prüfung im Gerät. Erzeugt zuerst im
StrongBox, nur ohne Chip im TEE (`strongBoxZuerst`).
Dateien: `ui/components/Schluesselbindung.kt`, `data/repository/SchrittbindungImpl.kt`,
`ui/components/StrongBoxZuerst.kt` · Tests: `SchluesselbindungTest`, `SchrittbindungTest`,
`StrongBoxZuerstTest`

**Ein OkHttp-Stack.** Kein eigener `OkHttpClient.Builder()`: Er liefe am Wächter vorbei
(Token, Klartext-Verbot, 401). Abweichende Zeiten über `newBuilder()` des injizierten
Clients. Datei: `finanzen/ui/pdf/AnleitungsLader.kt` · Test: `AnleitungsDownloadTest`

**Ergebnis hat zwei Varianten.** Kein `else` in einem `when` über `Ergebnis`: Eine neue
Variante soll den Bau dort brechen, wo sie behandelt werden muss.
Datei: `data/repository/Ergebnis.kt` · Test: `MediaAuthTest`

**Fehlermeldungen an einer Stelle.** Die Datenschicht meldet die Art des Fehlers, keinen
Satz; den Satz bildet `AppTexte.meldung()`, die Meldung des Servers hat Vorrang.
`technisch` gehört ins Log, nie in die Anzeige. Ein Bildschirmzustand trägt `Laden<T>` und eine
`Meldung` (`fehlerMeldung()`), keinen fertigen Satz; alte Formen zählt `QuelltextRatscheTest`.
Tests: `ErrorMessageLayerTest`, `AppTexteTest`, `LadenTest`, `QuelltextRatscheTest`

**Eine Json-Konfiguration.** Server, Ablage und Cache lesen und schreiben mit `BrickJson`
(per DI als `Json`); keine zweite `Json { }`.
Datei: `model/json/BrickJson.kt` · Test: `BrickJsonTest`

## Offline-Ablage

**Der Ausgang liegt in eigener Form.** Ein wartender Posten wird als `Ausgangsform`
(Fassung 1) abgelegt, nie als Server-Anfrage; eine unverträgliche Änderung bekommt eine
neue Fassung daneben. Lesen schreibt nie; ein unlesbarer Posten wird über
`raeumeUnlesbare()` als verworfen gemeldet, nie still gelöscht.
Dateien: `offline/Ausgangsform.kt`, `offline/room/RoomAblagen.kt`, `data/lokal/Abgleich.kt` ·
Tests: `AusgangsformTest`, `BestandDatenbankTest`, `AusgangsmelderTest`

**Eine Ablage.** Was offline gelten soll, liegt als Fach (`Bestandsart`) in der Room-Ablage,
auch eine einzelne Antwort ohne Liste (`abgeglichenEinzeln()`); kein zweiter Plattenspeicher
daneben. Den früheren (`noBackupFilesDir/api-*`) räumt `raeumeAlteAntwortablage()`.
Dateien: `offline/Offlineablage.kt`, `data/repository/Abruf.kt`, `data/cache/CacheBesitzer.kt` ·
Tests: `CacheBereichTest`, `RepoCacheRueckfallTest`

**Schema.** Wer das Room-Schema ändert, erhöht die Fassung, schreibt eine Migration und
checkt das Schema unter `core-offline/schemas` ein. Test: `BestandMigrationTest`

## Zustand und Module

**Zustand nach Domänen.** `AppUiState` hält nur die Sitzung, jeder Bereich hat seinen Fluss;
wer nur einen Teil braucht, leitet ihn mit `abgeleitet { }` ab. Jede Feature-Datei schreibt
nur Felder ihrer Domäne; Ausnahmen stehen begründet im Test. Abmelden leert jeden Bereich.
Dateien: `sitzung/AppUiState.kt`, `sitzung/AbgeleiteterZustand.kt` · Tests:
`ZustandsflussBreiteTest`, `AbgeleiteterZustandTest`, `StateDomainBoundaryTest`, `TeileViewModelTest`

**Modulkanten.** app → feature-* → core-*, kein Bereich kennt einen anderen; die Kernmodule
in fester Schichtung (build-logic, `Modulkanten`). Zustand und alles darunter ohne Compose
(`ohneOberflaeche`); die Bereiche bekommen die App nur als `Bereichsumgebung` aus einzelnen
Flüssen und Rückrufen, nie den AppViewModel. Ein ViewModel liegt nur mit Grund in
core-zustand (`zustandsViewModels`).
Das Wire-Format liegt in core-vertrag (kennt core-model, nicht umgekehrt); Bereiche nehmen
Ansichten, ihre Importe aus core-vertrag sind eine Ratsche.
Datei: `navigation/Bereichsumgebung.kt` · Tests: `ModulgrenzenTest`, `SchichtregelnTest`

**Bildschirme sind zustandslos.** Nur ein Composable `…Route` nimmt ein ViewModel und reicht
Zustand und eine `…Aktionen`-Schnittstelle weiter; so lässt sich jeder Bildschirm ohne Hilt
zeigen und prüfen. Dialoge stehen in `ui/dialogs/`, ihr Aufruf samt Bedingung im
Navigationsaufbau; grosse Bildschirme teilen sich in `*Sections.kt` (detekt `LongMethod`).

**Delegierte Zustands-Properties** (`val state by …collectAsStateWithLifecycle()`) erlauben
keinen Smart Cast: den Wert in eine lokale Variable heben, nicht `?: ""`. Kein Test, der
Compiler meldet es.

## Listen und Rollen

**Rollpositionen.** Jeder Reiter mit Liste ruft `ScrollPositionKeeper(…)` im Ziel; der
Listenzustand liegt oberhalb des NavHost. Im Helfer: Merker `remember`, nie
`rememberSaveable`; der Melder hängt am Merker; `wiederhergestellt = true` erst **nach**
`scrollToItem`. Die Position liegt in einer Karte, nicht in einem StateFlow. Filterwechsel →
`vergiss(…)`; Reiter antippen → `vergissReiter(route)` **vor** der Navigation. Ausnahme:
der Katalog merkt sich seine Position selbst (`CatalogScreen.kt`).
Dateien: `ui/ScrollMemory.kt`, `AppNavigation.kt`, `MainScaffold.kt`,
`sammlung/ui/SammlungGraph.kt`, `teile/ui/TeileGraph.kt`, `finanzen/ui/FinanzenGraph.kt` ·
Tests: `ListScrollPositionTest`, `TabOpensAtTopTest`

**Endlos-Scroll.** Die Ladesperre wird synchron vor dem `launch` gesetzt und in jedem
Ausgang gelöst; beim Anhängen werden bekannte Schlüssel ausgesiebt.
Datei: `sammlung/ui/Galerie.kt` · Test: `GalerieTest`

**Schlüssel.** Stehen `items(…, key = …)` und ein `item { }` in derselben Liste, trägt auch
dieser einen Schlüssel. Test: `LazyGridItemKeyTest`

**Ein Abschluss ist ein Übergang.** Nachgeladen wird nur, wenn vorher ein Import lief, nicht
solange „läuft nicht“ gilt. Datei: `app/csv/CsvImportViewModel.kt` · Test: `CsvStatusReloadTest`

## Dienste, Dateien, Caches

**Services lokalisiert.** Texte aus den Ressourcen über
`LanguageManager.localizedContext(this)`; `setSmallIcon()` nur mit monochromem Drawable.
Dateien: `dienste/service/CsvImportService.kt`, `dienste/service/PdfExportService.kt`,
`dienste/service/PdfExportManager.kt`, `data/util/LanguageManager.kt` · Test: `ServicePolishTest`

**FileProvider nur `pdf/`**, nie ganze Wurzeln; der Export schreibt dorthin.
Test: `ServicePolishTest`

**Ein CSV-Statuspfad.** SSE zuerst, Polling nur als Rückfall, die Statuslogik in
`applyStatus()` samt Anlaufschutz. Dateien: `dienste/service/CsvImportService.kt`,
`data/CsvImportSseClient.kt` · Test: `ResourceAndCacheTest`

**PDF-Cache mit Budget.** `prunePdfCache()` hält `PDF_CACHE_BUDGET_BYTES`, älteste zuerst,
ohne die gerade angeforderte Datei. Datei: `finanzen/ui/pdf/AnleitungsLader.kt` · Tests:
`ResourceAndCacheTest`, `AnleitungsAblageTest`

**Abmelden leert alle Caches**, den Bild-Speicher vor dem Bild-Plattencache.
Datei: `data/SitzungsBereinigung.kt` · Test: `ResourceAndCacheTest`

**Ein ImageLoader**, im DI-Modul, nie in `onCreate()`. Dateien: `app/di/AppModule.kt`,
`MainActivity.kt` · Test: `SessionAndLifecycleTest`

**Polling am Lifecycle.** Jede getaktete Schleife in `repeatOnLifecycle(STARTED)`.
Datei: `verwaltung/ui/screens/MonitoringScreen.kt` · Test: `SessionAndLifecycleTest`

## Darstellung von Zahlen

**Preisverlauf.** Eine `0` vor `firstRealIndex` heisst „kein Wert“; die x-Position kommt
vom Datum; eine Skala für beide Linien. Die Rechnung liegt Compose-frei daneben.
Dateien: `gemeinsam/ui/PriceChartMath.kt`, `gemeinsam/ui/SetDetailComponents.kt` ·
Test: `PriceChartMathTest`

**Bewertung je Erfassung.** Jede Erfassung mit dem Marktpreis ihres Zustands; der Server
rechnet, die App rechnet nicht nach. Dateien: `finanzen/ui/screens/FinanceScreen.kt`,
`vertrag/FinanzModels.kt` · Test: `PriceHistorySerializationTest`

## Bau und Plattform

**SDK.** `compileSdk` = `targetSdk` (build-logic, `Sdk`), `minSdk` 30. Kein eigener
`BackHandler` ohne Gerätetest der Wischgeste; kein `screenOrientation` oder
`resizeableActivity`. Test: `TargetSdkConfigTest`

**16-KB-Speicherseiten.** ML Kit bleibt unbundled, DataStore per `force` auf der
ausgerichteten Fassung, `useLegacyPackaging = false`, `graphics-path` direkt deklariert.
Belegt wird es nur am fertigen APK (CI). Test: `SixteenKbAlignmentTest`

**Debug-Fassung fest**, gesetzt über `androidComponents { onVariants … }`.
Test: `ResourceAndCacheTest`

## Daten auf dem Gerät

**Geheim** heisst: Wer es hat, handelt im Namen des Nutzers oder löst Geld ein.
**Vertraulich**: privat, ohne Handlungsmacht.

| Klasse | Inhalt | Ablage |
|---|---|---|
| geheim | Token | nur AES-GCM mit Keystore-Schlüssel (`TokenTresor`) |
| geheim | Gutschein-PIN, Passwörter, TOTP-Schlüssel, Wiederherstellungscodes | **nie** auf der Platte; die PIN wird vor dem Ablegen entfernt (`GutscheineRepository.ohneGeheimnis`), ein Gutschein-PDF nur im Speicher (memfd) |
| vertraulich | Sets, Teile, Figuren, Merkliste, Preisalarme, Lagerorte, Bewertungen, Gutschein-Nummer und -Betrag, Kennzahlen, Katalog-Metadaten (Room `bestand.db`), Ausgang | SQLCipher |
| vertraulich | Vorschaubilder, Bild-Zwischenspeicher, Bauanleitungen | `AblageChiffre` (AES-GCM, Schlüssel aus dem Keystore umhüllt) |
| vertraulich | Server-Adresse, Benutzername, Herkunft des Tokens, Widget-Zahlen, Abmeldeaufträge (WorkManager), gescheiterte Entwertungen | `Vertrauenschiffre.verschluessleAngabe`: eigener Schlüssel, nur entsperrt (`setUnlockedDeviceRequired`), überlebt das Abmelden; gesperrt heisst „später“, nie „weg“ (`VertrauenschiffreTest`, `TokenTresorTest`, `AuftragsablageTest`) |
| vertraulich | Konto- und Lagerortfilter | nur im Speicher (`ScopeFilterSpeicher`); Reste früherer Fassungen räumt `KlartextReste` (`KlartextResteTest`) |
| vertraulich | Teileliste-PDF | Klartext für die Ziel-App, nach 30 Minuten gelöscht |
| Integrität | Zertifikat-Pins, Schalter „Nutzer-CAs vertrauen“ | `Vertrauenschiffre`, überlebt das Abmelden, arbeitet auch gesperrt (jede TLS-Verbindung fragt); Eintragsnamen per HMAC, kein Host im Namen; unlesbar heisst „nicht vertraut“ (`VertrauenVerschluesseltTest`) |

Für alle: `allowBackup="false"`, ohne Cloud-Sicherung und Geräteumzug
(`NetzsicherheitTest`), beim Abmelden geleert, jede Ablage gehört Server und Konto
(`CacheBereichTest`). Ein neues Fach in `Bestandsart` ist rot, bis es hier eingeordnet ist.

## Bewusst getragen

- **Pin auf eine System-Wurzel:** Nach bestätigtem öffentlichem Zertifikat gilt jede
  öffentlich gültige Kette samt Certificate Transparency (`ZertifikatPinTest`). Wer das
  ausschliessen will, betreibt eine eigene CA.
- **Keine Root- oder Integritätserkennung:** Verteilung ausserhalb von Play; Geheimnisse
  liegen im Keystore oder gar nicht auf dem Gerät.
- **Widget mit Sammlungswert:** vom Nutzer angelegt, nur eine Summe, beim Abmelden geleert.
- **Schritt-Schutz ohne Displaysperre:** Warnung, erst „Ungeschützt fortfahren“ öffnet;
  eine Bestätigung gilt 60 s und verfällt im Hintergrund.
- **Token ohne Nutzerauthentisierung:** Hintergrundarbeit (Preisalarm, Widget, Ausgang,
  Entwertung) braucht ihn; dagegen 180 Tage Höchstdauer, Rotation, Entwertung. Er liegt
  unter einem Schlüssel, der nur entsperrt arbeitet, ohne Ausweg auf einen schwächeren
  (`EntsperrTresor`); bei gesperrtem Gerät wird nicht getauscht (`TokenTauschTest`).
- **Pins unter einem Schlüssel ohne Entsperr-Bedingung:** Die TLS-Prüfung braucht sie bei
  jeder Verbindung. Sie sind öffentlich (Fingerabdrücke), nur ihre Unverfälschtheit zählt;
  die Namen verraten den Server nicht.
- **Unsignierte `version.json` bis 01.02.2027** nur für Fassungen ohne signierte
  Beschreibung; danach löscht der Release-Lauf den Anhang.
- **Teileliste 30 Minuten im Klartext:** Die Ziel-App kann keinen Geheimtext lesen.
- **Anleitung über 64 MB in einer namenlosen Datei:** Ein memfd dieser Grösse kostete
  Arbeitsspeicher, den das System mit einem Kill zurückholte.
- **Endmarker im verschlüsselten Dateisystem:** Eine Kürzung genau auf einen früheren flush
  bleibt unentdeckt; sie setzt nur ein Journal zurück.
- **Kein `SavedStateHandle`:** Nach Prozesstod sind Filter und Rollposition weg; alles lädt
  vom Server nach.
