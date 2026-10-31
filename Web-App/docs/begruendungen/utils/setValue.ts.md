# Begründungen zu `utils/setValue.ts`

Die ausführlichen Kommentare aus `utils/setValue.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Marktwert eines Sets aus den Erfassungen und den zustandsabhängigen Preisen.

── Was vorher falsch war ───────────────────────────────────────────────────

1. Die Auswahl aus price_cache sortierte so:

       ORDER BY (qty_avg_price > 0 OR avg_price > 0) DESC, (condition = $3) DESC

   „Hat überhaupt einen Preis" stand VOR „passender Zustand". Lag für ein Set
   ein Gebraucht-Preis vor und der Neu-Eintrag war leer, gewann Gebraucht —
   auch wenn ausdrücklich Neu angefragt wurde. Genau so kam für 10290-1 ein
   deutlich zu niedriger Wert zustande.

2. Überall wurde `qty_avg_price || avg_price` genommen. qty_avg_price ist der
   mengengewichtete Schnitt und liegt systematisch unter dem, was BrickLink
   als „Avg Price" anzeigt. Dazu kommt eine JavaScript-Falle: Postgres
   liefert NUMERIC als String, und `"0.00"` ist truthy — ein leerer
   qty_avg_price verdeckte damit einen gültigen avg_price.

3. Ein Set hatte genau EINEN Marktpreis, unabhängig davon, wie sich seine
   Erfassungen zusammensetzen. Zwei Exemplare, eines neu, eines gebraucht,
   wurden beide mit demselben Preis bewertet.

── Die Regel jetzt ─────────────────────────────────────────────────────────

Jede Erfassung wird mit dem avg_price IHRES Zustands bewertet:

    Gesamtwert    = Σ (Menge_i × avg_price[Zustand_i])
    Stückpreis    = Gesamtwert / Σ Menge_i

Das deckt beide Vorgaben ab:
  • 1× Neu, 1× Gebraucht → Gesamtwert = neu + gebraucht,
    angezeigter Stückpreis = (neu + gebraucht) / 2.
  • Nur Neu → Stückpreis = avg_price(Neu).

Und es verallgemeinert sauber: Bei 2× Neu und 1× Gebraucht ergibt sich
(2·neu + gebraucht) / 3 als Stückpreis und 2·neu + gebraucht als Summe —
Anzeige × Menge bleibt also immer gleich der Summe. Ein reiner Mittelwert
über die vorkommenden Zustände täte das nicht.

Fehlt der Preis für einen Zustand, wird auf den anderen ausgewichen; das ist
besser als die Erfassung mit 0 zu bewerten und die Summe zu verfälschen.
Sets ohne Erfassungen gibt es seit Migration 0032 nicht mehr — Kaufpreis und
Zustand stehen nur noch in set_acquisitions. Die Parameter
fallbackCondition/fallbackQuantity bleiben, weil valueSet() auch für Teile
und Minifiguren benutzt wird; dort ist die Erfassung tatsächlich optional.
```

<a id="getsetvalue-acqs"></a>
## `acqs`

```text
Nur noch EINE Abfrage. Hier stand daneben ein `SELECT quantity, condition
FROM sets` für den Rückfall. Beides ist weggefallen:

  • `condition` gibt es an der sets-Zeile seit Migration 0032 nicht mehr.
  • `quantity` wurde ausschliesslich als fallbackQuantity gebraucht, und
    der zählt nur, wenn es KEINE Erfassung gibt. Für Sets kann das nicht
    mehr vorkommen (die Migration hat nachgetragen und geprüft), und für
    den Fall, dass es doch einmal so ist, ist 1 die richtige Annahme —
    eine Menge aus einer Zeile, zu der keine Kaufhistorie gehört, sagt
    über die Bewertung nichts.

Nebenbei behebt das eine gemeldete Dopplung: Die Abfrage stand wortgleich
in src/sets/setMove.ts (test/sql-kerne.test.js meldet eine Anweisung, die in
mehr als einer Datei steht).
```

<a id="pnl-eps"></a>
## `PNL_EPS`

```text
valueSet() oben verdichtet auf EINEN Stückpreis je Set. Die Finanztabelle
zeigt seit hardened-90 aber eine Zeile je Kaufpreis-Erfassung: Ein Set mit
einem Kaufpreis für „Neu" und einem für „Gebraucht" steht dort mit zwei
Zeilen, jede mit dem Marktpreis IHRES Zustands.

Diese Funktion gehört bewusst in DIESE Datei und nicht in eine eigene:
„Wie ein Set bewertet wird" liegt damit weiterhin an genau einer Stelle,
mitsamt dem Ausweichen auf den anderen Zustand (priceFor). Eine zweite Datei
mit derselben Regel ist in diesem Projekt schon mehrfach auseinandergelaufen
— zuletzt bei der Zustandsauflösung, die an fünf Orten leicht verschieden
war.

Der Kaufpreis kommt hier dazu, weil er je Erfassung verschieden ist und die
Prozentangabe der Zeile gegen genau diesen Kaufpreis gerechnet werden muss.
```
