# Invarianten — bitte vor Änderungen lesen

Regeln, die in diesem Projekt schon gebrochen wurden: je eine Regel, die Dateien, an denen
sie hängt, und der Test, der sie hält. Die Geschichte einer Regel steht in den Commits
(`git log -S '<Stichwort>' -- Android-App/INVARIANTEN.md`; die lange Fassung zuletzt in 94184d8). `InvariantsReferencesTest` prüft, dass jede genannte Datei und Testklasse existiert;
ob der Test die Regel noch ganz trägt, prüft er nicht. Schlägt ein Test fehl, ist die Regel
verletzt — den Code korrigieren, nicht den Test.

## Kamera

**Autofokus.** `CONTROL_AF_MODE_CONTINUOUS_PICTURE` steht an Preview **und** ImageAnalysis
(CameraX legt beide zu einem Request zusammen; steht er nur an einem, entscheidet das
Gerät). Kein getaktetes `startFocusAndMetering`; Tap-to-Focus nur im Touch-Listener.
Genau **ein** Touch-Listener (`setOnTouchListener` ersetzt), in der `factory`, mit
`disableAutoCancel()`. Änderungen daran nur mit Gerätetest.
Dateien: `collection/ui/screens/BarcodeScannerScreen.kt`, `BarcodeAnalyzer.kt`,
`login/ui/screens/SetupQr.kt` · Test: `CameraFocusConfigTest`

**CameraX 1.6.** `future.get()` und das ganze Binden stehen im `try` des Listeners (ab 1.4
wirft CameraX bei belegter Kamera). Die Analyse bleibt `YUV_420_888`; RGBA lädt eine
unausgerichtete native Bibliothek nach. Test: `CameraXUpgradeTest`

**Aufräumen.** Was in `remember { }` entsteht und freigegeben werden muss (Executor,
ML-Kit-Client), braucht `DisposableEffect { onDispose { … } }`. Test: `ResourceAndCacheTest`

## Barcode und Erfassung

**Doppelklick-Sperre.** `confirmAddBarcode()` prüft `hinzufuegen` zuerst und setzt es synchron
**vor** `viewModelScope.launch`; jeder Ausgang und `cancelBarcode()` setzt es zurück. Der
gesperrte Knopf ist nur Rückmeldung, kein Schutz.
Dateien: `collection/ui/viewmodel/EntryViewModel.kt`, `collection/ui/EntryStates.kt`,
`collection/ui/dialogs/BarcodeResultDialog.kt` · Test: `EntryViewModelTest`

**Ein Barcode-Pfad.** Scanner → `vm.resolveBarcode()` → `repo.resolveBarcode()`; keine
Zweitimplementierung. Test: `SessionAndLifecycleTest`

**Eigener Fluss.** Scanner- und Dialogfelder liegen in `BarcodeUiState`, nicht in
`AppUiState` (sonst rekomponiert jeder Zwischenstand alle Reiter); Abmelden leert ihn.

**Erfolgloser Scan.** Die vier Wege ohne Setnummer setzen
`AppUiState.manuelleErfassungAnfordern`; wer den Scanner einbindet, öffnet seine Erfassung
und quittiert. Test: `ManualEntryAfterScanTest`

**Zwei Preisfelder.** Sets schicken `purchase_price`, Teile und Figuren `unit_price`; der
Rumpf entsteht nur über `changeForSet()` bzw. `changeForPiece()`.
Datei: `contract/Supplements.kt` · Test: `PurchasesViewModelTest`

## Sitzung und Netz

**HTTP 401.** `sicherAufrufen()` meldet ihn als `Ergebnis.Fehler.Abgewiesen`; `abgeglichen()` und
`reconciledSingle()` fallen dann **nicht** auf die Ablage zurück; der Interceptor meldet nur, wenn ein Token mitging
und es der eigene Server war.
Dateien: `data/repository/Fetch.kt`, `app/di/AppModule.kt`, `data/SessionExpiredSignal.kt`,
`session/SessionService.kt` · Test: `SessionAndLifecycleTest`

