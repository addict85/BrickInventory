# Begründungen zu `test/xss-ansichten-browser.test.js`

Die ausführlichen Kommentare aus `test/xss-ansichten-browser.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Kein Markup aus Daten: Namen, Themen, Kategorien und Lagerorte mit XSS-Nutzlast
durch die Hauptansichten gerendert, im echten Chrome.

Geprüft wird das Ergebnis im DOM, nicht der Quelltext: Kein Element trägt einen
Ereignis-Handler aus den Daten, kein <img src=x> oder <svg> aus der Nutzlast
entsteht, und die Nutzlast steht als Text da (sonst wäre die Ansicht leer und
der Test bewiese nichts). Die CSP würde einen Handler ohnehin nicht ausführen;
deshalb zählt das Element, nicht der Aufruf.
```
