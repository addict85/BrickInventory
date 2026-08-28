# BrickInventory Manager Android App

Kotlin + Jetpack Compose App für den BrickInventory Manager Server.

## Voraussetzungen
- Android Studio Ladybug (2024.2) oder neuer
- JDK 17
- Android SDK 35
- BrickInventory Manager Server läuft und ist erreichbar

## Öffnen in Android Studio
1. Android Studio öffnen
2. "Open" → diesen Ordner (`brickinventory-android/`) wählen
3. Warten bis Gradle sync abgeschlossen ist
4. App starten (▶)

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

### Prüfsumme des Gradle-Wrappers

`gradle/wrapper/gradle-wrapper.properties` hat noch kein
`distributionSha256Sum`. Ohne das Feld wird die heruntergeladene
Gradle-Distribution nicht gegen einen erwarteten Hash geprüft — bei einer App,
die einen langlebigen Bearer-Token hält, ist das die billigste Absicherung, die
es gibt.

Die Prüfsumme lässt sich nicht raten, sie muss von der Quelle kommen:

```bash
curl -sS https://services.gradle.org/distributions/gradle-9.6.1-bin.zip.sha256
```

Die Ausgabe als eine Zeile ergänzen:

```
distributionSha256Sum=<Ausgabe>
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