**Token nur an die eigene Herkunft** (Schema, Host, Port, Basispfad). Was eine Antwort
auslöst, gilt nur der Sitzung, in der die Anfrage hinausging (Generation der
`TokenLimit`); Umleitungen bleiben in der Herkunft. Abmelden entwertet am Server oder
über `EntwertungsWorker`; ein gesperrter Keystore heisst „später“, nie „abgemeldet“.
Dateien: `network/di/ServerGuard.kt`, `data/Redemption.kt`, `security/VaultFinding.kt` ·
Tests: `ServerSwitchTest`, `TokenSwapTest`, `RedirectTest`, `BasePathTest`,
`RedemptionTest`, `VaultLockTest`

**Schrittschutz nur mit Attestation.** Der Geräteschlüssel entsteht mit der Nonce des
Servers und geht nur als Kette hinaus; jede Absage (auch 404) hält an, es gibt keinen
blossen Schlüssel und keinen Rückfall auf die Prüfung im Gerät. Erzeugt zuerst im
StrongBox, nur ohne Chip im TEE (`strongBoxFirst`).
Dateien: `ui/components/KeyBinding.kt`, `data/account/StepBindingImpl.kt`,
`ui/components/StrongBoxFirst.kt` · Tests: `KeyBindingTest`, `StepBindingTest`,
`StrongBoxFirstTest`

**Ein OkHttp-Stack.** Ausserhalb von core-data kein eigener `OkHttpClient.Builder()`: Er
liefe am Wächter vorbei (Token, Klartext-Verbot, 401). Abweichende Zeiten über `newBuilder()`
des injizierten Clients. core-data baut zwei Grundlagen: Server (mit Wächter) und Entwertung (ohne
Wächter, mit dem Token des Auftrags).
Dateien: `finances/ui/pdf/InstructionLoader.kt`, `data/di/ServerClient.kt` · Test: `InstructionDownloadTest`

**Ergebnis hat zwei Varianten.** Kein `else` in einem `when` über `Ergebnis`: Eine neue
Variante soll den Bau dort brechen, wo sie behandelt werden muss.
Datei: `model/outcome/Outcome.kt` · Test: `MediaAuthTest`

**Fehlermeldungen an einer Stelle.** Die Datenschicht meldet die Art des Fehlers, keinen
Satz; den Satz bildet `AppTexte.meldung()`, die Meldung des Servers hat Vorrang.
`technisch` gehört ins Log, nie in die Anzeige. Ein Bildschirmzustand trägt `Laden<T>` für Abrufe,
`Vorgang` für Handlungen (läuft, fertig, gescheitert mit `Meldung`), keinen fertigen Satz und
kein `laeuft: Boolean`; alte Formen zählt `SourceRatchetTest`.
Tests: `ErrorMessageLayerTest`, `AppTextsTest`, `LoadTest`, `OperationTest`, `SourceRatchetTest`

**Eine Json-Konfiguration.** Server, Ablage und Cache lesen und schreiben mit `BrickJson`
(per DI als `Json`); keine zweite `Json { }`.
Datei: `model/json/BrickJson.kt` · Test: `BrickJsonTest`

## Offline-Ablage

**Der Ausgang liegt in eigener Form.** Ein wartender Posten wird als `InitialForm`
(Fassung 1) abgelegt, nie als Server-Anfrage; eine unverträgliche Änderung bekommt eine
neue Fassung daneben. Lesen schreibt nie; ein unlesbarer Posten wird über
`cleanUnreadable()` als verworfen gemeldet, nie still gelöscht.
Dateien: `offline/InitialForm.kt`, `offline/room/RoomStores.kt`, `data/local/Reconcile.kt` ·
Tests: `InitialFormTest`, `InventoryDatabaseTest`, `OutboxNotifierTest`

