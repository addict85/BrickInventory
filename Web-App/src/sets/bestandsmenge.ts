/**
 * Die Stückzahl eines Sets — abgeleitet, nicht gespeichert.
 * Ausführlich: docs/begruendungen/src/sets/bestandsmenge.ts.md#abschnitt
 */

/**
 * Die Rechnung, einmal. `::int`, weil SUM(INTEGER) in Postgres BIGINT ergibt
 * und der Treiber BIGINT als ZEICHENKETTE liefert — ohne den Cast haengt der
 * JSON-Typ von `quantity` daran, welcher Zweig geantwortet hat. Genau dieser
 * Fehler ist in src/teile/abfragen.ts schon einmal aufgeflogen.
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
 * Ausführlich: docs/begruendungen/src/sets/bestandsmenge.ts.md#mengejoin
 * @param bezug Alias der Zeile, zu der die Menge gehoert.
 * @param alias Name der JOIN-Quelle; der Aufrufer liest daraus `<alias>.menge`.
 * @param konten Bedingung auf das Konto, z. B. `= ANY($1)`. Ohne sie summiert
 *              die Unterabfrage die Erfassungen ALLER Konten, bevor der JOIN
 *              filtert — der Planer kann die Kontobedingung nicht hineinziehen.
 */
export function mengeJoin(bezug: string, alias = 'sm', konten?: string): string {
  const filter = konten ? `
                      WHERE a.user_id ${konten}` : '';
  return `LEFT JOIN (SELECT a.user_id, a.set_number, ${SUMME} AS menge
                       FROM set_acquisitions a${filter}
                      GROUP BY a.user_id, a.set_number) ${alias}
               ON ${alias}.user_id = ${bezug}.user_id
              AND ${alias}.set_number = ${bezug}.set_number`;
}

/**
 * Die Mengenspalte zur JOIN-Quelle aus [mengeJoin].
 * Ausführlich: docs/begruendungen/src/sets/bestandsmenge.ts.md#mengeaus
 * @param fehlt Was gilt, wenn es keine Erfassung gibt. 0 fuer eine Stueckzahl,
 */
export function mengeAus(alias = 'sm', fehlt: 0 | 1 = 0): string {
  return `COALESCE(${alias}.menge, ${fehlt})`;
}

/**
 * Die Stückzahl eines Sets über ein ganzes BLICKFELD, als fertige Abfrage.
 * Ausführlich: docs/begruendungen/src/sets/bestandsmenge.ts.md#mengesummesql
 * @param konten 'eines' für eine Konto-ID, 'blickfeld' für eine Liste.
 */
export function mengeSummeSql(konten: 'eines' | 'blickfeld'): string {
  return `SELECT COALESCE(${SUMME}, 0) AS q
            FROM set_acquisitions a
            JOIN sets s ON s.user_id = a.user_id AND s.set_number = a.set_number
           WHERE a.user_id ${konten === 'blickfeld' ? '= ANY($1)' : '= $1'}
             AND a.set_number = $2`;
}

import * as db from '../../db/database';
import { colorId } from '../infra/validate';

/**
 * Was ein Leser bzw. Schreiber hier können muss, und nicht mehr. `any` wäre
 * kürzer; der Typ schreibt hin, was gebraucht wird, statt den Typprüfer für
 * den ganzen Ausdruck abzuschalten. Dieselbe Entscheidung wie in
 * utils/katalogPflege.ts.
 */
type Schreiber = { get: (sql: string, params?: unknown[]) => Promise<any> };

/**
 * Die Stückzahl EINER Set-Zeile — als Zahl, nicht als SQL-Schnipsel.
 * Ausführlich: docs/begruendungen/src/sets/bestandsmenge.ts.md#mengedessets
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

// Richtig, und es war ein ZWISCHENSTAND mit Ansage: Die Spalte trug ZWEI
// Bedeutungen, und deshalb ging sie nicht mit sets.quantity zusammen weg.
// Ausführlich: docs/begruendungen/src/sets/bestandsmenge.ts.md#bestandsart

/** Welcher Bestand. Sets stehen hier nicht: ihre Spalte ist seit 0036 weg. */
export type Bestandsart = 'part' | 'fig';

