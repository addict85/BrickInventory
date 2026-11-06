# Begründungen zu `test/clients-render-only.test.js`

Die ausführlichen Kommentare aus `test/clients-render-only.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Beide Oberflächen rechnen keine Geldbeträge nach.

Die Regel, was zu einer Summe zählt, steht nur im Server; summierte eine
Oberfläche selbst, zeigten Webapp und Android-App bei der nächsten Änderung
verschiedene Zahlen. Gesucht wird nach der FORM einer Geldsumme
(`reduce`/`sumOf` über ein Feld, dessen Name auf Geld deutet), nicht nach
einzelnen Feldnamen; jede Fundstelle braucht einen ausdrücklichen Freibrief.
```
