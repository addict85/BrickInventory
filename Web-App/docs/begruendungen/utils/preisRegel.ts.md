# Begründungen zu `utils/preisRegel.ts`

Die ausführlichen Kommentare aus `utils/preisRegel.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="preisdatensatz"></a>
## `PreisDatensatz`

```text
Wann hat ein Preis-Datensatz einen Preis?

── Warum das eine eigene Datei ist ─────────────────────────────────────────
Diese eine Frage stand an vier Stellen, in drei Fassungen:

  clients/bricklink.ts   hasUsablePrice()  avg > 0 ODER qty_avg > 0
  utils/financeCalc.ts   cacheUsable()     avg > 0
  utils/financeCalc.ts   Cache-Treffer     avg > 0
  utils/financeCalc.ts   Rueckfall-Zeile   avg > 0 ODER avg > 0   ← zweimal
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

<a id="kaufpreisauseingabe"></a>
## `kaufpreisAusEingabe`

```text
Was ein eingegebener Kaufpreis bedeutet — für ein manuell erfasstes Teil
ODER eine manuell erfasste Minifigur.

── Warum das hierher gehört ────────────────────────────────────────────────

NACHGEMESSEN stand dieser Block zeichengleich in routes/parts.ts und
routes/minifigs.ts; die Doppelungsmessung führt ihn als einen von sechs
Achtzeilern, die in beiden Dateien stehen. Verschieden waren nur zwei
Dinge: welche Marktpreis-Abfrage gerufen wird und welche Tabelle das
Ergebnis bekommt.

Der Rest ist eine REGEL, und zwar eine, die schon zweimal in dieser Reihe
nachgezogen werden musste (Nachtrag 147: den Zustand mitgeben). Eine Regel
an zwei Stellen wird beim dritten Mal nur an einer nachgezogen — das ist
das Muster dieser ganzen Sitzung.

── Die Regel selbst ────────────────────────────────────────────────────────

Ein leeres Feld heisst NICHT „Preis null", sondern „nimm den Marktpreis".
Genau das steht auch als Platzhalter im Eingabefeld beider Oberflächen
(„Leer = aktueller Marktpreis"). Deshalb:

  Zahl eingegeben      → unit_price = Zahl,  purchase_price = dieselbe Zahl
  leer / ungültig      → unit_price = null,  purchase_price = Marktpreis

Welcher Marktpreis, entscheidet der Zustand, und dessen Staffelung
(Eingabe → Bestand → Benutzer-Standard) steht in src/konto/settings.ts. Ohne
ihn bekäme ein als „gebraucht" geführtes Teil den Neupreis.

@param roh          `body.unit_price` — Zahl, Text, leer, null oder fehlend.
@param zustandRoh   `body.condition` — der eingegebene Zustand, falls einer
                    mitkam.
@param zustandJetzt Der Zustand, den der Eintrag bisher trägt.
@param marktpreis   Holt den Marktpreis für den aufgelösten Zustand. Bleibt
                    beim Aufrufer, weil Teil und Figur verschiedene
                    Schlüssel haben (Nummer+Farbe gegen Figurennummer).
```

<a id="manuellerkaufpreis"></a>
## `manuellerKaufpreis`

```text
Was beim manuellen ERFASSEN aus einem eingegebenen Preis/Stk wird.

── Der Befund, der diese Funktion nötig gemacht hat ────────────────────────

`resolveManualPartPurchase` (routes/parts.ts) und `resolveManualFigPurchase`
(routes/minifigs.ts) waren bis auf die Marktpreis-Abfrage gleich — mit EINEM
Unterschied, und der ist ein Fehler:

    Teile:      … ?? 0     ← liefert BrickLink nichts, steht 0 in der Zeile
    Minifiguren: (nichts)  ← dann steht NULL

Bei den Teilen steht der Grund im Quelltext: „sonst zeigt das Kaufpreis-Feld
im Frontend dauerhaft den Marktpreis-Platzhalter". utils/financeCalc.ts
bestätigt das an beiden Stellen (`hasCost = … != null; // 0 zählt als
erfasst`) — eine Figur ohne ermittelbaren Marktpreis galt also als „kein
Kaufpreis erfasst", ein Teil in derselben Lage als „0 erfasst". Der Fix ist
bei den Teilen gemacht und bei den Figuren liegen geblieben: wieder eine
Regel in zwei Kopien, nachgezogen in einer.

── Und ein zweiter Unterschied, INNERHALB von routes/minifigs.ts ───────────

Der Preis der ERFASSUNG ist nicht derselbe Wert wie der der Stammzeile: In
der Stammzeile ist die 0 ein Anzeigewert, in der Erfassung bedeutet sie
„für null Franken gekauft". Deshalb schreibt der Teile-Weg dort
`> 0 ? preis : null`. In minifigs.ts stand diese Umwandlung an EINER von
DREI Stellen (Zweiterfassung ja, Neuanlage nein, CSV-Import nein).

Beide Bedeutungen bekommen deshalb hier verschiedene Namen und kommen fertig
zurück. Wer sie benutzt, kann die Umwandlung nicht mehr vergessen.

── Und woher der Marktpreis stammt (Nachtrag 167) ─────────────────────────

Marcos zwei Befunde widersprachen sich, weil sie zwei Seiten derselben
Tatsache sind: BrickLink hat oft nur zu EINEM Zustand Verkäufe.

  1. „Der Zustand hat keinen Einfluss auf den Preis" — der Rückfall auf den
     anderen Zustand lieferte für neu und gebraucht denselben Wert.
  2. „Teilweise wird der Kaufpreis nicht direkt geladen" — nachdem ich den
     Rückfall verworfen hatte, blieb das Feld leer.

Seine Entscheidung: den Preis übernehmen, aber sichtbar kennzeichnen. Dafür
muss die Herkunft mitreisen — darum gibt der `marktpreis`-Rückruf jetzt
nicht mehr eine blosse Zahl zurück, sondern auch den Zustand, aus dem sie
stammt. Ein Feld, das man ignorieren KANN, wäre hier zu wenig: Die beiden
Aufrufer sind Zwillinge, und in diesem Baum ist schon mehrfach eine Regel
nur auf einer Seite nachgezogen worden.

@param marktpreis Holt den Marktpreis für den aufgelösten Zustand — bleibt
                  beim Aufrufer, weil Teil und Figur verschiedene Schlüssel
                  haben. `ausZustand` ist gesetzt, WENN der Preis aus dem
                  anderen Zustand stammt, sonst null.
```
