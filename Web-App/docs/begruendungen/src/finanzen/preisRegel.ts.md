# Begründungen zu `src/finanzen/preisRegel.ts`

Die ausführlichen Kommentare aus `src/finanzen/preisRegel.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

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
(Eingabe → Bestand → Benutzer-Standard) steht in src/einstellungen/settings.ts. Ohne
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
im Frontend dauerhaft den Marktpreis-Platzhalter". src/finanzen/financeCalc.ts
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
