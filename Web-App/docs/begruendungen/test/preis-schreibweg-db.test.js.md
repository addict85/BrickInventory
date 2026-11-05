# Begründungen zu `test/preis-schreibweg-db.test.js`

Die ausführlichen Kommentare aus `test/preis-schreibweg-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein BrickLink-Preis wird auf EINEM Weg weggeschrieben.

── Der Fehler, den das verhindert ──────────────────────────────────────────
Die Schreibregel „erst in price_cache, dann — wenn ein Preis drinsteht —
als Punkt in price_history" stand dreimal da: einmal im Anfrageweg
(src/finanzen/financeCalc.ts → fetchPrice → tryFetch) und zweimal im Nachtjob
(jobs/priceJob.ts, Hauptweg und Zustands-Rueckfall). Die dritte Fassung war
eine gekuerzte.

Nachgemessen, bevor etwas geaendert wurde — ein Set, dessen angefragter
Zustand 'N' keinen Preis hat, der andere ('U') schon, zwei Laeufe:

                       Job          Anfrageweg
  BrickLink-Abrufe       4               2
  price_cache        nur 'U'      'N'(0) und 'U'
  price_history       leer             'U'

Zwei Folgen, beide echt:
  • Der Rueckfall sprang mit `return` heraus, sobald der andere Zustand
    einen Preis hatte. Die Null-Zeile fuer 'N' wurde nie geschrieben, also
    fand der naechste Lauf nichts Frisches und fragte wieder — zwei Abrufe
    je Set und Lauf, dauerhaft, auf Kosten des BrickLink-Tageskontingents.
  • Im Rueckfall wurde price_history gar nicht bedient. Beim Nachtlauf
    deckt der Tages-Schnappschuss am Ende das noch zu; beim sofortigen
    Abruf nach dem Anlegen eines Sets (refreshPriceForSet) gibt es keinen
    Schnappschuss — dort fehlte der Punkt einfach.

── Warum das ein Verhaltenstest ist ────────────────────────────────────────
Die Aussage ist „beide Wege hinterlassen denselben Zustand in zwei
Tabellen und kosten gleich viele Abrufe". Am Quelltext liesse sich nur
ablesen, dass beide dieselbe Funktion aufrufen — nicht, dass dabei
dasselbe herauskommt.
```