**Eine Ablage.** Was offline gelten soll, liegt als Fach (`StockKind`) in der Room-Ablage,
auch eine einzelne Antwort ohne Liste (`reconciledSingle()`); kein zweiter Plattenspeicher
daneben. Den früheren (`noBackupFilesDir/api-*`) räumt `cleanOldResponseStore()`.
Jedes Fach liegt in eigener `…Zeile`-Form (`StoreRows.kt`), nie als Servermodell; eine
unverträgliche Änderung bekommt eine neue Fassung (`Ablageform.fassung`), ältere bleiben lesbar.
Dateien: `offline/OfflineStore.kt`, `offline/StoreShape.kt`, `data/repository/Fetch.kt`,
`data/cache/CacheOwner.kt` · Tests: `CacheAreaTest`, `RepoCacheFallbackTest`, `StoreVersionTest`

**Schema.** Wer das Room-Schema ändert, erhöht die Fassung, schreibt eine Migration und
checkt das Schema unter `core-offline/schemas` ein. Test: `StockMigrationTest`

## Zustand und Module

**Zustand nach Domänen.** `AppUiState` hält nur die Sitzung, jeder Bereich hat seinen Fluss;
wer nur einen Teil braucht, leitet ihn mit `map`/`combine` und `stateIn` im viewModelScope ab.
Jede Feature-Datei schreibt nur Felder ihrer Domäne; Ausnahmen stehen begründet im Test. Abmelden
leert jeden Bereich. Dateien: `session/AppUiState.kt`, `session/Session.kt` · Tests:
`StateFlowWidthTest`, `SessionStateTest`, `StateDomainBoundaryTest`, `PartsViewModelTest`

**Modulkanten.** app → feature-* → core-*, kein Bereich kennt einen anderen; die Kernmodule
in fester Schichtung (build-logic, `Modulkanten`). Zustand und alles darunter ohne Compose
(`withoutUi`); die Bereiche bekommen die App nur als `Bereichsumgebung` aus einzelnen
Flüssen und Rückrufen, nie den AppViewModel. Ein ViewModel liegt nur mit Grund in
core-state (`zustandsViewModels`).
Das Wire-Format liegt in core-contract (kennt core-model, nicht umgekehrt), als ein Satz
Typen, erzeugt aus `Web-App/docs/openapi-v2.json` (`contract/ContractSets.kt` und eine Datei je weiterem OpenAPI-Tag, nie von Hand;
Pflichtfelder einer Antwort ohne Vorgabe, Testbauer `testX()` in den testFixtures; Namen und
Fachtypen in `Web-App/scripts/contract-kotlin-mapping.js`). Nur core-data bindet
es ein (`implementation`, `Modulkanten.wireKenner`), die Ablage hält Fachtypen; jedes Repository gibt Fachtypen (`model.fach`)
zurück, ein `success: false` ist eine `Absage`.
Datei: `navigation/AreaEnvironment.kt` · Tests: `ModuleBoundariesTest`, `LayerRulesTest`

**Bildschirme sind zustandslos.** Nur ein Composable `…Route` nimmt ein ViewModel und reicht
Zustand und eine `…Aktionen`-Schnittstelle weiter; so lässt sich jeder Bildschirm ohne Hilt
zeigen und prüfen. Geladen wird im ViewModel, sobald jemand den Zustand beobachtet
(`observeLoadOn`, `loadPerServer`, `Observed`), nie per `LaunchedEffect` (`SourceRatchetTest`). Dialoge stehen in `ui/dialogs/`, ihr Aufruf samt Bedingung im
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
`collection/ui/CollectionGraph.kt`, `parts/ui/PartsGraph.kt`, `finances/ui/FinancesGraph.kt` ·
Tests: `ListScrollPositionTest`, `TabScrollPositionTest`, `TabOpensAtTopTest`

