# BrickInventory Manager Android App

Kotlin + Jetpack Compose App für den BrickInventory Manager Server.

## Voraussetzungen
- **JDK 17** (JDK 21 funktioniert ebenfalls) — `java -version` muss 17 oder
  höher melden
- **Android SDK** mit Plattform **36** und Build-Tools **36.x**
  (`compileSdk = targetSdk = 36`, siehe `app/build.gradle.kts`)
- Android Studio in einer Fassung, die **AGP 9.2** versteht — nur nötig, wenn
  in der IDE gearbeitet wird; auf der Kommandozeile reichen JDK und SDK
- Gradle muss **nicht** installiert sein: der mitgelieferte Wrapper holt
  Gradle 9.6.1 selbst (siehe *Gradle-Wrapper* weiter unten)
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
sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0"
sdkmanager --licenses
```

Danach:

| Befehl | Ergebnis |
| --- | --- |
| `./gradlew testDebugUnitTest` | JVM-Unit-Tests, Bericht unter `app/build/reports/tests/` |
| `./gradlew assembleDebug` | `app/build/outputs/apk/debug/app-debug.apk` — mit dem Debug-Schlüssel signiert, direkt installierbar |
| `./gradlew assembleRelease` | `app/build/outputs/apk/release/BrickInventory.apk` — minifiziert; signiert nur, wenn die Schlüsselwerte gesetzt sind (siehe unten) |
| `./gradlew lintRelease` | `app/build/reports/lint-results-release.html` |
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

Der Wrapper lädt beim ersten Aufruf Gradle 9.6.1 (~140 MB), danach ziehen AGP,
Kotlin, KSP und die Abhängigkeiten nochmals einige hundert MB. Das passiert
einmal pro Rechner; Gradle legt alles unter `~/.gradle/` ab.

Benötigte Hosts — hinter einem restriktiven Proxy müssen diese erreichbar sein:

- `services.gradle.org` (die Gradle-Distribution)
- `dl.google.com` / `maven.google.com` (AGP, AndroidX, ML Kit, das SDK selbst)
- `repo1.maven.org` (Kotlin, Retrofit, OkHttp, Coil, Hilt)
- `plugins.gradle.org` (Plugin-Auflösung)

### Continuous Integration

`.github/workflows/android.yml` im Wurzelverzeichnis des Repositories macht auf
einem `ubuntu-latest`-Runner dasselbe wie oben beschrieben: prüfen, ob der
Wrapper vollständig im Repository liegt, dann `testDebugUnitTest`,
`assembleRelease` und `lintRelease`. Die Test- und Lint-Berichte hängen als
Artefakt am Lauf (auch bei rotem Lauf — gerade dann werden sie gebraucht).

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

## Sicherheit im Netz

**Nur https.** Die Release-App sendet nichts unverschlüsselt. Zwei Linien:
der Wächter (`di/ServerWaechter.kt`) bricht jede http-Anfrage vor dem Netz ab,
und die Network-Security-Config (`app/src/main/res/xml/`) verbietet Klartext
für alle Hosts. Nur der Debug-Build darf http zu `localhost`, `127.0.0.1` und
`10.0.2.2` (Emulator), festgelegt in `app/src/debug/res/xml/` und
`NetworkPolicy.ENTWICKLUNGS_HOSTS`. Eine noch gespeicherte `http://`-Adresse
führt beim Start in die Einrichtung mit einer Anleitung (QR neu scannen oder
https-Adresse eintragen).

**Wem die App beim eigenen Server vertraut** (`util/ServerVertrauen.kt`):

