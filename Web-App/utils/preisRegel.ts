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

/**
 * Was ein eingegebener Kaufpreis bedeutet — für ein manuell erfasstes Teil
 * ODER eine manuell erfasste Minifigur.
 *
 * ── Warum das hierher gehört ────────────────────────────────────────────────
 *
 * NACHGEMESSEN stand dieser Block zeichengleich in routes/parts.ts und
 * routes/minifigs.ts; die Doppelungsmessung führt ihn als einen von sechs
 * Achtzeilern, die in beiden Dateien stehen. Verschieden waren nur zwei
 * Dinge: welche Marktpreis-Abfrage gerufen wird und welche Tabelle das
 * Ergebnis bekommt.
 *
 * Der Rest ist eine REGEL, und zwar eine, die schon zweimal in dieser Reihe
 * nachgezogen werden musste (Nachtrag 147: den Zustand mitgeben). Eine Regel
 * an zwei Stellen wird beim dritten Mal nur an einer nachgezogen — das ist
 * das Muster dieser ganzen Sitzung.
 *
 * ── Die Regel selbst ────────────────────────────────────────────────────────
 *
 * Ein leeres Feld heisst NICHT „Preis null", sondern „nimm den Marktpreis".
 * Genau das steht auch als Platzhalter im Eingabefeld beider Oberflächen
 * („Leer = aktueller Marktpreis"). Deshalb:
 *
 *   Zahl eingegeben      → unit_price = Zahl,  purchase_price = dieselbe Zahl
 *   leer / ungültig      → unit_price = null,  purchase_price = Marktpreis
 *
 * Welcher Marktpreis, entscheidet der Zustand, und dessen Staffelung
 * (Eingabe → Bestand → Benutzer-Standard) steht in utils/settings.ts. Ohne
 * ihn bekäme ein als „gebraucht" geführtes Teil den Neupreis.
 *
 * @param roh          `body.unit_price` — Zahl, Text, leer, null oder fehlend.
 * @param zustandRoh   `body.condition` — der eingegebene Zustand, falls einer
 *                     mitkam.
 * @param zustandJetzt Der Zustand, den der Eintrag bisher trägt.
 * @param marktpreis   Holt den Marktpreis für den aufgelösten Zustand. Bleibt
 *                     beim Aufrufer, weil Teil und Figur verschiedene
 *                     Schlüssel haben (Nummer+Farbe gegen Figurennummer).
 */
export async function kaufpreisAusEingabe(
  roh: unknown,
  zustandRoh: unknown,
  zustandJetzt: string | null | undefined,
  nutzerId: number,
  marktpreis: (zustand: string) => Promise<number | null>,
): Promise<{ unitPrice: number | null; purchasePrice: number | null }> {
  const zahl = (roh === null || roh === '' || roh === undefined) ? null : parseFloat(String(roh));
  if (zahl !== null && !isNaN(zahl)) return { unitPrice: zahl, purchasePrice: zahl };
  // Lazy require: utils/settings zieht seinerseits Routen-nahe Module nach,
  // und preisRegel.ts wird auch von clients/bricklink.ts geladen. Ein
  // Import oben schlösse den Kreis.
  const { zustandFuerPreis } = require('./settings') as typeof import('./settings');
  const zustand = await zustandFuerPreis(zustandRoh, zustandJetzt, nutzerId);
  return { unitPrice: null, purchasePrice: await marktpreis(zustand) };
}

/**
 * Was beim manuellen ERFASSEN aus einem eingegebenen Preis/Stk wird.
 *
 * ── Der Befund, der diese Funktion nötig gemacht hat ────────────────────────
 *
 * `resolveManualPartPurchase` (routes/parts.ts) und `resolveManualFigPurchase`
 * (routes/minifigs.ts) waren bis auf die Marktpreis-Abfrage gleich — mit EINEM
 * Unterschied, und der ist ein Fehler:
 *
 *     Teile:      … ?? 0     ← liefert BrickLink nichts, steht 0 in der Zeile
 *     Minifiguren: (nichts)  ← dann steht NULL
 *
 * Bei den Teilen steht der Grund im Quelltext: „sonst zeigt das Kaufpreis-Feld
 * im Frontend dauerhaft den Marktpreis-Platzhalter". utils/financeCalc.ts
 * bestätigt das an beiden Stellen (`hasCost = … != null; // 0 zählt als
 * erfasst`) — eine Figur ohne ermittelbaren Marktpreis galt also als „kein
 * Kaufpreis erfasst", ein Teil in derselben Lage als „0 erfasst". Der Fix ist
 * bei den Teilen gemacht und bei den Figuren liegen geblieben: wieder eine
 * Regel in zwei Kopien, nachgezogen in einer.
 *
 * ── Und ein zweiter Unterschied, INNERHALB von routes/minifigs.ts ───────────
 *
 * Der Preis der ERFASSUNG ist nicht derselbe Wert wie der der Stammzeile: In
 * der Stammzeile ist die 0 ein Anzeigewert, in der Erfassung bedeutet sie
 * „für null Franken gekauft". Deshalb schreibt der Teile-Weg dort
 * `> 0 ? preis : null`. In minifigs.ts stand diese Umwandlung an EINER von
 * DREI Stellen (Zweiterfassung ja, Neuanlage nein, CSV-Import nein).
 *
 * Beide Bedeutungen bekommen deshalb hier verschiedene Namen und kommen fertig
 * zurück. Wer sie benutzt, kann die Umwandlung nicht mehr vergessen.
 *
 * @param marktpreis Holt den Marktpreis für den aufgelösten Zustand — bleibt
 *                   beim Aufrufer, weil Teil und Figur verschiedene Schlüssel
 *                   haben.
 */
export async function manuellerKaufpreis(
  nutzerId: number,
  eingabe: { unitPrice?: unknown; condition?: string | null },
  marktpreis: (zustand: string) => Promise<number | null>,
): Promise<{
  /** Was der Mensch als Preis/Stk eingegeben hat, oder null. */
  unitPrice: number | null;
  /** Für die STAMMZEILE — nie null; siehe oben. */
  kaufpreis: number;
  /** Für die ERFASSUNG — null, wenn kein Preis bekannt ist. */
  erfassungsPreis: number | null;
  /** Eingabe → (kein Bestand) → Benutzer-Standard, siehe utils/settings.ts. */
  zustand: string;
}> {
  const roh = eingabe.unitPrice;
  const getippt = (roh !== undefined && roh !== null && String(roh).trim() !== '')
    ? parseFloat(String(roh).replace(',', '.')) : null;
  const unitPrice = (getippt !== null && !isNaN(getippt)) ? getippt : null;

  // Lazy require: siehe kaufpreisAusEingabe oben.
  const { zustandFuerPreis } = require('./settings') as typeof import('./settings');
  const zustand = await zustandFuerPreis(eingabe.condition ?? null, null, nutzerId);

  const kaufpreis = unitPrice !== null ? unitPrice : ((await marktpreis(zustand)) ?? 0);
  return { unitPrice, kaufpreis, erfassungsPreis: kaufpreis > 0 ? kaufpreis : null, zustand };
}
