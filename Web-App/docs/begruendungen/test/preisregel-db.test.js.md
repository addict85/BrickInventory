# Begründungen zu `test/preisregel-db.test.js`

Die ausführlichen Kommentare aus `test/preisregel-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Regel „hat einen Preis" gilt an JEDER Stelle gleich.

── Der Fehler, den das verhindert ──────────────────────────────────────────
Dieselbe Frage stand an vier Stellen, in drei Fassungen. Zwei davon spielten
gegeneinander:

  • `hasUsablePrice()` in clients/bricklink.ts entschied, ob nach einer
    erfolglosen `sold`-Abfrage noch `stock` versucht wird — und liess
    `qty_avg_price > 0` genügen.
  • `fetchPrice()` in src/finanzen/financeCalc.ts erkennt einen Preis nur bei
    `avg_price > 0` an, weil genau dieses Feld die Clients anzeigen.

Antwortet BrickLink also mit avg_price = 0 und qty_avg_price > 0 — bei
selten gehandelten Artikeln der Normalfall —, dann galt die Antwort als
brauchbar, der Rückfall auf `stock` unterblieb, und beim Lesen kam „kein
Preis" heraus. Für genau die Artikel, für die der Rückfall gebaut wurde,
stand dauerhaft „—".

Nachgemessen, bevor etwas geändert wurde: Eine Cache-Zeile
{avg_price: 0, qty_avg_price: 12.34} kam aus fetchPrice() als
{avg_price: 0, qty_avg_price: 0, no_price: true} zurück.

── Warum das ein Verhaltenstest ist ────────────────────────────────────────
Die Aussage ist ein ZUSAMMENSPIEL zweier Dateien über den Cache hinweg. Am
Quelltext liesse sich nur prüfen, dass beide dieselbe Funktion aufrufen —
und das sagt nichts darüber, ob dabei das Richtige herauskommt.
```

<a id="for-stelle"></a>
## `for (const [alter, erwartetAusCache] of [[0, true], [12, false]]) {`

```text
3. Ein 0-Eintrag blockiert den Neuabruf nur KURZ.

Das ist die Aussage, die am Quelltext nicht zu sehen ist: Ob ein alter
Eintrag durchfaellt, haengt an cacheUsable(), ZERO_PRICE_TTL_HOURS und
der Preisregel zusammen. In set-value.test.js stand sie bisher als
indexOf() auf zwei ausgeschriebenen parseFloat-Ausdruecken — die gibt es
nicht mehr, und ein Muster haette ohnehin nur belegt, dass jemand die
Woerter geschrieben hat.
Das Alter muss ZWISCHEN den beiden Fenstern liegen: ZERO_PRICE_TTL_HOURS
ist 6, die normale TTL hier 24. Bei 48 Stunden greift schon die
Cache-Abfrage selbst (fetched_at > NOW() - 24h), der Eintrag wird gar
nicht gefunden — und cacheUsable() käme nie zum Zug. Die erste Fassung
dieses Teilschritts prüfte genau daran vorbei; aufgefallen ist es an der
```

<a id="pn-stelle"></a>
## `const PN = 'probe-teil-${process.pid}';`

```text
4. Der mengengewichtete Schnitt ist der mengengewichtete Schnitt.

Bei Teilen und Minifiguren war er es nie: Die Cache-Abfrage lautete
`SELECT avg_price, avg_price FROM part_price_cache` — dieselbe Spalte
zweimal, obwohl die Tabelle qty_avg_price hat. Entsprechend füllten alle
sechs Rückgabewege beider Funktionen qty_avg_price aus avg_price.
Aufgefallen ist das nicht beim Lesen, sondern an der Regel weiter unten,
nachdem ich sie geweitet hatte — mit blossem Auge hatte ich zwei der
sechs Stellen gesehen.
```

<a id="stelle"></a>
## `assert.doesNotMatch(src, /(?:parseFloat\([^)]*avg_price[^)]*\)|[\w?.]*`

```text
Beide Schreibweisen. Die erste Fassung dieser Regel prüfte nur die
parseFloat-Form — und übersah damit fünf Stellen, die schlicht
`pd.avg_price > 0` schrieben. Aufgefallen ist das nicht an der Regel,
sondern an einer Suche nach wortgleich wiederholten Bedingungen.
Der Vergleich muss DIREKT am avg_price-Ausdruck haengen. Eine weitere
Fassung („avg_price irgendwas > 0") traf auch
`!priceData.avg_price && v > 0` — das ist keine Preispruefung, sondern
„noch kein Wert gemerkt UND der neue taugt". Eine zu weite Regel ist
so unbrauchbar wie eine zu enge: Sie zwingt zur naechsten Ausnahme.
```