| Weg | Was passiert |
| --- | --- |
| QR-Code mit `fp` | Der Fingerabdruck (SHA-256 des öffentlichen Schlüssels der Caddy-Wurzel) gilt schon für die erste Anfrage, gespeichert wird er erst nach gelungener Anmeldung. Weicht er von einem gespeicherten ab, zeigt der Dialog bisher/neu und verlangt ein ausdrückliches Ja. |
| Adresse von Hand | Beim ersten Kontakt bricht der Handshake ab, bevor etwas gesendet wird. Ein Dialog zeigt den Fingerabdruck in derselben Schreibweise wie die Webapp unter Einstellungen → Server-Zertifikat (`AB:CD:…`): bei einer Kette, die das System kennt (öffentliche CA), den der Wurzel aus dem System-Speicher, sonst den des obersten Zertifikats der Kette. Gespeichert wird er erst nach ausdrücklicher Bestätigung (Trust on first use, abgesichert durch den Vergleich). |
| Zertifikat später anders | Passt keine Kette mehr zum gespeicherten Fingerabdruck, geht nichts hinaus. Der Dialog zeigt den bisherigen und den neuen Fingerabdruck; übernommen wird nur, wenn man mindestens die letzten 16 Zeichen des neuen aus einer zweiten Quelle abschreibt (Webapp oder Zertifikatdetails des Browsers) — oder per neuem QR-Code. |

Weil die Wurzel gepinnt wird und nicht das Blatt, übersteht der Pin die
regelmässige Erneuerung des Serverzertifikats durch Caddy. Andere Hosts
(GitHub für die Selbstaktualisierung) prüft nur die System-CA-Liste.
Nutzerinstallierte CAs zählen nur, wenn der Nutzer das in den Einstellungen
ausdrücklich einschaltet.

**Logcat.** Die App schreibt nur über `util/Protokoll.kt`, und das nur im
Debug-Build; dort zeigt der Netzmitschnitt Anfrage- und Statuszeile, nie Rümpfe,
und schwärzt `Authorization`, `Cookie` und `Set-Cookie`. R8 entfernt im Release
zusätzlich alle `android.util.Log`-Aufrufe (`proguard-rules.pro`).
`ProtokollTest` verbietet rohe Log-Aufrufe ausserhalb der Hülle.

## Hinweise
- Bildcaching erfolgt via Coil (automatisch)


## Module

Abhängigkeiten nur in diese Richtung: `app → feature-* → core-*`; kein Bereich
kennt einen anderen (`ModulgrenzenTest` prüft es an den Build-Dateien).

| Modul | Inhalt |
| --- | --- |
| `core-model` | Server- und UI-Modelle, reine Regeln — reines Kotlin, ohne Android |
| `core-ressourcen` | Texte (de/en), Schriften, Bilder; `ch.brickinventoryapp.ressourcen.R` |
| `core-data` | Retrofit, OkHttp, Repositories, Room samt Schema (`core-data/schemas`), Ausgang, Worker, Dienste |
| `core-ui` | Theme und gemeinsame Composables (Karten, Zeilen, Filter, Kamera-Bausteine) |
| `core-zustand` | Sitzung, Blickfeld, Bestandssignal, Texte, Basis der Bereichs-ViewModels, AppViewModel |
| `core-testing` | Testhilfen (Testserver, Testdienste, `Quellen`), nur als `testImplementation` |
| `feature-anmeldung` | Anmelden, Server einrichten, QR |
| `feature-katalog` | Katalog und Katalog-Detail |
| `feature-sammlung` | Galerie, Set-Detail, Merkliste, Käufe, Vergleich, Scanner |
| `feature-teile` | Teile, Minifiguren, eigene Einträge, Teilelisten |
| `feature-finanzen` | Finanzen, Gutscheine, PDF-Betrachter |
| `feature-konto` | Einstellungen |
| `feature-verwaltung` | Monitoring für Verwalter |
| `app` | Navigation, Hilt-Einstieg, Activity, Widget |

Die Pakete sind über die Module hinweg dieselben geblieben
(`ch.brickinventoryapp.ui.screens` gibt es in mehreren Modulen); was ein Modul
dem anderen zeigt, ist öffentlich, der Rest `internal`.

