# Begründungen zu `test/gallery-paging.test.js`

Die ausführlichen Kommentare aus `test/gallery-paging.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="ohnekommentare"></a>
## `const ohneKommentare = H_SRC.split('\n')`

```text
Geprüft wird die AUSSAGE, nicht der Wortlaut (Nachtrag 155).

Vorher stand hier der Ausdruck `SET_SORTS[sort] || SET_SORTS.added_desc`
wörtlich. Als dieser Zugriff auf ausTabelle() umgestellt wurde — weil der
direkte Zugriff auch GEERBTE Eigenschaften lieferte und `|| Vorgabe` die
eben NICHT abfing —, wurde der Test rot, obwohl die geprüfte Zusage nicht
nur galt, sondern strenger geworden war.

Zwei Dinge werden verlangt, beide als Sachverhalt:
  1. Kein direkter Index auf die Tabelle mehr (das war die Lücke).
  2. Der Wert geht durch ausTabelle() MIT Vorgabe (das ist die Zusage).
Das Verhalten von ausTabelle() selbst prüft test/austabelle.test.js.
```

<a id="stelle"></a>
## `const { funktionsRumpf } = require('./helpers/sources');`

```text
── Der Rumpf GANZ, nicht die ersten 900 Zeichen (20.10., GEMESSEN) ──────

Hier stand `H_SRC.slice(i, i + 900)`. Am 20.10. bekam getManualParts einen
Suchfilter samt Begründung, und diese Prüfung meldete „LIMIT/OFFSET müssen
gebunden werden, nicht interpoliert" — die Zeile stand unverändert da, nur
ab Zeichen 1100. Eine Prüfung, die richtigen Code anmeckert, wird
abgeschaltet statt befolgt; funktionsRumpf() schneidet deshalb an der
schliessenden Klammer (test/helpers/sources.js, dort steht die Lehre).
```

<a id="handlers"></a>
## `const handlers = require('./helpers/sources').handlerQuelle();`

```text
── Warum ein zweiter Sortierschlüssel nötig ist ──────────────────────────
Die allermeisten Sets stehen mit genau einem Exemplar im Bestand. Ohne
festen Zweitschlüssel wäre die Reihenfolge innerhalb dieser grossen Gruppe
von Postgres nicht definiert — und weil die Galerie seitenweise lädt,
könnte dasselbe Set beim Blättern zweimal oder gar nicht erscheinen. Das
ist dieselbe Falle wie bei jeder anderen nicht eindeutigen Sortierung.
```
