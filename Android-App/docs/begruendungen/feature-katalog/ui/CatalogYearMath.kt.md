# Begründungen zu `feature-katalog/ui/CatalogYearMath.kt`

Die ausführlichen Kommentare aus `feature-katalog/src/main/java/ch/brickinventoryapp/ui/CatalogYearMath.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="catalogyearmath"></a>
## `CatalogYearMath`

```text
Reine Mathematik der Jahres-Leiste (CatalogScreen) — ein eigenes Objekt, damit
sie ohne Compose in JUnit prüfbar ist (CatalogYearMathTest).

Die Leiste hängt an der Position, nicht linear am Jahr: Der grösste Teil des
Katalogs stammt aus den letzten Jahrzehnten, wer neun Zehntel hinunterzieht, ist
noch lange nicht bei den Sechzigern — ein lineares Modell zeigte neben geladenen
Sets von 1999 die Zahl 1965. Gerechnet wird über die tatsächliche Verteilung,
Schritt für Schritt wie in der Webapp (js/09-catalog.js → _jahrAnPosition),
damit beide an derselben Stelle dasselbe Jahr zeigen. Die Verteilung kommt vom
Server, weil nur der die Filter kennt.
```

<a id="jahranposition"></a>
## `jahrAnPosition`

```text
Welches Jahr liegt an diesem Anteil der Liste? Wie in der Webapp
(js/09-catalog.js → _jahrAnPosition): Aus dem Anteil wird eine laufende Nummer,
die durch die Verteilung wandert, bis sie in einen Jahrgang fällt.

`verteilung` enthält keine Sets ohne Jahr, `total` zählt sie mit — läuft die
Nummer über das Ende, gilt der letzte Jahrgang. Dieselbe Abweichung wie in der
Webapp, gewollt: Ein Sonderweg hier zeigte an derselben Stelle ein anderes Jahr.

@return das Jahr, oder null wenn es nichts zu zeigen gibt
```
