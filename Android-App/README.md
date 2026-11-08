# BrickInventory Manager Android App

Kotlin + Jetpack Compose App für den BrickInventory Manager Server.

## Voraussetzungen
- **JDK 17** (JDK 21 funktioniert ebenfalls) — `java -version` muss 17 oder
  höher melden
- **Android SDK** mit Plattform **37** (`compileSdk = targetSdk = 37`,
  `minSdk = 30`, siehe `build-logic/…/Sdk.kt`); die passenden Build-Tools holt
  AGP beim ersten Bau selbst, sobald die SDK-Lizenzen angenommen sind
- Android Studio in einer Fassung, die **AGP 9.4** versteht — nur nötig, wenn
  in der IDE gearbeitet wird; auf der Kommandozeile reichen JDK und SDK
- Gradle muss **nicht** installiert sein: der mitgelieferte Wrapper holt
  Gradle 9.8.2 selbst (siehe *Gradle-Wrapper* weiter unten)
- BrickInventory Manager Server läuft und ist erreichbar

## Öffnen in Android Studio
1. Android Studio öffnen
2. "Open" → diesen Ordner (`Android-App/`) wählen
3. Warten bis Gradle sync abgeschlossen ist
4. App starten (▶)

## Bauen auf der Kommandozeile

Alle Befehle laufen **in diesem Ordner** (`Android-App/`) — das Wurzelverzeichnis
des Repositories enthält kein Gradle-Projekt, dort liegt daneben noch `Web-App/`.

Zuerst muss Gradle das Android SDK finden. Entweder über die Umgebung:

```bash
export ANDROID_HOME=$HOME/Android/Sdk      # Linux
# export ANDROID_HOME=$HOME/Library/Android/sdk   # macOS
```

… oder über eine `local.properties` (rechnerspezifisch, steht deshalb in
`.gitignore`):

```bash
cp local.properties.example local.properties   # danach sdk.dir anpassen
```