/** Je Art: Tabellen, Schluessel und Spaltennamen. Einmal, als Tabelle. */
const ART = {
  part: {
    bestand:   'parts',
    erfassung: 'part_acquisitions',
    katalog:   'set_teile',
    nummer:    'part_number',
    // Die Farbe gehoert in BEIDE Schluessel — und COALESCE(...,0) auf beiden
    // Seiten: Die Erfassung fuehrt „ohne Angabe" als 0, die Bestandszeile
    // kann dort NULL haben. Ohne das trifft der Vergleich nicht, und die
    // Menge faellt auf den Rueckfallwert. Genau dieser Fehler stand schon
    // einmal in mengeNeuRechnen().
    farbe:     true,
  },
  fig: {
    bestand:   'minifigs',
    erfassung: 'minifig_acquisitions',
    katalog:   'set_minifigs_catalog',
    nummer:    'fig_number',
    farbe:     false,
  },
} as const;

/**
 * Die beiden JOIN-Quellen fuer die Stückzahl einer Bestandszeile.
 * Ausführlich: docs/begruendungen/src/sets/bestandsmenge.ts.md#teilmengejoin
 * @param bezug Alias der Bestandszeile, z. B. `p` oder `m`
 * @param alias Grundname; angelegt werden `<alias>_e` (Erfassungen) und
 * @param konten wie bei mengeJoin: schränkt die Erfassungen auf das Blickfeld ein
 */
export function teilmengeJoin(bezug: string, art: Bestandsart, alias = 'tm', konten?: string): string {
  const a = ART[art];
  const farbErf = a.farbe
    ? `, x.color_id AS fk` : '';
  const farbVgl = a.farbe
    ? ` AND ${alias}_e.fk = ${bezug}.color_id` : '';
  const farbKat = a.farbe
    ? ` AND ${alias}_k.color_id = ${bezug}.color_id` : '';
  return `LEFT JOIN (SELECT x.user_id, x.${a.nummer}${farbErf},
                             SUM(x.quantity)::int AS menge
                        FROM ${a.erfassung} x${konten ? `
                       WHERE x.user_id ${konten}` : ''}
                       GROUP BY x.user_id, x.${a.nummer}${a.farbe ? ', x.color_id' : ''}) ${alias}_e
               ON ${alias}_e.user_id = ${bezug}.user_id
              AND ${alias}_e.${a.nummer} = ${bezug}.${a.nummer}${farbVgl}
    LEFT JOIN ${a.katalog} ${alias}_k
               ON ${alias}_k.set_number = ${bezug}.set_number
              AND ${alias}_k.${a.nummer} = ${bezug}.${a.nummer}${farbKat}`;
}

/**
 * Die Stückzahl der Bestandszeile — die Fallunterscheidung selbst.
 * Ausführlich: docs/begruendungen/src/sets/bestandsmenge.ts.md#teilmengeaus
 */
export function teilmengeAus(bezug: string, _art: Bestandsart, alias = 'tm'): string {
  return `CASE WHEN COALESCE(${bezug}.source, 'set') = 'manual'
               THEN COALESCE(${alias}_e.menge, 0)
               ELSE COALESCE(${alias}_k.quantity, 1) END`;
}

/**
 * Die Stückzahl EINER manuellen Position — als Zahl, nicht als Schnipsel.
 * Ausführlich: docs/begruendungen/src/sets/bestandsmenge.ts.md#mengederposition
 */
export async function mengeDerPosition(
  art: Bestandsart,
  userId: number,
  keys: (string | number | null)[],
  dbh: { get: (sql: string, params?: unknown[]) => Promise<any> } = db,
): Promise<number | null> {
  const a = ART[art];
  const farbe = a.farbe ? ' AND b.color_id = $3' : '';
  const farbErf = a.farbe ? ' AND x.color_id = $3' : '';
  const params = a.farbe ? [userId, keys[0], colorId(keys[1])] : [userId, keys[0]];
  const zeile = await dbh.get(
    `SELECT COALESCE((SELECT SUM(x.quantity) FROM ${a.erfassung} x
                       WHERE x.user_id = $1 AND x.${a.nummer} = $2${farbErf}), 0)::int AS menge
       FROM ${a.bestand} b
      WHERE b.user_id = $1 AND b.${a.nummer} = $2${farbe}
        AND b.source = 'manual'`,
    params);
  return zeile ? (parseInt(String(zeile.menge)) || 0) : null;
}

