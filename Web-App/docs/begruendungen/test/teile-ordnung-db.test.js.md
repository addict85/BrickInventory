# Begründungen zu `test/teile-ordnung-db.test.js`

Die ausführlichen Kommentare aus `test/teile-ordnung-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Teileliste lässt sich ohne Farbgruppen zeigen: nach Name oder nach
Menge. Der Server sortiert in beiden Wegen (Live-Abfrage und
Zusammenfassung, einzeln und im Haushalt) gleich, und die Oberfläche
zeichnet ungruppiert keine Farbkacheln.

Die drei Teile sind so gewählt, dass jede Reihenfolge eine andere ist:
  Farbe: Blau ORD2, Gelb ORD3, Rot ORD1
  Name:  Axle ORD3, Brick ORD1, Plate ORD2
  Menge: ORD1 (9), ORD3 (7, im Haushalt 8), ORD2 (1)
Eigene Nummern, damit keine BrickLink-Zuordnung aus anderen Tests greift.
```
