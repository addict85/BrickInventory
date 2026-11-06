# Begründungen zu `test/minifig-schaetzung.test.js`

Die ausführlichen Kommentare aus `test/minifig-schaetzung.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="test"></a>
## `const test = require('node:test');`

```text
Ohne BrickLink-Preis wird der Minifiguren-Preis aus den Teilen geschätzt.

Marco: „Bitte noch prüfen, dass bei den Minifiguren der Preis über die
einzelnen Teile berechnet wird, sofern keine bl-Id vorhanden ist." Die Kette:
ohne bl_fig_number wird die eigene Nummer bei BrickLink versucht; erst ohne
Preis dort wird über die Teile geschätzt, im ermittelten Zustand; die
Schätzung landet in Cache und Verlauf. BrickLink ist im Test nicht
eingerichtet, die Preise stehen in den Zwischenspeichern.
```
