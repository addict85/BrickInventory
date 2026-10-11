/**
 * Die Stückzahl eines Sets — abgeleitet, nicht gespeichert.
 *
 * ── Marcos Frage ────────────────────────────────────────────────────────────
 *
 *   „Wieso hat Sets ebenfalls noch quantity?"
 *
 * Weil die Spalte eine zweite Kopie war. Die Ableitung aus den Erfassungen
 * stand bereits im Baum (routes/api_v1/acquisitions.ts, parentQuantitySql):
 *
 *     UPDATE sets SET quantity = COALESCE(
 *       (SELECT SUM(quantity) FROM set_acquisitions WHERE …), 0)
 *
 * Jedes Bearbeiten einer Erfassung rechnete die Menge also schon aus den
 * Erfassungen neu. Daneben standen aber SIEBEN weitere Schreibstellen, die sie
 * fortschrieben (`quantity = quantity + $1`) oder setzten (`quantity = $1`).
 *
 * ── Und sie sind auseinandergelaufen ────────────────────────────────────────
 *
 * GEMESSEN am laufenden Server (der Befund steht in utils/setService.ts): Zehn
 * gleichzeitige Erfassungen desselben Sets ergaben `sets.quantity = 10`, aber
 * drei Erfassungszeilen mit Summe 7 — drei Exemplare, die es laut der einen
 * Tabelle gab und laut der anderen nicht.
 *
 * Migration 0036 loescht die Spalte. `set_acquisitions` ist die Wahrheit, und
 * zwar die einzige.
 *
 * ── Warum die Rechnung HIER steht und nicht neunzehnmal im Baum ─────────────
 *
 * Neunzehn SQL-Stellen in elf Dateien lesen die Menge (gemessen). Dieselbe
 * Summe neunzehnmal hingeschrieben heisst: neunzehn Stellen, an denen sie beim
 * naechsten Mal leicht anders aussieht. Genau so ist in diesem Baum schon
 * `is_spare` an sechs Stellen in vier Lesarten zerfallen (utils/validate.ts),
 * und genau deshalb gibt es dort ersatzteilSql() — dieselbe Bauart wie hier.
 *
 * ── Zwei Formen, EINE Rechnung ──────────────────────────────────────────────
 *
 * `mengeJoin()` haengt eine gruppierte Quelle an. `mengeSkalar()` setzt eine
 * Unterabfrage in die Spaltenliste. Welche von beiden passt, haengt an der
 * Abfrage, nicht am Geschmack:
 *
 *   * Eine Abfrage ueber EINE Zeile (Set-Detail, Verschieben) nimmt
 *     mengeSkalar(): ein Indexzugriff ueber idx_acq_user_set.
 *   * Eine Abfrage ueber VIELE Zeilen nimmt mengeJoin(). Der Aufbau der
 *     Teile-Zusammenfassung laeuft ueber 171'000 Teilezeilen; eine
 *     Unterabfrage je Zeile waere dort 171'000 Indexzugriffe statt EINER
 *     Gruppierung ueber set_acquisitions (wenige Tausend Zeilen) plus einem
 *     Hash-Join. Die Zahlen zum Aufbau stehen in utils/partsSummary.ts.
 *
 * Die SUMME selbst steht nur einmal da (SUMME unten) — die beiden Formen
 * unterscheiden sich im Weg, nicht im Ergebnis.
 */

/**
 * Die Rechnung, einmal. `::int`, weil SUM(INTEGER) in Postgres BIGINT ergibt
 * und der Treiber BIGINT als ZEICHENKETTE liefert — ohne den Cast haengt der
 * JSON-Typ von `quantity` daran, welcher Zweig geantwortet hat. Genau dieser
 * Fehler ist in utils/handlers/parts.ts schon einmal aufgeflogen.
 */
const SUMME = 'SUM(a.quantity)::int';

/**
 * Stückzahl als Unterabfrage in der Spaltenliste.
 *
 * @param bezug Alias der Zeile, zu der die Menge gehoert — muss `user_id` und
 *              `set_number` fuehren (also `sets` oder eine Zeile daraus).
 */
export function mengeSkalar(bezug: string): string {
  return `COALESCE((SELECT ${SUMME} FROM set_acquisitions a
                     WHERE a.user_id = ${bezug}.user_id
                       AND a.set_number = ${bezug}.set_number), 0)`;
}

/**
 * Stückzahl als gruppierte JOIN-Quelle, fuer Abfragen ueber viele Zeilen.
 *
 * LEFT JOIN und nicht JOIN: Eine Bestandszeile ohne Erfassung soll nicht aus
 * dem Ergebnis fallen. Es sollte sie nicht geben (Migration 0032 traegt fuer
 * jede eine Erfassung nach), aber ein fehlender Eintrag darf eine Liste nicht
 * leeren — er darf nur eine 0 bedeuten.
 *
 * @param bezug Alias der Zeile, zu der die Menge gehoert.
 * @param alias Name der JOIN-Quelle; der Aufrufer liest daraus `<alias>.menge`.
 */
