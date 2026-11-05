# Begründungen zu `test/tippziele-browser.test.js`

Die ausführlichen Kommentare aus `test/tippziele-browser.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Am Telefon ist jedes Bedienelement mindestens 44 × 44 px gross — gemessen
im Browser, nicht im Quelltext gelesen.

Eine Testseite lädt dieselben Stylesheets wie index.html und je ein
Beispiel der Bedienelemente, die vorher zu klein waren. Chrome rendert sie
bei 390 px Breite; ein Skript in der Seite tippt um jedes Element herum
(elementFromPoint 22 px links, rechts, oben und unten der Mitte) und
schreibt das Ergebnis ins DOM, das `--dump-dom` ausgibt. So zählt auch eine
Tippfläche, die per ::after über den sichtbaren Knopf hinausreicht.

Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
```