## Tests

```bash
./gradlew testDebugUnitTest :core-model:test
```

Die Tests liegen neben dem Code ihres Moduls; was mehrere Bereiche zusammen
prüft (Bildschirmfotos, Abläufe, Struktur), liegt in `app/src/test`.

- **CatalogYearMathTest** — Mathematik des Jahres-Scrubbers (Position ↔ Jahr,
  Klemmen, Monotonie, Roundtrip, degenerierte Layouts). Die Logik ist dafür aus
  der Composable nach `ui/CatalogYearMath.kt` extrahiert.
- **CatalogSerializationTest** — Client-seitiger API-Vertrag: die Katalog-Modelle
  parsen realistische Server-Antworten (gleiche Payload-Form wie im Server-
  Integrationstest), inkl. unbekannter Zusatzfelder und fehlender Optionalfelder.
  Nutzt dieselbe Json-Konfiguration wie `di/AppModule`.
- **BrickLinkUrlsTest** — Kauf-Link-Format identisch zur Webapp
  (`util/BrickLinkUrls.kt`).

## Abhängigkeiten und Lieferkette

`renovate.json` liegt im Wurzelverzeichnis (nur dort liest Renovate sie) und
gilt nur für Gradle; Actions und Docker-Images hält `.github/dependabot.yml`
aktuell. Renovate erzeugt montags früh gesammelte Pull-Requests für kleine
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
`.github/workflows/android.yml` prüft die Datei deshalb mit
`gradle/actions/wrapper-validation` gegen die von Gradle veröffentlichten
Prüfsummen.

Die Zeilenenden der beiden Startskripte hält `.gitattributes` fest: `gradlew`
auf LF, `gradlew.bat` auf CRLF. Ohne das macht ein Windows-Checkout mit
`core.autocrlf=true` aus `gradlew` eine Datei, die keine Shell mehr startet.

#### Prüfsumme der Distribution

`gradle-wrapper.properties` enthält ein `distributionSha256Sum`. Damit wird die
heruntergeladene Gradle-Distribution gegen einen erwarteten Hash geprüft, statt
blind ausgepackt zu werden — bei einer App, die einen langlebigen Bearer-Token
hält, ist das die billigste Absicherung, die es gibt.

Der eingetragene Wert stammt aus Gradles Veröffentlichung und gilt für
`gradle-9.6.1-bin.zip`:

```
distributionSha256Sum=9c0f7faeeb306cb14e4279a3e084ca6b596894089a0638e68a07c945a32c9e14
```

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
Dafür einmalig *Settings → Actions → General → Allow GitHub Actions to create
and approve pull requests* einschalten; sonst bleibt nur der Zweig, und der
Pull-Request wird von Hand gestellt. Die CI des Zweigs startet nicht von selbst
(Pull-Request schliessen und wieder öffnen).

### Was NICHT automatisch aktualisiert werden sollte

Diese Sprünge sind Umbauten und gehören einzeln gebaut und ausprobiert:

- **Coil 2 → 3**: anderer Paketname (`coil3`), anderer `ImageLoader`-Aufbau.
  Betrifft `di/AppModule.kt` und jede Kachel.
- **OkHttp 4 → 5**: Interceptor-Stack und `okhttp-sse` sind betroffen; der
  CSV-Import hängt daran.
- **Navigation 2 → 3**: anderes Navigationsmodell, betrifft alle vier
  Teilgraphen.
- **Compose BOM**: Der Sprung von `2024.09.03` auf eine aktuelle BOM zieht
  Material3 und Foundation mehrere Minor-Versionen weiter. Einmal gross
  springen und danach die Bildschirme durchklicken ist ehrlicher, als es in
  einem Sammel-PR mitlaufen zu lassen.

## Zwei Arten von Tests

Seit Nachtrag 117 gibt es beide, und der Unterschied ist wichtig:

