# Begründungen zu `clients/bricklink.ts`

Die ausführlichen Kommentare aus `clients/bricklink.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
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