**Endlos-Scroll.** Die Ladesperre wird synchron vor dem `launch` gesetzt und in jedem
Ausgang gelöst; beim Anhängen werden bekannte Schlüssel ausgesiebt.
Datei: `collection/ui/Gallery.kt` · Test: `GalleryTest`

**Schlüssel.** Stehen `items(…, key = …)` und ein `item { }` in derselben Liste, trägt auch
dieser einen Schlüssel. Test: `LazyGridItemKeyTest`

**Ein Abschluss ist ein Übergang.** Nachgeladen wird nur, wenn vorher ein Import lief, nicht
solange „läuft nicht“ gilt. Datei: `app/csv/CsvImportViewModel.kt` · Test: `CsvStatusReloadTest`

## Dienste, Dateien, Caches

**Meldungen lokalisiert.** Texte aus den Ressourcen über
`AppLanguage.localizedContext(…)` (injiziert); `setSmallIcon()` nur mit monochromem Drawable.
Dateien: `services/service/CsvImportNotifier.kt`, `services/service/PdfExportNotifier.kt`,
`services/service/PdfExportManager.kt`, `data/util/AppCompatLanguage.kt` · Test: `ServicePolishTest`

**Keine Vordergrunddienste.** CSV-Import und PDF-Export laufen nach dem Verlassen der App als
gewöhnliche Worker ohne `setForeground()` weiter und melden ihr Ende; `FOREGROUND_SERVICE`
nimmt das Manifest auch WorkManager weg. Dateien: `services/service/CsvImportWorker.kt`,
`services/service/PdfExportWorker.kt` · Tests: `LibraryComponentsTest`, `CsvImportWatchTest`,
`PdfFollowUpTest`

**Kein FileProvider.** Die Teileliste gibt nur der eigene `TeilelistenProvider` weiter:
nicht exportiert, Leserecht nur über die Auswahl des Systems, Klartext nur im Speicher
(Proxy-Deskriptor). Auf der Platte liegt sie mit AES-GCM verschlüsselt.
Dateien: `data/service/PartListsProvider.kt`, `data/util/PartListVault.kt` ·
Tests: `ServicePolishTest`, `PartListsStoreTest`, `InvariantsReferencesTest`

**Kein Selbst-Update.** Die App kommt über Google Play und installiert nichts selbst:
keine Berechtigung `REQUEST_INSTALL_PACKAGES`, kein Installer-Empfänger.
Tests: `LibraryComponentsTest`, `ManifestCheckTest`

**Ein CSV-Statuspfad.** SSE zuerst, Polling nur als Rückfall, die Statuslogik in
`applyStatus()` samt Anlaufschutz. Dateien: `services/service/CsvImportWorker.kt`,
`data/CsvImportSseClient.kt` · Test: `CsvImportWatchTest`

**PDF-Cache mit Budget.** `prunePdfCache()` hält `PDF_CACHE_BUDGET_BYTES`, älteste zuerst,
ohne die gerade angeforderte Datei. Datei: `finances/ui/pdf/InstructionLoader.kt` · Tests:
`ResourceAndCacheTest`, `InstructionStoreTest`

**Abmelden leert alle Caches**, den Bild-Speicher vor dem Bild-Plattencache.
Datei: `data/SessionCleanup.kt` · Test: `ResourceAndCacheTest`

**Ein ImageLoader**, im DI-Modul, nie in `onCreate()`. Dateien: `app/di/AppModule.kt`,
`MainActivity.kt` · Test: `SessionAndLifecycleTest`

**Polling am Lifecycle.** Jede getaktete Schleife eines Bildschirms in
`repeatOnLifecycle(STARTED)`. Dienste (CSV-Import, PDF-Export) und das Warten auf den
Serverstart takten nur, solange ihr Auftrag läuft, und enden mit ihm.
Datei: `management/ui/screens/MonitoringScreen.kt` · Test: `SessionAndLifecycleTest`

