# Begründungen zu `test/qr-adresse.test.js`

Die ausführlichen Kommentare aus `test/qr-adresse.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der QR-Code traegt die Adresse, unter der der Server von AUSSEN erreichbar
ist — oder es kommt kein Code.

── Marcos zwei Saetze vom 25.09. ───────────────────────────────────────────

  „Kannst diese variable auch gleich fuer den qr Code fuer die Verknuepfung
   der App verwenden?"
  „Kannst du das location.origin nicht komplett entfernen?"

Gemeint ist APP_BASE_URL, dieselbe Quelle wie fuer die Links in den Mails.

── Warum das mehr ist als eine Vereinheitlichung ───────────────────────────

Der Code trug `window.location.origin`. Das ist genau dann falsch, wenn es
darauf ankommt: Wer die Webapp ueber die LAN-Adresse oder einen lokalen Namen
oeffnet (http://192.168.x.x:3000), reicht dem Telefon eine Adresse, die
ausser Haus nicht existiert. Scannen laesst sich der Code trotzdem — die App
verbindet sich einmal im WLAN und findet den Server unterwegs nie wieder.

Das ist der unangenehmste Fehlertyp: Er entsteht im Wohnzimmer und zeigt
sich im Zug.

Der Zwischenstand `d.url || location.origin` war das gefaehrlichere von
beiden, weil er nach einem vernuenftigen Rueckfall aussah. Er ist weg: Ohne
APP_BASE_URL verweigert die Route.

── Warum dieser Test einen Server startet ──────────────────────────────────

Die ersten drei Schritte lasen Quelltext. Das haette die eine Aussage nicht
treffen koennen, auf die es ankommt: dass bei fehlender Variable KEINE Nonce
entsteht. Die Pruefung steht jetzt vor dem Datenbankzugriff — ob sie dort
WIRKLICH steht, sieht man nur, wenn man die Tabelle nachzaehlt. Ein
`indexOf`-Vergleich haette sie auch dann fuer richtig gehalten, wenn sie
zwanzig Zeilen weiter unten stuende.

Nebenbei zeigt der Aufbau, dass basisUrl() die Umgebung bei JEDEM Aufruf
liest und nicht beim Laden des Moduls: Beide Faelle laufen in einem Prozess.

Voraussetzung: Test-DB. Ohne DB: skip (mit REQUIRE_DB=1: Fehler).
```