Ohne Android Studio lässt sich das SDK mit den
[Command-line Tools](https://developer.android.com/studio#command-line-tools-only)
einrichten:

```bash
sdkmanager --install "platform-tools" "platforms;android-37"
sdkmanager --licenses
```

Danach:

| Befehl | Ergebnis |
| --- | --- |
| `./gradlew testDebugUnitTest :core-model:test` | JVM-Unit-Tests aller Module (core-model ist reines Kotlin und hat `test`), Bericht je Modul unter `*/build/reports/tests/` |
| `./gradlew assembleDebug` | `app/build/outputs/apk/debug/app-debug.apk` — mit dem Debug-Schlüssel signiert, direkt installierbar |
| `./gradlew assembleRelease` | `app/build/outputs/apk/release/BrickInventory.apk` — minifiziert; signiert nur, wenn die Schlüsselwerte gesetzt sind (siehe unten) |
| `./gradlew lintRelease` | `app/build/reports/lint-results-release.html` |
| `./gradlew detekt` | Kotlin-Prüfung je Modul, Funde unter `*/build/reports/detekt/detekt.txt`; rot bei jedem Fund |
| `./gradlew installDebug` | baut und installiert auf dem angeschlossenen Gerät (`adb devices`) |
| `./gradlew clean` | löscht `app/build/` |

Unter Windows `gradlew.bat` statt `./gradlew` verwenden.

### Ob die Release-APK signiert ist, hängt an der Umgebung

`assembleRelease` signiert, **wenn** die vier Werte gesetzt sind
(`BRICK_KEYSTORE_PFAD`, `BRICK_KEYSTORE_PASSWORT`, `BRICK_KEY_ALIAS`,
`BRICK_KEY_PASSWORT`) — als Umgebungsvariable oder als Gradle-Property in
`~/.gradle/gradle.properties`. Fehlen sie, entsteht wie bisher ein
**unsigniertes** APK, das Android nicht installiert; der Bau scheitert
deswegen aber nicht.

Wie der Schlüsselspeicher erzeugt und hinterlegt wird, steht weiter unten
unter *Release signieren*.

### Erster Lauf dauert lange

Der Wrapper lädt beim ersten Aufruf Gradle 9.8.2 (~140 MB), danach ziehen AGP,
Kotlin, KSP und die Abhängigkeiten nochmals einige hundert MB. Das passiert
einmal pro Rechner; Gradle legt alles unter `~/.gradle/` ab.

Benötigte Hosts — hinter einem restriktiven Proxy müssen diese erreichbar sein:

- `services.gradle.org` (die Gradle-Distribution)
- `dl.google.com` / `maven.google.com` (AGP, AndroidX, ML Kit, das SDK selbst)
- `repo1.maven.org` (Kotlin, Retrofit, OkHttp, Coil, Hilt)
- `plugins.gradle.org` (Plugin-Auflösung)

### Continuous Integration

`.github/workflows/android.yml` im Wurzelverzeichnis des Repositories läuft auf
jedem Push, der `Android-App/` berührt. Der Job `build` macht nacheinander:

1. Wrapper und Gradle-Prüfsumme prüfen
2. `testDebugUnitTest :core-model:test` samt Bildschirmfotos (`verifyRoborazziDebug`,
   ohne eingecheckte Referenzen `recordRoborazziDebug`)
3. Room-Schema eingecheckt?
4. `assembleRelease bundleRelease`, danach `:app:lintRelease`
5. Warnungen der Test- und Release-Übersetzung zählen (`tools/warnungen-obergrenze.txt`)
   und Lint-Befunde zählen (`tools/lint-obergrenze.txt`)
6. `detekt` gegen `config/detekt/baseline.xml`
7. Rückstand der Abhängigkeiten melden (`tools/fassungen-pruefen.py`)

Daneben misst der Job `gegenproben` die Patches unter `gegenproben/`: auf einem
Push nur die betroffenen, nachts und von Hand alle. Die Test- und Lint-Berichte
hängen als Artefakt am Lauf (auch bei rotem Lauf — gerade dann werden sie gebraucht).

Die APK **nicht**: Sie wird als Anhang am Release `apk-neuste` abgelegt und
ist damit direkt herunterladbar —

<https://github.com/addict85/BrickInventory/releases/download/apk-neuste/BrickInventory.apk>

Der Grund steht ausführlich im Workflow: GitHub packt **jedes** Artefakt in ein
Zip, auch eine einzelne Datei, und es gibt dagegen keinen Schalter (»There is
currently no way to download artifacts in a format other than a Zip«, Anleitung
von `actions/upload-artifact`). Ein Release-Anhang wird roh ausgeliefert,
braucht kein GitHub-Konto und verfällt nicht nach 90 Tagen. Ersetzt wird er
**nur** aus einem Etikett `android-v…`, dessen Commit auf `main` liegt — nicht
aus Zweigen, Pull-Requests oder jedem Push auf `main`.

**Veröffentlichen:** auf dem gewünschten Stand von `main`

```
git tag android-v2026.11.03 origin/main
git push origin android-v2026.11.03
```

Der Lauf zum Etikett baut, signiert (nach Freigabe in der Environment
`release`), prüft, bescheinigt die Herkunft des APK und ersetzt den Anhang.
Prüfen lässt sich die Herkunft mit
`gh attestation verify BrickInventory.apk --repo addict85/BrickInventory`.

Signiert wird in einem eigenen Job `signieren`, der nur das unsignierte APK aus
dem Bau-Job bekommt und keinen Projektcode ausführt (kein Checkout, kein
Gradle; `zipalign`/`apksigner` aus dem SDK des Runners). Für ein Etikett
`android-v…` prüft er zuerst, dass dessen Commit auf `main` liegt, und läuft in
der Environment `release`; nur dort gehören die vier Secrets `KEYSTORE_BASE64`,
`KEYSTORE_PASSWORT`, `KEY_ALIAS` und `KEY_PASSWORT` hin (GitHub → Settings →
Environments → `release`: nur Etiketten `android-v*`, Pflichtprüfer). Nur der
Schritt *Release-Schlüssel bereitstellen* nennt sie, und er läuft nur dort;
gleichnamige Repository-Secrets fände GitHub trotzdem, sie gehören gelöscht.
Fehlen sie, wird der Lauf rot und nichts veröffentlicht. Danach prüft der
Job `apk-pruefen` das signierte APK (R8, 16-KB-Ausrichtung), erst dann
veröffentlicht `release` — ebenfalls in der Environment `release`, also erst
nach der Freigabe eines Prüfers. Siehe *Release signieren*.

## Erster Start
1. In der Webapp unter Einstellungen den QR-Code für die Android App erzeugen
   und in der App scannen — oder die https-Adresse des Servers von Hand
   eintragen, z. B. `https://brick.fritz.box`.
2. Bei Eingabe von Hand: den Fingerabdruck bestätigen (siehe unten), dann mit
   Benutzername und Passwort anmelden.

## Funktionen
- **Galerie** – Sets anzeigen, suchen, hinzufügen, löschen
- **Teile** – Alle Teile mit Bild, Farbe, Anzahl (paginiert)
- **Finanzen** – Portfolio-Wert mit BrickLink-Preisen

## API
Die App kommuniziert ausschliesslich über `/api/v1/` mit Bearer-Token-Authentifizierung.
Token-Verwaltung erfolgt über das Web-Interface unter Einstellungen → Mobile API.

## Datenschutz: mit wem die App spricht

- **Dein Server** — alles, was zum Konto gehört. Auch Bilder kommen nur über seinen
  Proxy; der Bild-Client lässt keine Anfrage an ein CDN durch (`netz/util/BildHosts.kt`).
- **GitHub** — nur die Update-Prüfung (`update/util/AppUpdate.kt`): beim Start, solange
  der Geräteschalter „Beim Start nach Updates suchen“ an ist (Vorgabe an), sonst auf
  Knopfdruck. Umleitungen folgt der Update-Client nur zu GitHub-Hosts.
- **Google Play-Dienste** — Barcode-Scan (ML Kit, nachgeladen) und Passkeys
  (Credential Manager). Die eingebaute Texterkennung kann Nutzungsstatistiken an
  Google senden.
- **Browser-Ziele** (BrickLink, Hersteller-Anleitungen) — nur auf Tipp.

Dieselbe Liste zeigt die App unter Einstellungen → Datenschutz.

## Sicherheit im Netz

**Nur https.** Die Release-App sendet nichts unverschlüsselt. Zwei Linien:
der Wächter (`netz/di/ServerWaechter.kt`) bricht jede http-Anfrage vor dem Netz ab,
und die Network-Security-Config (`app/src/main/res/xml/`) verbietet Klartext
für alle Hosts. Nur der Debug-Build darf http zu `localhost`, `127.0.0.1` und
`10.0.2.2` (Emulator), festgelegt in `app/src/debug/res/xml/` und
`NetworkPolicy.ENTWICKLUNGS_HOSTS`. Eine noch gespeicherte `http://`-Adresse
führt beim Start in die Einrichtung mit einer Anleitung (QR neu scannen oder
https-Adresse eintragen).

**Wem die App beim eigenen Server vertraut** (`data/util/ServerVertrauen.kt`):

| Weg | Was passiert |
| --- | --- |
| QR-Code mit `fp` | Der Fingerabdruck (SHA-256 des öffentlichen Schlüssels der Caddy-Wurzel) gilt schon für die erste Anfrage, gespeichert wird er erst nach gelungener Anmeldung. Ein Code kann von jedem stammen: Ohne Abtippen gilt er nur, wenn er auf eine System-Wurzel zeigt (deren Kette ohnehin öffentlich gültig sein muss) oder dem schon bestätigten Pin entspricht. Sonst verlangt der Dialog die letzten 24 Zeichen aus der Webapp (Einstellungen → Server-Zertifikat), beim ersten Einrichten wie bei einem abweichenden Pin. |
| Adresse von Hand | Beim ersten Kontakt bricht der Handshake ab, bevor etwas gesendet wird. Ein Dialog zeigt den Fingerabdruck in derselben Schreibweise wie die Webapp unter Einstellungen → Server-Zertifikat (`AB:CD:…`): bei einer Kette, die das System kennt (öffentliche CA), den der Wurzel aus dem System-Speicher, sonst den des obersten Zertifikats der Kette. Gespeichert wird er erst nach ausdrücklicher Bestätigung (Trust on first use, abgesichert durch den Vergleich). |
| Zertifikat später anders | Passt keine Kette mehr zum gespeicherten Fingerabdruck, geht nichts hinaus. Der Dialog zeigt den bisherigen und den neuen Fingerabdruck; übernommen wird nur, wenn man mindestens die letzten 24 Zeichen des neuen aus einer zweiten Quelle abschreibt (Webapp oder Zertifikatdetails des Browsers) — oder per neuem QR-Code. |

Die Dialoge zum Fingerabdruck erklären in einfachen Worten, was er ist und in
drei Schritten, wo er in der Webapp steht (Texte `zert_text_*`, `setup_qr_pin_abtippen`).

Unter einer gepinnten eigenen CA gilt nur ein Blatt, das einen Server
ausweisen darf (EKU `serverAuth` oder gar keine EKU-Angabe).

Weil die Wurzel gepinnt wird und nicht das Blatt, übersteht der Pin die
regelmässige Erneuerung des Serverzertifikats durch Caddy. Andere Hosts
(GitHub für die Selbstaktualisierung) prüft nur die System-CA-Liste.
Nutzerinstallierte CAs zählen nur, wenn der Nutzer das in den Einstellungen
ausdrücklich einschaltet.

**Logcat.** Die App schreibt nur über `data/util/Protokoll.kt`, und das nur im
Debug-Build; dort zeigt der Netzmitschnitt Anfrage- und Statuszeile, nie Rümpfe,
und schwärzt `Authorization`, `Cookie` und `Set-Cookie`. R8 entfernt im Release
zusätzlich alle `android.util.Log`-Aufrufe (`proguard-rules.pro`).
`ProtokollTest` verbietet rohe Log-Aufrufe ausserhalb der Hülle.

## Daten auf dem Gerät

Was zum Konto gehört, liegt verschlüsselt mit einem Schlüssel aus dem Keystore
(`data/util/Ablageschluessel.kt`, AES-GCM, je Zweck abgeleitet und an Dateiname und
Zweck gebunden):

| Ablage | Wie |
| --- | --- |
| Bestand (Room) | SQLCipher |
| API-Antworten, Widget-Zahlen | `AblageChiffre` |
| Vorschau-Ablage `files/vorschau/` | `AblageChiffre`; Klartext älterer Fassungen wird verworfen |
| Bild-Zwischenspeicher `cache/image_http_cache` | OkHttp-Cache auf `VerschluesseltesDateisystem`; Coil hat keinen eigenen Plattencache mehr, ein Klartext-Rest älterer Fassungen fällt beim Start weg |
| Gutschein-PDF (Nummer, PIN) | nie auf der Platte: in den Speicher geladen, gerendert aus einem memfd, der mit dem Betrachter oder dem Prozess vergeht |
| Bauanleitungen `cache/anleitung_*.bin` (höchstens 500 MB) | `VerschluesseltesDateisystem` (Zweck `anleitungen`, an den Dateinamen gebunden, Endmarker); angezeigt aus einem Bereich ohne Namen (siehe unten); beim Abmelden gelöscht, Klartext älterer Fassungen (`pdfview_*`) beim Start |
| Teileliste-PDF `files/pdf/teileliste.bin` | AES-GCM (Ablageschlüssel, Zweck „teileliste“); die Ziel-App liest über den nicht exportierten `TeilelistenProvider` aus dem Speicher (Proxy-Deskriptor), nie Klartext auf der Platte; nach 30 Minuten gelöscht (WorkManager, dazu beim Start und beim Abmelden) |

**Anleitungen anzeigen:** `PdfRenderer` braucht einen Deskriptor, in dem er
springt. Bis 64 MB entschlüsselt der Betrachter in einen memfd; darüber
(Anleitungen haben bis 300 MB) in eine Datei unter `cache/anleitung_anzeige/`,
deren Name gelöscht wird, bevor das erste Byte Klartext hineinkommt. Ein
memfd dieser Grösse belegte den Arbeitsspeicher der App und machte sie zum
ersten Opfer des Low-Memory-Killers. Der Klartext ist dann nur über den
offenen Deskriptor erreichbar, also für den, der ohnehin im Prozess der App
steckt; er vergeht mit dem Betrachter oder dem Prozess. Drucken und
Herunterladen gibt es nur für Anleitungen, nicht für Gutscheine (der
Druckdialog kann „Als PDF speichern“).

**Abmelden:** Token, Antwort-Cache, Bestand und Ausgang, Vorschauen, beide
Bildcaches, PDFs, Update-APK, Widget-Zahlen und alle Meldungen der App sind danach
weg, die Marke des Preisalarms ebenfalls. Zuletzt erneuert `Ablageschluessel` den
Schlüssel (Datei und Keystore-Alias neu): Was mit dem alten verschlüsselt war, auch
gelöschte Reste auf dem Flash, ist nicht mehr lesbar. `AbmeldenRaeumtAllesTest`
prüft das ausgeführt.

**Token-Schlüssel ohne `setUnlockedDeviceRequired`:** Preisalarm, Widget und
Ausgang senden im Hintergrund, auch bei gesperrtem Gerät (Begründung in
`data/util/TokenTresor.kt`). Abgefedert durch die Rotation mit Wiederverwendungs-
erkennung am Server und die harte Höchstdauer von 180 Tagen.

**Pins und Nutzer-CA-Schalter verschlüsselt:** Sie liegen in `design_spiegel.xml`
als `Vertrauenschiffre` (AES-GCM, an den Namen des Eintrags gebunden) unter einem
eigenen Ablageschlüssel (`vertrauen.schluessel`), den das Abmelden nicht erneuert:
Ein Pin gehört zum Server, nicht zum Konto. Was sich nicht entschlüsseln lässt,
gilt als „kein Pin“ bzw. „Schalter aus“; der Nutzer bestätigt dann neu. Klartext
älterer Fassungen wird einmal übernommen und gelöscht, später auftauchender nur
gelöscht (`VertrauenVerschluesseltTest`). Wer Code mit der UID der App ausführt,
kann den Keystore weiterhin benutzen wie die App.

**Update-Angebot nur aus frischer Beschreibung (sec12 H2):** Ist die signierte
Beschreibung abgelaufen oder älter als eine schon gesehene, bietet die App kein
Update an; die Einstellungen sagen, warum. Sonst hielte eine wieder
eingespielte, echt signierte Beschreibung auf einer bekannt verwundbaren
Zwischenfassung fest.

## Manipulationsschutz (MASVS-RESILIENCE)

Bewusst keine Root-, Debugger-, Hook- oder Play-Integrity-Prüfung. Die App ist
quelloffen und selbst gehostet; wer sie auf seinem Gerät untersucht, ist in der
Regel ihr Besitzer. Solche Prüfungen lassen sich mit Frida oder Magisk umgehen
und sperren Nutzer eigener ROMs aus, ohne die Daten zu schützen. Was sie
schützen soll, liegt an anderer Stelle: Der Server prüft jeden Zugriff,
lokale Ablagen sind verschlüsselt, Updates sind signiert und werden vor der
Installation geprüft.

R8 verkleinert und benennt um. Die eigenen Keep-Regeln (`app/proguard-rules.pro`)
halten nur, was über Reflexion oder das Framework erreicht wird: bei Workern
Konstruktor und `doWork()` und Rooms Datenbank-Konstruktoren. Die API-Modelle
werden umbenannt; ihre Serializer hält die Regel von kotlinx.serialization, und
`tools/apk-pruefen.py` prüft am fertigen APK, dass `data.model.SetItem` nicht
mehr unter seinem Namen steht.

**PDFs im isolierten Prozess:** `PdfRenderer` (pdfium) läuft nur in
`ui/pdf/PdfRenderDienst`, einem Dienst mit `isolatedProcess`: ohne
Berechtigungen, Dateien, Token und Ablageschlüssel. Er bekommt den Deskriptor
und gibt Bitmaps zurück. Anleitungen stammen inhaltlich von Dritten; eine
pdfium-Lücke träfe so nur den leeren Render-Prozess.

**TOTP-Geheimnis an die Authenticator-App:** immer über die Systemauswahl
(`oeffneMitAuswahl`), nur `otpauth://totp|hotp`. Eine fremde App bekommt das
Geheimnis nur, wenn man sie dort auswählt.

## Hinweise
- Bilder lädt Coil über den Bild-Client; auf der Platte liegen nur dessen
  verschlüsselter HTTP-Zwischenspeicher und die Vorschau-Ablage.


## Module

Abhängigkeiten nur in diese Richtung: `app → feature-* → core-*`; kein Bereich
kennt einen anderen (`ModulgrenzenTest` prüft es an den Build-Dateien).

Den gemeinsamen Android-Block setzen Konventions-Plugins aus `build-logic/`
(ein eigener Gradle-Bau, eingebunden in `settings.gradle.kts`, Plugin-IDs im
Versionskatalog). Ein Modulskript nennt nur seine Plugins, den Namespace, seine
Modulkanten und echte Zusatzabhängigkeiten:

| Plugin | setzt |
| --- | --- |
| `brickinventory.android.library` | `com.android.library`, compileSdk/minSdk aus `Sdk.kt`, Java und Kotlin 17 |
| `brickinventory.android.application` | dasselbe für `com.android.application`, dazu targetSdk |
| `brickinventory.android.unittests` | JVM-Tests: `isReturnDefaultValues`, voller Stack im Protokoll, Gruppe `unit-tests` |
| `brickinventory.android.compose` | Compose-Übersetzer, `buildFeatures.compose`, BOM und Gruppe `compose` |
| `brickinventory.android.hilt` | KSP, Hilt, `hilt-android` und `hilt-compiler` |
| `brickinventory.android.feature` | die vier oben und `core-ktx` — ein Bereich |
| `brickinventory.detekt` | Aufgabe `detekt` (Regeln in `config/detekt/detekt.yml`, Länge und Verzweigung alter Funktionen in `baseline.xml`, Obergrenze `tools/detekt-obergrenze.txt`); kommt mit library/application/jvm.library |
| `brickinventory.jvm.library` | `org.jetbrains.kotlin.jvm`, Java und Kotlin 17, Testprotokoll, detekt — für `core-model` |

Modulkanten (`project(":…")`) trägt keine Konvention ein; sie stehen im Skript
des Moduls, wo `ModulgrenzenTest` sie liest. Ein SDK-Sprung ist eine Zeile in
`build-logic/convention/src/main/kotlin/ch/brickinventoryapp/buildlogic/Sdk.kt`.
`core-model` bleibt reines Kotlin (`brickinventory.jvm.library`).

| Modul | Paketstamm | Inhalt |
| --- | --- | --- |
| `core-model` | `ch.brickinventoryapp.model` | Server- und UI-Modelle, reine Regeln — reines Kotlin, ohne Android |
| `core-ressourcen` | — (nur Ressourcen) | Texte (de/en), Schriften, Bilder; `ch.brickinventoryapp.ressourcen.R` |
| `core-netz` | `ch.brickinventoryapp.netz` | Wächter-Interceptor (`ServerWaechter`), Netzrichtlinie, Adress- und Bild-Host-Prüfung; kennt weder Room noch Hilt |
| `core-data` | `ch.brickinventoryapp.data` | Retrofit, OkHttp, Repositories, Room samt Schema (`core-data/schemas`), DataStore, verschlüsselte Ablagen, Ausgang, Abmelde-Arbeiter, PDF-Export |
| `core-update` | `ch.brickinventoryapp.update` | Selbstaktualisierung: signierte Beschreibung, Frische, APK-Download, Signaturvergleich, Installation; hängt an `core-data` |
| `core-dienste` | `ch.brickinventoryapp.dienste` | CSV-Import als Vordergrund-Dienst, stündlicher Preisalarm (WorkManager); hängt an `core-data` |
| `core-ui` | `ch.brickinventoryapp.ui` | Theme und gemeinsame Composables (Karten, Zeilen, Filter, Kamera-Bausteine) |
| `core-zustand` | `ch.brickinventoryapp.zustand` | Sitzung, Blickfeld, Bestandssignal, Texte, Basis der Bereichs-ViewModels, AppViewModel |
| `core-testing` | `ch.brickinventoryapp.testing` | Testhilfen (Testserver, Testdienste, `Quellen`), nur als `testImplementation` |
| `feature-anmeldung` | `ch.brickinventoryapp.anmeldung` | Anmelden, Server einrichten, QR |
| `feature-katalog` | `ch.brickinventoryapp.katalog` | Katalog und Katalog-Detail |
| `feature-sammlung` | `ch.brickinventoryapp.sammlung` | Galerie, Set-Detail, Merkliste, Käufe, Vergleich, Scanner |
| `feature-teile` | `ch.brickinventoryapp.teile` | Teile, Minifiguren, eigene Einträge, Teilelisten |
| `feature-finanzen` | `ch.brickinventoryapp.finanzen` | Finanzen, Gutscheine, PDF-Betrachter |
| `feature-konto` | `ch.brickinventoryapp.konto` | Einstellungen |
| `feature-verwaltung` | `ch.brickinventoryapp.verwaltung` | Monitoring für Verwalter |
| `app` | `ch.brickinventoryapp.app` | Navigation, Hilt-Einstieg, Activity, Widget |

Jedes Modul hat seinen eigenen Paketstamm: Paket = Stamm + bisheriger
Unterpfad (`ui.screens` in `feature-sammlung` heisst
`ch.brickinventoryapp.sammlung.ui.screens`); `core-ui` und `core-data` beginnen
schon mit ihrem Stamm (`ch.brickinventoryapp.ui.*`, `ch.brickinventoryapp.data.*`).
Die Tests eines Moduls liegen direkt im Stamm. Aus einem Import ist so das Modul
ablesbar, und kein Paket verteilt sich auf zwei Module; `ModulgrenzenTest` prüft
es an jeder Kotlin-Datei. Die R-Klassen folgen dem `namespace` des Moduls
(`ch.brickinventoryapp.core.ui.R`, `ch.brickinventoryapp.ressourcen.R`), die der
App bleibt `ch.brickinventoryapp.R`. Was ein Modul dem anderen zeigt, ist
öffentlich, der Rest `internal`.

## Tests

```bash
./gradlew testDebugUnitTest :core-model:test
```

Die Tests liegen neben dem Code ihres Moduls; was mehrere Bereiche zusammen
prüft (Bildschirmfotos, Abläufe, Struktur), liegt in `app/src/test`. Robolectric
und Roborazzi laufen auf der JVM, ein Gerät braucht kein Test.

- `QuelltextRatscheTest` hält fest, wie viele Testfunktionen Quelltext lesen,
  wie oft Tests in Echtzeit warten und wie viele Namen voll qualifiziert stehen;
  jede Zahl steht genau auf dem gemessenen Wert und darf nur sinken.
- `gegenproben/` enthält Patches, die etwas kaputt machen; der CI-Job
  `gegenproben` misst, dass der im Kopf genannte Test dann rot wird
  (`tools/gegenproben.py`). Nicht jede Testklasse hat einen; wer einen Test
  schreibt, legt seinen dazu.
- ViewModel- und Oberflächentests laufen im Takt: `PfadServer.imTakt()` antwortet
  ohne Netz im aufrufenden Faden und liest jede Antwort gegen das DTO der Methode.

## Abhängigkeiten und Lieferkette

`renovate.json` liegt im Wurzelverzeichnis (nur dort liest Renovate sie) und
gilt für Gradle, die npm-Pakete der Web-App, die Docker-Images (Digests) und
die GitHub-Actions (Commit-SHAs). Renovate erzeugt montags früh gesammelte Pull-Requests für kleine
Sprünge und einzelne für grosse. `graphics-path` steigt nicht automatisch,
`datastore-preferences` kommt als eigener PR: Ob die Bibliotheken 16-KB-
ausgerichtet sind, misst die CI am fertigen APK (siehe INVARIANTEN.md). Die
Begründung steht als `description` direkt in der Regel.

### Gradle-Wrapper

Vier Dateien gehören zusammen und müssen alle im Repository liegen — ohne sie
lässt sich das Projekt auf einem frischen Rechner nicht bauen. `.gitignore`
nimmt sie deshalb ausdrücklich von den `build/`-Regeln aus:

```
gradlew                              Startskript (Linux/macOS, muss ausführbar sein)
gradlew.bat                          Startskript (Windows)
gradle/wrapper/gradle-wrapper.jar    lädt und startet die Distribution
gradle/wrapper/gradle-wrapper.properties   welche Fassung, und ihr Hash
```

`gradle-wrapper.jar` wird bei **jedem** Build ausgeführt. Eine untergeschobene
Fassung wäre beliebiger Code auf jedem Entwicklerrechner und in der CI —
`gradle/actions/setup-gradle` prüft die Datei in jedem Gradle-Job von
`.github/workflows/android.yml` gegen die von Gradle veröffentlichten
Prüfsummen.

Die Zeilenenden der beiden Startskripte hält `.gitattributes` fest: `gradlew`
auf LF, `gradlew.bat` auf CRLF. Ohne das macht ein Windows-Checkout mit
`core.autocrlf=true` aus `gradlew` eine Datei, die keine Shell mehr startet.

#### Prüfsumme der Distribution

`gradle-wrapper.properties` enthält ein `distributionSha256Sum`. Damit wird die
heruntergeladene Gradle-Distribution gegen einen erwarteten Hash geprüft, statt
blind ausgepackt zu werden — bei einer App, die einen langlebigen Bearer-Token
hält, ist das die billigste Absicherung, die es gibt.

Der eingetragene Wert stammt aus Gradles Veröffentlichung und gilt nur für die
Fassung in `distributionUrl` derselben Datei. Ob er die amtliche Prüfsumme ist,
misst `tools/gradle-wrapper-pruefen.py` in jedem CI-Job, bevor Gradle startet.

**Beim Anheben der Gradle-Fassung muss die Zeile mitwandern**, sonst bricht der
nächste Build mit „Verification of Gradle distribution failed" ab. Die neue
Prüfsumme lässt sich nicht raten, sie muss von der Quelle kommen — entweder von
<https://gradle.org/release-checksums/> oder:

```bash
curl -sS https://services.gradle.org/distributions/gradle-<fassung>-bin.zip.sha256
```

Am einfachsten erledigt das der Wrapper selbst, dann stimmen Fassung und Hash
automatisch zusammen:

```bash
./gradlew wrapper --gradle-version <fassung> --gradle-distribution-sha256-sum <hash>
```

Danach `./gradlew --version` — schlägt es fehl, stimmt die Zeile nicht.

#### Prüfsummen der Abhängigkeiten

`gradle/verification-metadata.xml` hält SHA-256 und PGP-Schlüssel jeder
Abhängigkeit fest. Nach einem Versionssprung unter *Actions → Android-App → Run
workflow* den Zweig wählen und `pruefsummen` ankreuzen. Der Lauf legt einen
Zweig `pruefsummen/<Lauf>` und einen Pull-Request an; dessen Text listet neue
Komponenten, geänderte Prüfsummen und neu vertraute Schlüssel — solche mit
Gruppen-Regex zuerst, denn sie gelten für jedes künftige Paket der Gruppe.
Solche Regex fasst Gradle selbst zusammen. Eine Liste einzelner Gruppen statt
der Regex verfehlte Plugin-Marker (z. B. `com.android.library`), die nur über
die Regex vertraut waren; deshalb bleibt es bei der Regex, und die Prüfsumme
jedes Artefakts gilt zusätzlich.
Dafür einmalig *Settings → Actions → General → Allow GitHub Actions to create
and approve pull requests* einschalten; sonst bleibt nur der Zweig, und der
Pull-Request wird von Hand gestellt. Die CI des Zweigs startet nicht von selbst
(Pull-Request schliessen und wieder öffnen).

### Was NICHT automatisch aktualisiert werden sollte

Diese Sprünge sind Umbauten und gehören einzeln gebaut und ausprobiert:

- **Navigation 2 → 3**: anderes Navigationsmodell, betrifft alle vier
  Teilgraphen.
- **AGP 9.5**: Mit 9.5.0 fehlten im Release-APK Texte, die erreichbarer Code
  benutzt; AGP bleibt auf 9.4.1, bis das geklärt ist (Begründung im
  Versionskatalog bei `agp`).

Die Stände stehen in `gradle/libs.versions.toml`; welche neuere Fassung es
gibt, meldet der CI-Schritt „Sind die Abhängigkeiten auf der neuesten Fassung?“
(`tools/fassungen-pruefen.py`).

## Zwei Arten von Tests

Der Unterschied ist wichtig:

**Verhaltenstests** führen Code aus. `BrickRepositoryErrorMappingTest` startet
einen echten HTTP-Server (MockWebServer) und prüft, was das Repository aus
einer Antwort macht — 409 mit Fehlerrumpf, 500 ohne, Zeitüberschreitung,
Verbindungsabriss. `FehlerTexteTest` ruft die Zuordnung Ursache → Text direkt
auf. Solche Tests sind die wertvollen: Sie finden, ob eine Regel WIRKT.

**Quelltextlesende Tests** suchen Muster im Code und finden nur, ob eine Regel im
Code STEHT, nicht ob sie wirkt. Sie bleiben für Struktur (Dateien, Abhängigkeiten,
Verbote). Compose-Bildschirme, Navigation und DataStore laufen mit Robolectric und
der Compose-Testregel auf der JVM und bekommen Verhaltenstests.

Faustregel: Was sich aufrufen lässt, bekommt einen Verhaltenstest. Die Frage lohnt
sich auch, wo es schwer scheint: Was schwer prüfbar ist, ist
meistens nicht zu kompliziert, sondern nur mit etwas verwoben, das es nicht
braucht. `fehlerTextId()` und der Ordner-Parameter von `ResponseCache` sind
beides Beispiele dafür.

Gemeinsame Helfer für die zweite Art stehen in `core-testing/…/Quellen.kt` —
insbesondere `fenster()` (misst ZEILEN, nicht Zeichen) und `ohneKommentare()`.
`Quellen.wurzel` legt die Quellen aller Module zu einem Baum zusammen.

## Release signieren

Ein Release-Build ohne Signatur ergibt ein APK, das sich nicht installieren
lässt. Vier Angaben werden gebraucht: Pfad zum Schlüsselspeicher, dessen
Passwort, der Alias und dessen Passwort.

Das Buildskript liest sie aus ZWEI Quellen, in dieser Reihenfolge —
Umgebungsvariable zuerst, dann Gradle-Property:

| Umgebungsvariable         | Gradle-Property         |
|---------------------------|-------------------------|
| `BRICK_KEYSTORE_PFAD`     | `brickKeystorePfad`     |
| `BRICK_KEYSTORE_PASSWORT` | `brickKeystorePasswort` |
| `BRICK_KEY_ALIAS`         | `brickKeyAlias`         |
| `BRICK_KEY_PASSWORT`      | `brickKeyPasswort`      |

Fehlen sie, baut `assembleRelease` UNSIGNIERT durch statt abzubrechen — ein
lokaler Bau soll nicht daran scheitern, dass jemand die Werte nicht gesetzt hat.

### Schlüsselspeicher erzeugen (einmalig)

```
keytool -genkeypair -v -keystore brick.jks -alias brickinventory \
  -keyalg RSA -keysize 2048 -validity 10000
```

DIE DATEI GEHÖRT NICHT INS REPOSITORY und braucht eine Sicherungskopie
ausserhalb des Rechners. Geht sie verloren, lässt sich eine installierte App
nie wieder aktualisieren — Android nimmt Updates nur mit demselben Schlüssel
an. Neu installieren hiesse deinstallieren, und damit wären die lokalen Daten
weg.

### Lokal: einmal hinterlegen

In `C:\Users\<name>\.gradle\gradle.properties` (Linux/macOS:
`~/.gradle/gradle.properties`):

```
brickKeystorePfad=C:/schluessel/brick.jks
brickKeystorePasswort=…
brickKeyAlias=brickinventory
brickKeyPasswort=…
```

Diese Datei liegt AUSSERHALB des Projekts und kann deshalb nicht versehentlich
mitcommittet werden — anders als eine `keystore.properties` neben dem
Buildskript, die beim nächsten `git add -A` dabei wäre. Vorwärtsschrägstriche
auch unter Windows: Ein Backslash ist in einer Properties-Datei ein
Fluchtzeichen.

Danach genügt `./gradlew assembleRelease`.

### Lokal: nur für eine Sitzung

PowerShell:

```powershell
$env:BRICK_KEYSTORE_PFAD = "C:\schluessel\brick.jks"
$env:BRICK_KEYSTORE_PASSWORT = "…"
$env:BRICK_KEY_ALIAS = "brickinventory"
$env:BRICK_KEY_PASSWORT = "…"
.\gradlew assembleRelease
```

### GitHub Actions

Der Schlüsselspeicher ist eine Binärdatei und muss als Base64 hinterlegt
werden:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("brick.jks")) | Set-Clipboard
```

Unter **Settings → Environments → New environment** die Environment `release`
anlegen: *Deployment branches and tags* auf *Selected branches and tags* mit
der **Etikett-Regel** `android-v*` (keine Zweig-Regel, auch nicht `main`) und
*Required reviewers* setzen, *Prevent self-review* an. Die Jobs `signieren` und
`release` warten dann je auf ein Ja. Dort unter *Environment secrets* die
Secrets der Tabelle unten anlegen. Der Job `signieren` liest diese Regeln über die API und
signiert nicht, wenn kein Pflichtprüfer eingetragen ist oder die Environment
mehr als das Etikett `android-v*` zulässt.

Unter **Settings → General → Releases** *Immutable releases* einschalten: Der
Anhang `BrickInventory-<versionCode>.apk` im Release jedes Etiketts ist das,
worauf die signierte Beschreibung zeigt; er soll sich nach dem Veröffentlichen
nicht mehr ändern lassen. Der Workflow ersetzt ihn ohnehin nie.

Dazu ein **Tag-Ruleset** (Settings → Rules → Rulesets → New tag ruleset) für
`refs/tags/android-v*`: Anlegen, Ändern und Löschen nur für Administratoren
(Bypass-Liste), *Restrict updates* und *Restrict deletions* an. Ein Etikett
lässt sich sonst von jedem mit Schreibrecht setzen oder umhängen; der Workflow
signiert ohnehin nur Commits, die auf `main` liegen. Dasselbe Ruleset auch für
`refs/tags/apk-neuste` (*Restrict deletions*, *Restrict updates*).

Das Release `apk-neuste` muss veränderlich bleiben (der Workflow ersetzt dort
APK und Beschreibung); *Immutable releases* gilt nur für Releases, die nach dem
Einschalten veröffentlicht werden, und schützt es darum nicht. Umgekehrt darf
es bei eingeschalteter Einstellung nie gelöscht werden: Neu angelegt wäre es
unveränderlich, und jedes weitere Hochladen scheiterte. Gegen ein
Zurückhalten dort wirkt die Frist der Beschreibung (unten). Wer `contents:
write` hat, kann Anhänge ersetzen: Schreibrecht nur an wenige Personen,
Zwei-Faktor-Pflicht für die Organisation und fein granulierte Token mit
Ablaufdatum statt klassischer PATs mit `repo`-Scope.

**Übergang:** Gleichnamige Repository-Secrets danach löschen. Der Workflow
braucht sie nicht mehr; solange sie bestehen, könnte jeder Job auf `main` sie
lesen, auch ohne Freigabe.

### Was ein Etikett vor dem Signieren erfüllen muss (sec17)

Der Job `signieren` bricht ab, statt zu signieren, wenn eine dieser Bedingungen fehlt;
die Meldung nennt jeweils die Einstellung:

- **Environment `release`:** mindestens ein Pflichtprüfer, nur das Etikett `android-v*`
  und *Allow administrators to bypass* **aus** (`can_admins_bypass: false`).
  *Prevent self-review* ergibt nur eine Warnung, solange nur eine Person prüft.
- **`main` geschützt per Ruleset** (Settings → Rules → Rulesets → New branch ruleset,
  Ziel `main`): *Require a pull request before merging*, *Require status checks to
  pass* (Android-App, Sicherheit) und *Block force pushes*. Gelesen wird
  `GET /repos/{repo}/rules/branches/main`; klassische Branch Protection allein zählt
  dort nicht.
- **Sicherheitslauf grün:** Der Job `Trivy (Android-Abhängigkeiten)` in `sicherheit.yml`
  muss für genau den Commit des Etiketts grün sein (läuft bei jedem Push auf `main`).
  Ist er noch nicht fertig, den Android-Lauf danach neu starten. Ausnahmen nur mit
  Grund und Frist in `.github/trivy-android.ignore`.
- **Werkzeuge:** `zipalign` und `apksigner.jar` aus `build-tools/37.0.0` des Images
  `ubuntu-24.04`, gegen feste Prüfsummen. Verschwindet die Fassung aus dem Image,
  bricht der Schritt ab; die neuen Werte stehen dann im Protokoll eines Probelaufs und
  werden nach Prüfung im Schritt „Signieren“ eingetragen.

Etiketten bauen ohne Gradle-Cache aus anderen Läufen und mit leerem
Gradle-Benutzerverzeichnis; den Cache schreibt sonst nur der Baujob. Ausserhalb von
Etiketten liegt das probe-signierte APK als `BrickInventory.apk.probe-nicht-installieren`
im Artefakt. Die Herkunft bescheinigt `.github/workflows/android-bescheinigung.yml`
(APK, Beschreibung, Bundle); `release` veröffentlicht nur Dateien mit den Prüfsummen,
die `signieren` ausgab.

### Release-Zertifikat und Fassung

**Vor einer Neuinstallation prüfen** (der feste Link `apk-neuste` kann von jedem mit
Schreibrecht ersetzt werden; ein Update prüft die App selbst): Das Release-APK ist
mit dem Zertifikat

    SHA-256 a51ff2f425d94b6f31a06b7805013cc801791b28e58404dc26c7c8298380af06

signiert. `apksigner verify --print-certs BrickInventory.apk` muss in der Zeile
„certificate SHA-256 digest“ genau diesen Wert zeigen; derselbe steht im Text jedes
Release. Herkunft: `gh attestation verify BrickInventory.apk --repo addict85/BrickInventory
--signer-workflow addict85/BrickInventory/.github/workflows/android-bescheinigung.yml`
(ebenso für `version-signiert.json` und das Bundle).

Vor dem Veröffentlichen prüft der Job `apk-pruefen` zweierlei
(`tools/release-pruefen.py`):

- **Zertifikat:** Das APK muss mit einem der Zertifikate in
  `tools/release-zertifikat.sha256` signiert sein. Den Wert liefert
  `keytool -list -v -keystore brick.jks` (Zeile `SHA256:`; Doppelpunkte und
  Grossschreibung sind gleichgültig). Wird der Schlüssel je gewechselt
  (Rotation), kommt der neue Wert als zweite Zeile dazu. Ein Lauf ohne Etikett
  signiert mit einem Wegwerfschlüssel und muss genau an dieser Prüfung
  scheitern; so läuft sie bei jedem Bau.
- **Fassung:** Der versionCode muss über dem der veröffentlichten
  Beschreibung liegen (gleich nur für denselben Commit); gelesen wird die
  signierte, `version.json` nur, solange `apk-neuste` noch keine trägt. Ein Etikett auf einem
  älteren Commit von `main` wird so nicht zum „neusten APK“. Der Job `release`
  prüft dasselbe unmittelbar vor dem Hochladen noch einmal; zwei Etiketten
  laufen dort nacheinander (`concurrency: apk-neuste`).

### Signierte Beschreibung, Prüfsumme des Baus

- **`version-signiert.json`** (im Release `apk-neuste`): Der Job `signieren`
  schreibt versionCode, versionName, Commit, die Adresse des
  Fassungsanhangs, Grösse und SHA-256 des APK und signiert das zweimal
  (`openssl dgst -sha256`): mit dem eigenen **Beschreibungsschlüssel**
  (`beschreibungssignatur`, unten) und mit dem APK-Schlüssel (`signatur`, nur
  noch für Fassungen ohne Beschreibungsschlüssel). Die App liest nur diese Datei
  und prüft das geladene APK danach gegen die Prüfsumme. Wer nur Schreibrecht am
  Repository hat, kann so kein Update umleiten oder eine ältere Fassung
  anbieten. `apk-pruefen` prüft Signaturen und Inhalt vor dem Veröffentlichen.
- **Frist (sec10 N1):** Die Beschreibung trägt `ausgestellt` und `gueltigBis`
  (30 Tage, Sekunden seit 1970, UTC). Die App merkt sich den höchsten gesehenen
  versionCode und den spätesten Ausstellungszeitpunkt. Eine ältere oder
  abgelaufene Beschreibung meldet sie in den Einstellungen („veraltet oder
  manipuliert“) statt „aktuell“; ein Zurückhalten durch erneutes Hochladen einer
  alten Datei bleibt so nicht mehr still. **Auffrischen:** Spätestens alle 30
  Tage ein neues Etikett `android-v…` setzen, notfalls auf denselben Commit von
  `main`. Gleicher versionCode und Commit gelten dabei als Wiederholung, die App
  bietet nichts an und sieht nur die neue Frist.
- **`version.json` (unsigniert):** Nur noch bis zum Stichtag 01.02.2027 für
  Fassungen vor sec8 N4, die die signierte Beschreibung nicht kennen; danach
  löscht der Job `release` den Anhang. Ohne sie blieben diese Geräte ohne
  Meldung auf ihrer Fassung; mit ihr holen sie sich einmal die neue und lesen
  ab dann die signierte.
- **Prüfsumme des Baus:** Der Baujob misst das unsignierte APK und Bundle gleich
  nach `assembleRelease`, bevor Lint und weitere Gradle-Läufe Projektcode
  ausführen; `signieren` signiert nur genau diese Bytes.
- **Schlüsselrotation:** Mit Beschreibungsschlüssel hängt das Finden von Updates
  nicht mehr am APK-Schlüssel; eine v3-Rotation betrifft nur noch Fassungen ohne
  ihn. Für die muss eine Fassung lang auch die Beschreibung mit dem alten
  APK-Schlüssel signiert sein (sie kennen nur ihren Signierer).

### Beschreibungsschlüssel (sec11 H1)

Ein Schlüssel signiert Daten nur für einen Zweck: Der APK-Schlüssel signiert
APKs, die Beschreibung bekommt einen eigenen ECDSA-Schlüssel (P-256). Kennt die
App einen solchen Schlüssel (`core-ressourcen/src/main/res/raw/beschreibungs_schluessel.pem`),
nimmt sie nur noch dessen Signatur an; solange die Datei leer ist, gilt der
Übergangsweg über die Signierer der App.

**Stand:** Die Datei ist noch leer (Betreiberaufgabe). Jeder CI-Lauf warnt
„Beschreibungsschlüssel fehlt“, und ein Etikett `android-v…` bricht im Job
`apk-pruefen` ab, bis die Schritte unten erledigt sind; danach meldet derselbe
Schritt „Beschreibungsschlüssel steht in der App.“

Einrichten (einmalig, in dieser Reihenfolge):

1. Schlüssel erzeugen, ausserhalb des Repositorys:
   `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out beschreibung.pem`
2. Den Inhalt von `beschreibung.pem` als Secret `BESCHREIBUNG_SCHLUESSEL` in die
   Environment `release` legen. Ab dem nächsten Etikett trägt die Beschreibung
   beide Signaturen.
3. Den öffentlichen Teil (`openssl pkey -in beschreibung.pem -pubout`) an
   `beschreibungs_schluessel.pem` anhängen und veröffentlichen. Ab dieser
   Fassung gilt für die App nur noch die Beschreibungssignatur. Fehlt das Secret
   bei einem Etikett, obwohl die App einen Schlüssel nennt, bricht `apk-pruefen`
   ab, statt eine Beschreibung zu veröffentlichen, die die Geräte ablehnen.

Wechseln: den neuen öffentlichen Schlüssel dazuschreiben und veröffentlichen,
erst danach das Secret tauschen, den alten Eintrag später entfernen. Die App
nimmt jeden Schlüssel der Datei an.

Die Signatur mit dem APK-Schlüssel (`signatur`) bleibt, bis keine Fassung ohne
Beschreibungsschlüssel mehr verbreitet ist; danach im Job `signieren` diese
Signatur und in `apk-pruefen` ihre Prüfung entfernen.

Dazu gehört eine Branch-Protection (oder ein Ruleset) auf `main`: Merge nur
über Pull-Request mit grüner CI, kein Force-Push. Sonst genügt ein direkter
Push, um Code bis vor die Freigabe zu bringen.

| Secret              | Inhalt                        |
|---------------------|-------------------------------|
| `KEYSTORE_BASE64`   | der kopierte Base64-Text      |
| `KEYSTORE_PASSWORT` | Passwort des Schlüsselspeichers |
| `KEY_ALIAS`         | `brickinventory`              |
| `KEY_PASSWORT`      | Passwort des Schlüssels       |
| `BESCHREIBUNG_SCHLUESSEL` | privater Beschreibungsschlüssel (PEM, oben); bis zur Einrichtung leer |

Der Job `signieren` schreibt den Schlüsselspeicher nach `$RUNNER_TEMP`, signiert
das unsignierte APK aus dem Bau-Job mit `apksigner` aus dem SDK des Runners und
gibt nur das Ergebnis weiter; Gradle und Werkzeuge aus dem Repository sieht der
Schlüssel nie. Fehlt für ein Etikett eines der Secrets, wird der Lauf rot, statt
etwas Uninstallierbares zu veröffentlichen.

**Restrisiko:** Der Signaturschlüssel liegt als Environment-Secret bei GitHub.
Wer die Environment-Regeln ändern kann (Administrator), kann signieren lassen.
Ein Schlüssel ausserhalb von GitHub (HSM/KMS) wäre stärker; für eine
selbst verteilte App ohne Play-Konto ist das hier bewusst nicht umgesetzt.

### Prüfen, ob es geklappt hat

```
apksigner verify --print-certs BrickInventory.apk
```

Das Werkzeug liegt im Android SDK unter `build-tools/<version>/`.
