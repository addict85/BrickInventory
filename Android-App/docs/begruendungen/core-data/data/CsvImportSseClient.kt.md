# Begründungen zu `core-data/data/CsvImportSseClient.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/data/CsvImportSseClient.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="constructor"></a>
## `constructor`

```text
Persistenter SSE-Client für den CSV-Import-Kanal.

Die Verbindung bleibt dauerhaft offen (auch wenn kein Import läuft).
Startet jemand einen Import — egal ob über die Webapp, die App oder ein
anderes Gerät — kommt das erste Event sofort, ohne vorher pollen zu müssen.

Events:
 - [Event.Status] : Statusänderung (Fortschritt, Start, Ende, idle)
 - [Event.Failed] : Verbindungsfehler → Aufrufer soll auf Polling zurückfallen

Der Flow schließt sich NUR bei Verbindungsfehler, nicht mehr bei Import-Ende.
Das ViewModel reconnectet automatisch bei Fehler (mit Backoff).
```
