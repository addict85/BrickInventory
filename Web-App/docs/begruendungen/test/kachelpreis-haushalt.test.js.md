# Begründungen zu `test/kachelpreis-haushalt.test.js`

Die ausführlichen Kommentare aus `test/kachelpreis-haushalt.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine Kachel, mehrere Besitzer — welchen Preis und welche G&V zeigt sie?

/finance/pnl liefert eine Zeile je Besitzer; die Galerie fasst dieselbe
Setnummer zu einer Kachel zusammen. Bei mehreren Zeilen wird nach Menge
gewichtet (über baseline_price), bei einer bleibt der Wert des Servers.
Seit kachel_preis und kachel_pnl_pct rechnet das der Server
(src/finanzen/setValue.ts kachelWerte); Web und App zeigen nur an.
```
