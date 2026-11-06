# Begründungen zu `test/helpers/oberflaeche.js`

Die ausführlichen Kommentare aus `test/helpers/oberflaeche.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die ganze Weboberfläche in jsdom: echtes index.html, echtes Bündel, und ein
fetch, der je Pfad eine vorgegebene Antwort liefert. So prüft ein Test, was
die Oberfläche aus einer Serverantwort macht, ohne Server und ohne Browser.

Antworten: { '/v1/parts/manual': {...}, ... } je Pfad ohne Abfrage (?…),
als Objekt oder Funktion(url, optionen). Was fehlt, bekommt { success: true }.
Jeder Aufruf landet in `aufrufe`.
```
