# Begründungen zu `test/vertrag-kotlin.test.js`

Die ausführlichen Kommentare aus `test/vertrag-kotlin.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Kotlin-Modelle der App gegen den Vertrag des Servers (src/vertrag/,
als JSON-Schema wie in docs/openapi.json): Jede Route, die die App aufruft,
hat einen Vertrag, und ihr Antworttyp liest jede Antwort, die der Vertrag
erlaubt — Feldnamen (@SerialName), Typ, Nullbarkeit, Pflicht oder optional.
Dass der Server seinen Vertrag hält, prüfen die DB-Tests (vertrag-lesen-db,
vertrag-schreiben-db und jede Antwort über src/vertrag/pruefen.ts).
```
