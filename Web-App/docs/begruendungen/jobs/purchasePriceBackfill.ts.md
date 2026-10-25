# Begründungen zu `jobs/purchasePriceBackfill.ts`

Die ausführlichen Kommentare aus `jobs/purchasePriceBackfill.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="backfillacquisitions"></a>
## `backfillAcquisitions`

```text
Erfassungen ohne Kaufpreis nachtragen.

Das war früher der zweite von zwei Durchläufen: backfillSets() betrachtete
Sets mit `sets.purchase_price IS NULL` und zog deren Erfassungen mit, und
diese Funktion fing die Erfassungen ab, die dabei durchfielen — Set-Zeile
beim Import bepreist, Erfassung nicht. Mit Migration 0032 gibt es nur noch
den einen Ort und damit nur noch diesen Durchlauf.

Die Lücke, die er schliesst, bleibt dieselbe und entsteht beim CSV-Import: Er fragt zuerst den Preis-Cache ab und
greift nur bei einem Treffer zu. Ist das Set dort noch nicht drin — bei neuen
Sets die Regel — folgt ein BrickLink-Abruf, und der scheitert bei vielen
Sets am Tageskontingent. Die Erfassung entsteht dann ohne Preis, und niemand
trägt ihn nach, sobald der Preis-Job den Cache gefüllt hat.

Der Zustand der ERFASSUNG entscheidet über den Preis — nicht der des Sets:
Ein gebraucht erfasstes Exemplar bekommt den Gebrauchtpreis, auch wenn das
Set als neu geführt wird.
```

<a id="abschnitt"></a>
## Abschnitt

```text
backfillSets() stand hier: ein eigener Durchlauf über `sets WHERE
purchase_price IS NULL`, der den Marktpreis in die Set-Zeile schrieb und die
Erfassungen mitzog. Beides erledigt backfillAcquisitions() oben — und zwar
genauer, weil es den Zustand JEDER Erfassung heranzieht statt den einen Wert
des Sets. Der Durchlauf hier holte den Preis ohne Zustandsangabe, also für
den Standardzustand; ein gebraucht erfasstes Set bekam darüber den Neupreis.
Mit Migration 0032 fällt sein Ziel ohnehin weg.
```

<a id="backfillteileerfassungen"></a>
## `backfillTeileErfassungen`

```text
Dasselbe fuer Teile- und Figuren-ERFASSUNGEN.

── Was hier vorher stand ───────────────────────────────────────────────────

Zwei Durchlaeufe ueber `parts`/`minifigs WHERE purchase_price IS NULL`, die
den Marktpreis in die Stammzeile schrieben. Migration 0035 hat die Spalte
geloescht; das Ziel ist weg.

Die LUECKE bleibt aber dieselbe, und sie ist dieselbe wie bei den Sets:
Beim CSV-Import wird zuerst der Preis-Cache gefragt, und ist das Teil dort
noch nicht drin, folgt ein BrickLink-Abruf — der bei vielen Positionen am
Tageskontingent scheitert. Die Erfassung entsteht dann ohne Preis, und
niemand traegt ihn nach, sobald der Preis-Job den Cache gefuellt hat.

Deshalb ist der Durchlauf an den EINEN verbliebenen Ort gezogen — genau wie
backfillAcquisitions() oben es fuer die Sets schon tat. Zwei Verbesserungen
fallen dabei an:

  * Der Zustand JEDER Erfassung entscheidet ueber den Preis, nicht ein
    Sammelwert der Stammzeile. Ein gebraucht erfasstes Teil bekam vorher den
    Neupreis.
  * Die `0`, die der Teile-Durchlauf bei erfolglosem Abruf schrieb, entfaellt.
    Sie war der Anzeigewert der Stammzeile („nichts bekannt"); in einer
    Erfassung hiesse sie „fuer null Franken gekauft". Der Anzeigewert wird
    jetzt beim Lesen gebildet (COALESCE(..., 0) in handlers/parts.ts).
```
