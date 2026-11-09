# Begründungen zu `public/js/03-teil-erfassen.js`

Die ausführlichen Kommentare aus `public/js/03-teil-erfassen.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="rawcolor"></a>
## `rawColor`

```text
"Keine Farbe" ist NICHT 0.

Der Ausdruck lautete `parseInt(colorSel.value) || 0` — die leere Auswahl
ergab damit 0, und 0 ist bei Rebrickable die Farb-ID von SCHWARZ. Beide
Fälle kamen also als 0 am Server an, und der übersprang daraufhin die
Suche nach dem farbigen Teilebild (`if (colorId && colorId !== 0)`).
Ergebnis: Ein schwarz erfasstes Teil bekam das allgemeine, meist weisse
Bild — sichtbar beim Vergleich mit demselben Teil aus einem Set.

null statt 0 für "keine Farbe": Der Server erkennt daran den Unterschied
und legt weiterhin 0 in der Datenbank ab (Spaltenvorgabe), sucht das
Farbbild aber nur, wenn wirklich eine Farbe gewählt wurde.
```