**Verhaltenstests** führen Code aus. `BrickRepositoryErrorMappingTest` startet
einen echten HTTP-Server (MockWebServer) und prüft, was das Repository aus
einer Antwort macht — 409 mit Fehlerrumpf, 500 ohne, Zeitüberschreitung,
Verbindungsabriss. `FehlerTexteTest` ruft die Zuordnung Ursache → Text direkt
auf. Solche Tests sind die wertvollen: Sie finden, ob eine Regel WIRKT.

**Quelltextlesende Tests** suchen Muster im Code. Sie sind der Behelf für alles,
was ohne Android-Laufzeit nicht ausführbar ist (Compose-Bildschirme,
Navigation, DataStore) — und sie finden nur, ob eine Regel im Code STEHT. In
Nachtrag 48 hat genau das sieben Nachträge lang eine kaputte
Vorschau-Erzeugung verdeckt: Der Test prüfte, dass „tmp + rename" im Code
steht, und sah nie nach, ob am Ende eine Datei lag.

Faustregel: Lässt sich etwas ohne `Context` aufrufen, gehört ein
Verhaltenstest hin. Braucht es Android, ist ein quelltextlesender Test besser
als keiner — aber die Frage lohnt sich vorher: Was schwer prüfbar ist, ist
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
`release` warten dann je auf ein Ja. Dort unter *Environment secrets* vier
Secrets anlegen.

Dazu ein **Tag-Ruleset** (Settings → Rules → Rulesets → New tag ruleset) für
`refs/tags/android-v*`: Anlegen, Ändern und Löschen nur für Administratoren
(Bypass-Liste), *Restrict updates* und *Restrict deletions* an. Ein Etikett
lässt sich sonst von jedem mit Schreibrecht setzen oder umhängen; der Workflow
signiert ohnehin nur Commits, die auf `main` liegen.

**Übergang:** Gleichnamige Repository-Secrets danach löschen. Der Workflow
braucht sie nicht mehr; solange sie bestehen, könnte jeder Job auf `main` sie
lesen, auch ohne Freigabe.

### Release-Zertifikat und Fassung

Vor dem Veröffentlichen prüft der Job `apk-pruefen` zweierlei
(`tools/release-pruefen.py`):

- **Zertifikat:** Das APK muss mit einem der Zertifikate in
  `tools/release-zertifikat.sha256` signiert sein. Den Wert liefert
  `keytool -list -v -keystore brick.jks` (Zeile `SHA256:`; Doppelpunkte und
  Grossschreibung sind gleichgültig). Wird der Schlüssel je gewechselt
  (Rotation), kommt der neue Wert als zweite Zeile dazu. Ein Lauf ohne Etikett
  signiert mit einem Wegwerfschlüssel und muss genau an dieser Prüfung
  scheitern; so läuft sie bei jedem Bau.
- **Fassung:** Der versionCode muss über dem des veröffentlichten
  `version.json` liegen (gleich nur für denselben Commit). Ein Etikett auf einem
  älteren Commit von `main` wird so nicht zum „neusten APK“. Der Job `release`
  prüft dasselbe unmittelbar vor dem Hochladen noch einmal; zwei Etiketten
  laufen dort nacheinander (`concurrency: apk-neuste`).

Dazu gehört eine Branch-Protection (oder ein Ruleset) auf `main`: Merge nur
über Pull-Request mit grüner CI, kein Force-Push. Sonst genügt ein direkter
Push, um Code bis vor die Freigabe zu bringen.

| Secret              | Inhalt                        |
|---------------------|-------------------------------|
| `KEYSTORE_BASE64`   | der kopierte Base64-Text      |
| `KEYSTORE_PASSWORT` | Passwort des Schlüsselspeichers |
| `KEY_ALIAS`         | `brickinventory`              |
| `KEY_PASSWORT`      | Passwort des Schlüssels       |

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