export function mengeJoin(bezug: string, alias = 'sm'): string {
  return `LEFT JOIN (SELECT a.user_id, a.set_number, ${SUMME} AS menge
                       FROM set_acquisitions a
                      GROUP BY a.user_id, a.set_number) ${alias}
               ON ${alias}.user_id = ${bezug}.user_id
              AND ${alias}.set_number = ${bezug}.set_number`;
}

/**
 * Die Mengenspalte zur JOIN-Quelle aus [mengeJoin].
 *
 * Eigene Funktion und nicht nur ein Kommentar: Ohne COALESCE liefert der LEFT
 * JOIN NULL, und NULL in `p.quantity * s.menge` macht die ganze Zeile zu NULL.
 * `COALESCE(s.quantity, 1)` stand vorher an sieben Stellen — die 1 war dort
 * die „Menge eines Sets, das wir nicht kennen". Diese Lesart bleibt, der
 * Aufrufer waehlt sie ueber `fehlt`.
 *
 * @param fehlt Was gilt, wenn es keine Erfassung gibt. 0 fuer eine Stueckzahl,
 *              1 fuer einen Faktor in einer Multiplikation.
 */
export function mengeAus(alias = 'sm', fehlt: 0 | 1 = 0): string {
  return `COALESCE(${alias}.menge, ${fehlt})`;
}

/**
 * Die Stückzahl eines Sets über ein ganzes BLICKFELD, als fertige Abfrage.
 *
 * Dritte Form, und zwar aus Not: utils/setService.ts braucht die Summe nicht
 * je Bestandszeile, sondern über MEHRERE Konten hinweg („wie viele Exemplare
 * hält der Haushalt?"). Dafür passt weder mengeSkalar (eine Zeile) noch
 * mengeJoin (eine Zeile je Konto). Ohne diese Funktion stand derselbe Satz
 * dreimal in derselben Datei — genau die Lage, aus der `is_spare` hier schon
 * in vier Lesarten zerfallen ist.
 *
 * Der JOIN auf `sets` ist nicht Zierrat: Er hält die Einschränkung „nur Konten,
 * die das Set wirklich halten". Eine Erfassung ohne Bestandszeile (etwa nach
 * einem Verschieben) soll nicht mitzählen.
 *
 * Parameter der Abfrage: $1 Konto bzw. Kontenliste, $2 Setnummer.
 *
 * @param konten 'eines' für eine Konto-ID, 'blickfeld' für eine Liste.
 */
export function mengeSummeSql(konten: 'eines' | 'blickfeld'): string {
  return `SELECT COALESCE(${SUMME}, 0) AS q
            FROM set_acquisitions a
            JOIN sets s ON s.user_id = a.user_id AND s.set_number = a.set_number
           WHERE a.user_id ${konten === 'blickfeld' ? '= ANY($1)' : '= $1'}
             AND a.set_number = $2`;
}

import * as db from '../db/database';

/**
 * Was ein Leser bzw. Schreiber hier können muss, und nicht mehr. `any` wäre
 * kürzer; der Typ schreibt hin, was gebraucht wird, statt den Typprüfer für
 * den ganzen Ausdruck abzuschalten. Dieselbe Entscheidung wie in
 * utils/katalogPflege.ts.
 */
type Schreiber = { get: (sql: string, params?: unknown[]) => Promise<any> };

/**
 * Die Stückzahl EINER Set-Zeile — als Zahl, nicht als SQL-Schnipsel.
 *
 * ── Warum es diese Funktion braucht ─────────────────────────────────────────
 *
 * routes/api_v1/acquisitions.ts entscheidet nach jedem Bearbeiten einer
 * Erfassung, ob die Bestandszeile noch einen Bestand hat
 * (raeumeLeerenBestand). Dafür braucht es die Zahl in JavaScript, nicht in
 * einer Abfrage — und es braucht die UNTERSCHEIDUNG:
 *
 *   null → es gibt die Bestandszeile nicht (mehr)
 *   0    → die Zeile ist da, hat aber keine Erfassung mehr → aufräumen
 *
 * Genau diese zwei Fälle gingen beim Umbau verloren: Der Aufruf lief über
 * mengeNeuRechnen(), das seit Migration 0036 nur noch Teile und Figuren
 * kennt. Für ein Set fiel er in den Figuren-Zweig, traf dort keine Zeile und
 * gab null zurück — woraufhin raeumeLeerenBestand die Set-Zeile LÖSCHTE,
 * obwohl noch eine Erfassung dastand. GEMESSEN an
 * test/empty-holding-cleanup-db.test.js: „das Set wurde gelöscht, obwohl noch
 * eine Erfassung übrig ist".
 *
 * Kein UPDATE mehr, nur ein SELECT — es gibt nichts zu schreiben.
 */
