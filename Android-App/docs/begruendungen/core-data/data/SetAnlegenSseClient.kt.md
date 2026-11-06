# Begründungen zu `core-data/data/SetAnlegenSseClient.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/data/SetAnlegenSseClient.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="constructor"></a>
## `constructor`

```text
Ein Set anlegen — mit Fortschritt, wie die Webapp über /api/v1/sets/add-stream
(Stammdaten holen, Bild laden, fertig), damit man bei einem grossen Set sieht,
was passiert.

Nicht über okhttp-sse, weil die Adresse in zwei Formen antwortet
(routes/sets.ts):
  * Steht das Set schon im Blickfeld, kommt gewöhnliches JSON — ein Strom mit einem Ereignis wäre nur ein Umweg.
  * Sonst kommt ein `text/event-stream` mit den Schritten.

`EventSources` meldete die erste Form als Fehler, weil der Inhaltstyp nicht
passt — „hab ich schon“ sähe aus wie ein Verbindungsabbruch. Deshalb wird die
Antwort selbst gelesen, und der Inhaltstyp entscheidet, wie sie gemeint ist.
```
