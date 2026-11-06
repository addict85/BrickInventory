# Begründungen zu `src/katalog/bricklinkPreise.ts`

Die ausführlichen Kommentare, wörtlich aus `clients/bricklink.ts` übernommen; der Code
steht heute in `src/katalog/bricklinkPreise.ts`. Im Code steht je Stelle der erste Absatz und
ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="hasusableprice"></a>
## `hasUsablePrice`

```text
Enthält die Antwort einen brauchbaren Preis?

Die Regel steht in src/finanzen/preisRegel.ts — und zwar dieselbe, die beim LESEN
gilt. Vorher genügte hier ein qty_avg_price > 0; damit galt eine Antwort
ohne avg_price als brauchbar, der Rückfall auf `stock` unterblieb, und der
Leser meldete danach trotzdem „kein Preis". Die Begründung im Einzelnen
steht in preisRegel.ts.
```

<a id="getpriceguide"></a>
## `getPriceGuide`

```text
Preisabfrage mit Rückfall von 'sold' auf 'stock'.

'sold' (verkauft, letzte sechs Monate) ist die ehrlichere Grundlage für „was
ist meine Sammlung wert" — Angebotspreise enthalten auch das, was niemand
zahlt. Aber: Für selten gehandelte Artikel gibt es in sechs Monaten
schlicht keinen Verkauf, und BrickLink liefert dann eine Antwort mit
avg_price = 0. Ohne Rückfall stünde dort dauerhaft kein Marktpreis.

Reihenfolge deshalb: erst 'sold'; liefert das keinen Preis, 'stock'. Das
Ergebnis trägt `guide_used`, damit nachvollziehbar bleibt, woher der Wert
kommt (und die Anzeige es später kennzeichnen könnte).
```

<a id="clearsubsetscache"></a>
## `clearSubsetsCache`

```text
Zwischenspeicher leeren — ohne Setnummer den ganzen.

Der Parameter war ohne Vorgabe deklariert, obwohl der else-Zweig genau den
Aufruf OHNE Argument bedient (Verwaltung → „Alle Caches leeren"). Solange der
Aufrufer die Funktion per spätem `require()` holte, fiel das niemandem auf:
`require()` liefert `any`, und `any` prüft keine Argumentzahl. Mit dem echten
Import meldete tsc es sofort (Nachtrag 132).
```

<a id="preisdatensatz"></a>
## `PreisDatensatz`

```text
Wann hat ein Preis-Datensatz einen Preis?

── Warum das eine eigene Datei ist ─────────────────────────────────────────
Diese eine Frage stand an vier Stellen, in drei Fassungen:

  clients/bricklink.ts   hasUsablePrice()  avg > 0 ODER qty_avg > 0
  src/finanzen/financeCalc.ts   cacheUsable()     avg > 0
  src/finanzen/financeCalc.ts   Cache-Treffer     avg > 0
  src/finanzen/financeCalc.ts   Rueckfall-Zeile   avg > 0 ODER avg > 0   ← zweimal
                                                                   dasselbe

Die letzte ist ein Tippfehler; gemeint war offensichtlich qty_avg. Die erste
ist der eigentliche Fehler, und er wirkt zusammen mit der zweiten:

`hasUsablePrice` entscheidet in bricklink.ts, ob nach einer erfolglosen
`sold`-Abfrage noch `stock` versucht wird. Antwortet BrickLink mit
avg_price = 0, aber qty_avg_price > 0 — bei selten gehandelten Artikeln der
Normalfall —, dann gilt die Antwort dort als brauchbar, der Rueckfall auf
`stock` UNTERBLEIBT, und die Zeile wird so gespeichert. Beim Lesen verlangt
financeCalc dann avg_price > 0, findet keinen und meldet `no_price`.

Ergebnis: Fuer genau die Artikel, fuer die der sold→stock-Rueckfall gebaut
wurde, steht dauerhaft „—" statt eines Marktpreises. Nachgemessen gegen die
Datenbank: Eine Zeile {avg_price: 0, qty_avg_price: 12.34} — die
hasUsablePrice() „brauchbar" nennt — kommt aus fetchPrice() als
{avg_price: 0, qty_avg_price: 0, no_price: true} zurueck.

── Welche Fassung gewinnt, und warum diese ─────────────────────────────────
Die enge. In financeCalc.ts steht dazu eine ausdrueckliche Entscheidung:
„Preis-Vorhandensein an avg_price festmachen — das ist der Wert, den alle
Verbraucher lesen." Das stimmt: Android und Webapp zeigen den Marktpreis
ueber `avg_price ?: qty_avg_price` an, und eine 0 ist nicht null — sie wuerde
als „0.00" durchgereicht.

── Ein Nebeneffekt, der genannt gehoert ────────────────────────────────────
An zwei Stellen stand `parseFloat(x.avg_price) === 0` — also „vorhanden UND
null". `!hatPreis(x)` ist etwas weiter: Es trifft auch eine Zeile mit
avg_price = NULL. Das ist beabsichtigt und richtig — beides heisst „kein
anzeigbarer Preis", und der Zweig darunter tut in beiden Faellen dasselbe.
In der Praxis kommt NULL dort nicht vor (jeder INSERT schreibt
parseFloat(... || 0)), aber die Regel soll nicht davon abhaengen.

Die Regel wandert deshalb NICHT nach aussen, sondern der Torwaechter nach
innen: Was der Leser nicht als Preis anerkennt, darf auch den Rueckfall
nicht unterdruecken. Damit versucht bricklink.ts jetzt `stock`, wo es vorher
aufgab — schlimmstenfalls eine zusaetzliche Abfrage fuer einen Artikel, der
bisher gar keinen Preis bekam. Einen Preis wegnehmen kann die Aenderung
nicht: Bringt auch `stock` nichts, bleibt es bei der `sold`-Antwort wie
bisher.
```