export async function mengeDesSets(
  userId: number,
  setNumber: string,
  dbh: Schreiber = db,
): Promise<number | null> {
  const zeile = await dbh.get(
    `SELECT ${mengeSkalar('s')} AS menge
       FROM sets s WHERE s.user_id = $1 AND s.set_number = $2`,
    [userId, setNumber]);
  return zeile ? (parseInt(String(zeile.menge)) || 0) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Teile und Minifiguren — noch materialisiert, aber mit EINEM Schreiber
// ═══════════════════════════════════════════════════════════════════════════
//
// `parts.quantity` und `minifigs.quantity` gibt es noch, und das ist ein
// ZWISCHENSTAND mit Ansage: Sie gehen denselben Weg wie sets.quantity, in
// einem eigenen Schritt. Der Grund fuer die Trennung ist nicht Bequemlichkeit,
// sondern dass die beiden Spalten ZWEI Bedeutungen tragen:
//
//   source='manual'  wie viele der Mensch besitzt  → Summe der Erfassungen
//   source='set'     wie viele im SET stecken      → set_parts_catalog.quantity
//                                                     bzw. set_minifigs_catalog
//
// Fuer Set-Teile gibt es keinen eigenen Kauf (gekauft wurde das Set), also auch
// keine Erfassung. Ihre Stueckzahl ist eine KATALOGZAHL, und der eigene
// Bestand ergibt sich beim Lesen aus Katalogmenge x Set-Menge — genau Marcos
// Formel „alle set_acquisitions-Eintraege x ihre Quantity pro Set pro User".
//
// Die Ableitung braucht dort also eine Fallunterscheidung UND einen Nachtrag:
// Eine Set-Teile-Zeile ohne Katalogzeile verloere ihre Menge. Das ist ein
// eigener Riegel und gehoert in eine eigene Migration.
//
// Bis dahin gilt fuer die beiden Spalten dasselbe wie vorher fuer sets: EIN
// Schreiber, und das ist diese Funktion. Die sieben Stellen, die sie
// fortschrieben, sind weg.

/** Welcher Bestand — Sets stehen hier nicht mehr, ihre Spalte ist weg. */
export type Bestandsart = 'part' | 'fig';

/**
 * Stückzahl einer MANUELL erfassten Position neu aus den Erfassungen rechnen.
 *
 * @param keys Teil: [partNumber, colorId] · Figur: [figNumber]
 * @returns Die neue Stückzahl, oder null, wenn es die Bestandszeile nicht
 *          (mehr) gibt. Das ist kein Fehler: Beim Löschen der letzten
 *          Erfassung entfernt der Aufrufer die Zeile, und ein UPDATE trifft
 *          danach nichts mehr.
 */
export async function mengeNeuRechnen(
  art: Bestandsart,
  userId: number,
  keys: (string | number | null)[],
  dbh: Schreiber = db,
): Promise<number | null> {
  // RETURNING quantity: Die Aufrufer brauchen die neue Zahl fuer ihre Antwort,
  // und ein zweites SELECT danach koennte eine andere sehen.
  //
  // COALESCE(…, 0) und nicht NULL: Eine Zeile ohne Erfassung ist ein Bestand
  // von null Stueck. Die Aufrufer entfernen sie danach (cleanupWhenEmpty) —
  // eine 0 ist der Zwischenzustand, nicht das Ergebnis.
  const zeile = art === 'part'
    ? await dbh.get(
        // COALESCE(color_id, 0) auf BEIDEN Seiten: Die Erfassung fuehrt die
        // Farbe „ohne Angabe" als 0, die Bestandszeile kann dort NULL haben.
        // Ohne das trifft der Vergleich nicht, und die Menge blieb stehen.
        `UPDATE parts SET quantity = COALESCE(
           (SELECT SUM(a.quantity) FROM part_acquisitions a
             WHERE a.user_id = $1 AND a.part_number = $2
               AND COALESCE(a.color_id, 0) = COALESCE($3, 0)), 0)
          WHERE user_id = $1 AND part_number = $2
            AND COALESCE(color_id, 0) = COALESCE($3, 0)
            AND source = 'manual'
        RETURNING quantity`,
        [userId, keys[0], keys[1] ?? 0])
    : await dbh.get(
        `UPDATE minifigs SET quantity = COALESCE(
           (SELECT SUM(a.quantity) FROM minifig_acquisitions a
             WHERE a.user_id = $1 AND a.fig_number = $2), 0)
          WHERE user_id = $1 AND fig_number = $2 AND source = 'manual'
        RETURNING quantity`,
        [userId, keys[0]]);

  return zeile ? (parseInt(String(zeile.quantity)) || 0) : null;
}