## Bedienung

**Abbrechen links, Hauptknopf rechts.** AlertDialog ordnet selbst; jede andere Reihe mit
Abbrechen und Hauptknopf ist eine `Knopfzeile`. Jeder AlertDialog liegt auf
`fensterFlaeche()`. Datei: `ui/components/Dialogs.kt` · Test: `SourceRatchetTest`

**Absenden ist nie gesperrt, weil etwas fehlt.** Der Hauptknopf bleibt antippbar, markiert
die falschen Felder und setzt den Cursor ins erste; gesperrt nur während des Sendens, dann
mit `lockedColors()` (4,5:1). Dateien: `ui/components/PasswordSwitch.kt`, `ui/theme/LockedState.kt` ·
Tests: `PasswordSwitchTest`, `LockedContrastTest`, `ScaffoldAndFormTest`

**Einfachwahl ist kein Chip.** Zwei bis vier Möglichkeiten: `SegmentChoice` (bei grosser Schrift
untereinander); mehr: `SelectionField`. Chips nur für Filter. Test: `UisRulesTest`

**Tippziel und Name.** Jedes antippbare Element der Hauptbildschirme hat 48 dp und einen Namen.
Test: `TipTargetAndNameTest`

## Darstellung von Zahlen

**Preisverlauf.** Eine `0` vor `firstRealIndex` heisst „kein Wert“; die x-Position kommt
vom Datum; eine Skala für beide Linien. Die Rechnung liegt Compose-frei daneben.
Dateien: `shared/ui/PriceChartMath.kt`, `shared/ui/SetDetailComponents.kt` ·
Test: `PriceChartMathTest`

**Bewertung je Erfassung.** Jede Erfassung mit dem Marktpreis ihres Zustands; der Server
rechnet, die App rechnet nicht nach. Dateien: `finances/ui/screens/FinanceScreen.kt`,
`contract/ContractFinances.kt` · Test: `PriceHistorySerializationTest`

**Beträge sind Geld, Zeitpunkte Instant.** Fachtypen tragen Beträge als `Geld`
(Zehntausendstel wie der Server), gerundet auf Rappen erst in der Anzeige; Zeitpunkte als
`Instant`, der Kalendertag ist der in UTC. Double und Text gibt es nur auf der Leitung.
Dateien: `model/domain/Money.kt`, `model/util/DateFormat.kt` · Tests: `MoneyTest`, `SourceRatchetTest`

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
| geheim | Token | nur AES-GCM mit Keystore-Schlüssel und AAD (`TokenTresor`); der Schlüssel früherer Fassungen wird nach dem Umschlüsseln gelöscht und nie neu angelegt (`KeystoreLegacyStockTest`) |
| geheim | Gutschein-PIN, Passwörter, TOTP-Schlüssel, Wiederherstellungscodes | **nie** auf der Platte; die PIN wird vor dem Ablegen entfernt (`VouchersRepository.withoutSecret`), ein Gutschein-PDF nur im Speicher (memfd) |
| vertraulich | Sets, Teile, Figuren, Merkliste, Preisalarme, Lagerorte, Bewertungen, Gutschein-Nummer und -Betrag, Kennzahlen, Katalog-Metadaten (Room `bestand.db`), Ausgang | SQLCipher |
| vertraulich | Vorschaubilder, Bild-Zwischenspeicher, Bauanleitungen | `StoreCipher` (AES-GCM, Schlüssel aus dem Keystore umhüllt) |
| vertraulich | Server-Adresse, Benutzername, Herkunft des Tokens, Widget-Zahlen, Abmeldeaufträge (WorkManager), gescheiterte Entwertungen | `Vertrauenschiffre.verschluessleDetail`: eigener Schlüssel, nur entsperrt (`setUnlockedDeviceRequired`), überlebt das Abmelden; gesperrt heisst „später“, nie „weg“ (`TrustCipherTest`, `TokenVaultTest`, `JobStoreTest`) |
| vertraulich | Konto- und Lagerortfilter | nur im Speicher (`ScopeFilterStorage`); Reste früherer Fassungen räumt `PlaintextRemainder` (`PlaintextRemainderTest`) |
| vertraulich | Teileliste-PDF | `StoreCipher` (`Teilelistentresor`); Klartext nur im Speicher, solange die Ziel-App über den `TeilelistenProvider` liest; nach 30 Minuten gelöscht |
| Integrität | Zertifikat-Pins, Schalter „Nutzer-CAs vertrauen“ | `Vertrauenschiffre`, überlebt das Abmelden, arbeitet auch gesperrt (jede TLS-Verbindung fragt); Eintragsnamen per HMAC, kein Host im Namen; unlesbar heisst „nicht vertraut“ (`TrustEncryptedTest`) |

