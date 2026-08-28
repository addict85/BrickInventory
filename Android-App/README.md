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
| `./gradlew assembleRelease` | `app/build/outputs/apk/release/Brickinventory.apk` — minifiziert und **unsigniert** (siehe unten) |
| `./gradlew lintRelease` | `app/build/reports/lint-results-release.html` |
| `./gradlew installDebug` | baut und installiert auf dem angeschlossenen Gerät (`adb devices`) |
| `./gradlew clean` | löscht `app/build/` |

Unter Windows `gradlew.bat` statt `./gradlew` verwenden.

### Die Release-APK ist unsigniert

`buildTypes { release { … } }` in `app/build.gradle.kts` hat bewusst **keine**
`signingConfig` — im Repository liegt kein Schlüssel, und laut `.gitignore` soll
auch nie einer hineingeraten. `assembleRelease` erzeugt deshalb eine APK, die
Android **nicht installiert**. Zum Signieren nach dem Bauen:

```bash
apksigner sign --ks meine.jks --out Brickinventory-signiert.apk \
  app/build/outputs/apk/release/Brickinventory.apk
```

Wer regelmässig Release-Builds erzeugt, hängt statt dessen eine `signingConfig`
an den Release-Typ, die ihre Werte aus einer nicht eingecheckten
`keystore.properties` liest — `.gitignore` hält diesen Dateinamen bereits frei.

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

`.github/workflows/android.yml` im Wurzelverzeichnis des Repositories macht
genau das oben Beschriebene auf einem `ubuntu-latest`-Runner: Wrapper prüfen,
SDK einrichten, `testDebugUnitTest`, `assembleDebug`, `lintRelease`. Die
Debug-APK und die Berichte hängen anschliessend als Artefakte am Lauf. Über
"Run workflow" lässt sich zusätzlich `assembleRelease` anfordern.

## Erster Start
1. Server-URL eingeben: `http://192.168.x.x:3000`  
   (IP-Adresse des Geräts auf dem der BrickInventory Manager läuft)
2. Mit Benutzername + Passwort anmelden

## Funktionen
- **Galerie** – Sets anzeigen, suchen, hinzufügen, löschen
- **Teile** – Alle Teile mit Bild, Farbe, Anzahl (paginiert)
- **Finanzen** – Portfolio-Wert mit BrickLink-Preisen

## API
Die App kommuniziert ausschliesslich über `/api/v1/` mit Bearer-Token-Authentifizierung.
Token-Verwaltung erfolgt über das Web-Interface unter Einstellungen → Mobile API.

## Hinweise
- `usesCleartextTraffic="true"` im Manifest erlaubt HTTP (für lokale Server ohne HTTPS)
- Für HTTPS-Server: kein Problem, funktioniert automatisch
- Bildcaching erfolgt via Coil (automatisch)


## Tests

```bash
./gradlew testDebugUnitTest
```

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

`renovate.json` liegt im Wurzelverzeichnis: Renovate erzeugt montags früh
gesammelte Pull-Requests für kleine Sprünge und einzelne für grosse. Zwei Pins
sind ausdrücklich abgeschaltet und dürfen NICHT automatisch steigen —
`datastore-preferences` und `graphics-path` hängen an der 16-KB-Ausrichtung
(siehe INVARIANTEN.md). Die Begründung steht als `description` direkt in der
Regel, damit sie beim Lesen der Konfiguration mitkommt.

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

Gemeinsame Helfer für die zweite Art stehen in `test/…/Quellen.kt` —
insbesondere `fenster()` (misst ZEILEN, nicht Zeichen) und `ohneKommentare()`.
