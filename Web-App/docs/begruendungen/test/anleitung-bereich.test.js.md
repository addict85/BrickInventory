# Begründungen zu `test/anleitung-bereich.test.js`

Die ausführlichen Kommentare aus `test/anleitung-bereich.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein Bereich hinter dem Dateiende ist kein „Datei nicht gefunden".

── Marcos Meldung ──────────────────────────────────────────────────────────

„Nach ein paar Mal die Anleitung abrufen aus der App erscheint folgende
Meldung" — „Fehler beim Laden: HTTP 404". Die Anleitung lag die ganze Zeit
auf dem Server.

── Was tatsaechlich passierte ──────────────────────────────────────────────

Der PDF-Viewer der App laedt fortsetzbar. Nach einem VOLLSTAENDIGEN
Download schickte er `Range: bytes=<dateigroesse>-` — ein Bereich, der hinter
dem letzten Byte beginnt. `send` beantwortet das mit 416. Die Route bildete
aber JEDEN Fehler aus res.sendFile() auf 404 ab, und aus „dein Bereich ist
zu gross" wurde „die Datei gibt es nicht".

Die Ursache der fehlgeschlagenen Anzeige liegt in der App und ist dort
behoben (util/PdfCache.kt: ein fertiger Download wird nicht fortgesetzt).
Diese Regel haelt die ZWEITE Haelfte fest: Der Server muss die Wahrheit
sagen. Eine 404 fuer eine vorhandene Datei hat die Suche in die falsche
Richtung geschickt, und der naechste Client, der Bereiche anfragt, faende
dieselbe Falle vor.

── Warum die echte Funktion und kein Nachbau ───────────────────────────────

Geprueft wird `liefereDatei()` aus src/http/dateiAusliefern.ts — genau die
Funktion, die server.ts fuer die Anleitungen und die Uploads benutzt. Ein
nachgebauter Callback im Test wuerde beweisen, dass der NACHBAU stimmt.
```