Für alle: `allowBackup="false"`, ohne Cloud-Sicherung und Geräteumzug
(`NetworkSecurityTest`), beim Abmelden geleert, jede Ablage gehört Server und Konto
(`CacheAreaTest`). Ein neues Fach in `StockKind` ist rot, bis es hier eingeordnet ist.

## Bewusst getragen

- **Pin auf eine System-Wurzel:** Nach bestätigtem öffentlichem Zertifikat gilt jede
  öffentlich gültige Kette samt Certificate Transparency (`CertificatePinTest`). Wer das
  ausschliessen will, betreibt eine eigene CA.
- **Keine Root- oder Integritätserkennung:** Verteilung ausserhalb von Play; Geheimnisse
  liegen im Keystore oder gar nicht auf dem Gerät.
- **Widget mit Sammlungswert:** vom Nutzer angelegt, nur eine Summe, beim Abmelden geleert.
- **Schritt-Schutz ohne Displaysperre:** Warnung, erst „Ungeschützt fortfahren“ öffnet;
  eine Bestätigung gilt 60 s und verfällt im Hintergrund.
- **Token ohne Nutzerauthentisierung:** Hintergrundarbeit (Preisalarm, Widget, Ausgang,
  Entwertung) braucht ihn; dagegen 180 Tage Höchstdauer, Rotation, Entwertung. Er liegt
  unter einem Schlüssel, der nur entsperrt arbeitet, ohne Ausweg auf einen schwächeren
  (`EntsperrVault`); bei gesperrtem Gerät wird nicht getauscht (`TokenSwapTest`).
- **Pins unter einem Schlüssel ohne Entsperr-Bedingung:** Die TLS-Prüfung braucht sie bei
  jeder Verbindung. Sie sind öffentlich (Fingerabdrücke), nur ihre Unverfälschtheit zählt;
  die Namen verraten den Server nicht.
- **Teileliste 30 Minuten abrufbar:** Verschlüsselt auf der Platte, aber die Ziel-App
  liest sie im Klartext und kann sie behalten; danach löscht die App ihre Kopie.
- **Anleitung über 64 MB in einer namenlosen Datei:** Ein memfd dieser Grösse kostete
  Arbeitsspeicher, den das System mit einem Kill zurückholte.
- **Endmarker im verschlüsselten Dateisystem:** Eine Kürzung genau auf einen früheren flush
  bleibt unentdeckt; sie setzt nur ein Journal zurück.
- **Nach dem Prozesstod nur Filter und Ansicht:** Suche, Filter und Ansicht der Listen liegen
  im `SavedStateHandle` (Teile als ein `Teilefilter`, Figuren, Galerie, Merkliste, Finanzen,
  die Setnummern der Teileliste); Daten und Rollposition nicht, sie laden beim Beobachten
  nach. Konto- und Lagerortfilter bleiben nur im Speicher (vertraulich, siehe oben)
  (`PartsViewModelTest`).
