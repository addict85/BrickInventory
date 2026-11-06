# Begründungen zu `test/acquisition-price-mirror-db.test.js`

Die ausführlichen Kommentare aus `test/acquisition-price-mirror-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Kaufpreis ändern → die Kachel zieht mit, auf BEIDEN Wegen.

── Woher dieser Test kommt (Marcos Bericht, Nachtrag 51) ───────────────────
Screenshot aus der App: In der Erfassung steht 107.00 CHF, die Kachel oben
zeigt weiterhin 108.00 CHF. Der Kaufpreis wurde also gespeichert, aber die
Anzeige blieb auf dem alten Wert.

Ursache: In der Konfiguration der v1-Erfassungsrouten stand für SETS
`parentPriceSql: null` — als einzige der drei Elementarten. Teile und
Minifiguren spiegelten seit jeher, und die Webapp-Route tut es für Sets
ebenfalls. Nur der Android-Weg liess die sets-Zeile stehen. Weil Galerie,
Finanzübersicht und Detail-Kachel alle aus `sets.purchase_price` lesen,
zeigte die ganze App danach den alten Wert — dauerhaft, nicht nur bis zum
Neuladen.

── Was Migration 0032 daran geändert hat ───────────────────────────────────
Es gibt keine Spiegelung mehr, weil es keine zweite Spalte mehr gibt.
`parentPriceSql` ist für Sets wieder `null` — diesmal nicht aus Versehen,
sondern weil nichts zu spiegeln ist. Die Kachel rechnet aus den Erfassungen
(avg_purchase_price in getSetConditionAggregate).

Damit ändert sich auch eine REGEL, und zwar sichtbar für Marco: Die Kachel
zeigte bisher den Preis der NEUESTEN Erfassung, jetzt den mengengewichteten
Mittelwert über alle. Bei einem Set mit einem Kauf ist das dasselbe; bei
zwei verschieden teuren Käufen ist der Mittelwert die Zahl, die zur Menge
daneben passt (Anzeige × Menge = Summe). Der Teilschritt „Gegenrichtung"
unten hält genau diesen Unterschied fest.
```

<a id="alt-stelle"></a>
## `const alt = await aufbauen();`

```text
Gegenrichtung — und hier liegt der Unterschied zu vorher.

Bis Migration 0032 lautete die Regel: Ändert man eine ÄLTERE Erfassung,
bleibt die Kachel stehen, denn sie zeigt die NEUESTE (200). Jetzt zählt
jede Erfassung mit: 50 und 200, je ein Exemplar → 125.

Das ist die bessere Zahl. Die alte liess sich nicht mit der Menge
daneben multiplizieren: „1 Stück zu 200" bei einem Bestand von zwei
Exemplaren für zusammen 250 war schlicht falsch.
```
