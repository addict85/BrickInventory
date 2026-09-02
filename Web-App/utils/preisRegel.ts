/**
 * Wann hat ein Preis-Datensatz einen Preis?
 *
 * ── Warum das eine eigene Datei ist ─────────────────────────────────────────
 * Diese eine Frage stand an vier Stellen, in drei Fassungen:
 *
 *   clients/bricklink.ts   hasUsablePrice()  avg > 0 ODER qty_avg > 0
 *   utils/financeCalc.ts   cacheUsable()     avg > 0
 *   utils/financeCalc.ts   Cache-Treffer     avg > 0
 *   utils/financeCalc.ts   Rueckfall-Zeile   avg > 0 ODER avg > 0   ← zweimal
 *                                                                    dasselbe
 *
 * Die letzte ist ein Tippfehler; gemeint war offensichtlich qty_avg. Die erste
 * ist der eigentliche Fehler, und er wirkt zusammen mit der zweiten:
 *
 * `hasUsablePrice` entscheidet in bricklink.ts, ob nach einer erfolglosen
 * `sold`-Abfrage noch `stock` versucht wird. Antwortet BrickLink mit
 * avg_price = 0, aber qty_avg_price > 0 — bei selten gehandelten Artikeln der
 * Normalfall —, dann gilt die Antwort dort als brauchbar, der Rueckfall auf
 * `stock` UNTERBLEIBT, und die Zeile wird so gespeichert. Beim Lesen verlangt
 * financeCalc dann avg_price > 0, findet keinen und meldet `no_price`.
 *
 * Ergebnis: Fuer genau die Artikel, fuer die der sold→stock-Rueckfall gebaut
 * wurde, steht dauerhaft „—" statt eines Marktpreises. Nachgemessen gegen die
 * Datenbank: Eine Zeile {avg_price: 0, qty_avg_price: 12.34} — die
 * hasUsablePrice() „brauchbar" nennt — kommt aus fetchPrice() als
 * {avg_price: 0, qty_avg_price: 0, no_price: true} zurueck.
 *
 * ── Welche Fassung gewinnt, und warum diese ─────────────────────────────────
 * Die enge. In financeCalc.ts steht dazu eine ausdrueckliche Entscheidung:
 * „Preis-Vorhandensein an avg_price festmachen — das ist der Wert, den alle
 * Verbraucher lesen." Das stimmt: Android und Webapp zeigen den Marktpreis
 * ueber `avg_price ?: qty_avg_price` an, und eine 0 ist nicht null — sie wuerde
 * als „0.00" durchgereicht.
 *
 * ── Ein Nebeneffekt, der genannt gehoert ────────────────────────────────────
 * An zwei Stellen stand `parseFloat(x.avg_price) === 0` — also „vorhanden UND
 * null". `!hatPreis(x)` ist etwas weiter: Es trifft auch eine Zeile mit
 * avg_price = NULL. Das ist beabsichtigt und richtig — beides heisst „kein
 * anzeigbarer Preis", und der Zweig darunter tut in beiden Faellen dasselbe.
 * In der Praxis kommt NULL dort nicht vor (jeder INSERT schreibt
 * parseFloat(... || 0)), aber die Regel soll nicht davon abhaengen.
 *
 * Die Regel wandert deshalb NICHT nach aussen, sondern der Torwaechter nach
 * innen: Was der Leser nicht als Preis anerkennt, darf auch den Rueckfall
 * nicht unterdruecken. Damit versucht bricklink.ts jetzt `stock`, wo es vorher
 * aufgab — schlimmstenfalls eine zusaetzliche Abfrage fuer einen Artikel, der
 * bisher gar keinen Preis bekam. Einen Preis wegnehmen kann die Aenderung
 * nicht: Bringt auch `stock` nichts, bleibt es bei der `sold`-Antwort wie
 * bisher.
 */

/** Der Datensatz, wie er aus BrickLink oder aus price_cache kommt. */
export type PreisDatensatz = { avg_price?: unknown; qty_avg_price?: unknown } | null | undefined;

/**
 * Hat der Datensatz einen Preis, den die Oberflaeche anzeigen kann?
 *
 * parseFloat(String(...)): avg_price ist eine numeric-Spalte. Der pg-Treiber
 * ist hier zwar auf parseFloat eingestellt (db/database.ts), aber dieselbe
 * Funktion bekommt auch rohe BrickLink-Antworten, und die tragen Text.
 */
export function hatPreis(row: PreisDatensatz): boolean {
  return parseFloat(String(row?.avg_price ?? '')) > 0;
}
