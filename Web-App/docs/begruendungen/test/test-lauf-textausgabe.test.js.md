# Begründungen zu `test/test-lauf-textausgabe.test.js`

Die ausführlichen Kommentare aus `test/test-lauf-textausgabe.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
„Unable to deserialize cloned data" unter Last: node:test (Node 22) liest
Berichtsrahmen und Text des Kindes aus demselben Strom. Steht Text mit einem
Nicht-ASCII-Byte an Stelle 2 im selben Lesestück direkt hinter einem Rahmen,
wird seine Länge negativ gelesen und der Text deserialisiert. Unter Last
landen mehr Schreibvorgänge in einem Lesestück, daher nur dann.

Geprüft wird der echte Weg: scripts/test-lauf.js mit einer Datei, die das
Muster 300-mal schreibt (test/fixtures/rahmen-und-text.js). @einzeln, weil
test-lauf.js dist/ neu baut, aus dem parallele Dateien gerade lesen.
```
