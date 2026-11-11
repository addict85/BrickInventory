/**
 * Die Stückzahl eines Sets — abgeleitet, nicht gespeichert.
 */

/** `::int`: SUM(INTEGER) ergibt BIGINT, und das liefert der Treiber als
 * Zeichenkette — sonst hinge der JSON-Typ von `quantity` am Zweig. */
const SUMME = 'SUM(a.quantity)::int';

/** Stückzahl als Unterabfrage in der Spaltenliste. `bezug` ist der Alias
 * einer Zeile mit `user_id` und `set_number` (also `sets`). */
export function mengeSkalar(bezug: string): string {
  return `COALESCE((SELECT ${SUMME} FROM set_acquisitions a
                     WHERE a.user_id = ${bezug}.user_id
                       AND a.set_number = ${bezug}.set_number), 0)`;
}

/** Stückzahl als gruppierte JOIN-Quelle (`<alias>.menge`). `konten`, z. B.
 * `= ANY($1)`, filtert schon in der Unterabfrage: Der Planer zieht die
 * Kontobedingung des JOIN nicht hinein und summierte sonst alle Konten. */
export function mengeJoin(bezug: string, alias = 'sm', konten?: string): string {
  const filter = konten ? `
                      WHERE a.user_id ${konten}` : '';
  return `LEFT JOIN (SELECT a.user_id, a.set_number, ${SUMME} AS menge
                       FROM set_acquisitions a${filter}
                      GROUP BY a.user_id, a.set_number) ${alias}
               ON ${alias}.user_id = ${bezug}.user_id
              AND ${alias}.set_number = ${bezug}.set_number`;
}

/** Die Mengenspalte zu [mengeJoin], nie NULL (NULL machte jedes Produkt
 * NULL). `fehlt`: 0 für eine Stückzahl, 1 für einen Faktor. */
export function mengeAus(alias = 'sm', fehlt: 0 | 1 = 0): string {
  return `COALESCE(${alias}.menge, ${fehlt})`;
}

/**
 * Die Stückzahl eines Sets über ein ganzes BLICKFELD, als fertige Abfrage.
 * @param konten 'eines' für eine Konto-ID, 'blickfeld' für eine Liste.
 */
export function mengeSummeSql(konten: 'eines' | 'blickfeld'): string {
  return `SELECT COALESCE(${SUMME}, 0) AS q
            FROM set_acquisitions a
            JOIN sets s ON s.user_id = a.user_id AND s.set_number = a.set_number
           WHERE a.user_id ${konten === 'blickfeld' ? '= ANY($1)' : '= $1'}
             AND a.set_number = $2`;
}

import type { DbSchnittstelle } from './database';
import { colorId } from '../src/infra/validate';

/** Was ein Leser hier können muss, und nicht mehr: `db` oder eine Transaktion. */
type Schreiber = Pick<DbSchnittstelle, 'get'>;

/**
 * Die Stückzahl EINER Set-Zeile — als Zahl, nicht als SQL-Schnipsel.
 */
export async function mengeDesSets(
  userId: number,
  setNumber: string,
  dbh: Schreiber,
): Promise<number | null> {
  const zeile = await dbh.get<{ menge: unknown }>(
    `SELECT ${mengeSkalar('s')} AS menge
       FROM sets s WHERE s.user_id = $1 AND s.set_number = $2`,
    [userId, setNumber]);
  return zeile ? (parseInt(String(zeile.menge)) || 0) : null;
}

// Teile und Figuren haben noch eine Mengenspalte, weil sie zwei Bedeutungen
// trägt.

/** Welcher Bestand. Sets stehen hier nicht: ihre Spalte ist seit 0036 weg. */
export interface ErfassungsZeile {
  id: number; quantity: number; purchase_price?: number | null; unit_price?: number | null;
  condition: string; price_estimated: boolean; currency: string | null;
  created_at: Date | null; owner_user_id: number;
}

export type Bestandsart = 'part' | 'fig';

/** Je Art: Tabellen, Schluessel und Spaltennamen. Einmal, als Tabelle. */
const ART = {
  part: {
    bestand:   'parts',
    erfassung: 'part_acquisitions',
    katalog:   'set_teile',
    nummer:    'part_number',
    // Die Farbe gehört in beide Schlüssel; „ohne Angabe“ ist in der
    // Erfassung 0, in der Bestandszeile womöglich NULL.
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

/** Die JOIN-Quellen `<alias>_e` (Erfassungen) und `<alias>_k` (Katalog) für
 * die Stückzahl der Bestandszeile `bezug`; `konten` wie bei [mengeJoin]. */
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
 */
export function teilmengeAus(bezug: string, _art: Bestandsart, alias = 'tm'): string {
  return `CASE WHEN COALESCE(${bezug}.source, 'set') = 'manual'
               THEN COALESCE(${alias}_e.menge, 0)
               ELSE COALESCE(${alias}_k.quantity, 1) END`;
}

/**
 * Die Stückzahl EINER manuellen Position — als Zahl, nicht als Schnipsel.
 */
export async function mengeDerPosition(
  art: Bestandsart,
  userId: number,
  keys: (string | number | null)[],
  dbh: Pick<DbSchnittstelle, 'get'>,
): Promise<number | null> {
  const a = ART[art];
  const farbe = a.farbe ? ' AND b.color_id = $3' : '';
  const farbErf = a.farbe ? ' AND x.color_id = $3' : '';
  const params = a.farbe ? [userId, keys[0], colorId(keys[1])] : [userId, keys[0]];
  const zeile = await dbh.get<{ menge: unknown }>(
    `SELECT COALESCE((SELECT SUM(x.quantity) FROM ${a.erfassung} x
                       WHERE x.user_id = $1 AND x.${a.nummer} = $2${farbErf}), 0)::int AS menge
       FROM ${a.bestand} b
      WHERE b.user_id = $1 AND b.${a.nummer} = $2${farbe}
        AND b.source = 'manual'`,
    params);
  return zeile ? (parseInt(String(zeile.menge)) || 0) : null;
}

/** Der Tag einer Erfassung genau wie im eindeutigen Index (0070): `tag`, für
 * ältere Zeilen der UTC-Tag. Ein anderer Ausdruck träfe den Index nicht. */
export function erfassungsTagSql(alias = ''): string {
  const a = alias ? `${alias}.` : '';
  return `COALESCE(${a}tag, (${a}created_at AT TIME ZONE 'UTC')::date)`;
}

/** Bedingung: Der Kaufpreis ist in der heutigen Kontowährung erfasst — ein
 * Preis in anderer Währung verfälschte Durchschnitte. Die Währung kommt
 * einmal je Abfrage aus [kontowaehrungJoin]. */
export function inKontowaehrung(tabelle: string, alias = 'kw'): string {
  return `${tabelle}.currency = COALESCE(${alias}.value, 'EUR')`;
}

/** Die Kontowährung als JOIN-Quelle für [inKontowaehrung]. */
export function kontowaehrungJoin(tabelle: string, alias = 'kw'): string {
  return `LEFT JOIN user_settings ${alias}
            ON ${alias}.user_id = ${tabelle}.user_id AND ${alias}.key = 'currency'`;
}

/** Die drei Erfassungstabellen; der eindeutige Index (Migration 0070) läuft
 * über Konto, Element, Tag, Zustand, Preis, Schätzung und Währung. */
export type ErfassungsArt = 'set' | 'part' | 'fig';
export const ERFASSUNGS_TABELLEN = {
  set:  { table: 'set_acquisitions',     price: 'purchase_price', keys: ['set_number'] },
  part: { table: 'part_acquisitions',    price: 'unit_price',     keys: ['part_number', 'color_id'] },
  fig:  { table: 'minifig_acquisitions', price: 'unit_price',     keys: ['fig_number'] },
} as const;
export const preisSpalte = (art: ErfassungsArt): string => ERFASSUNGS_TABELLEN[art].price;
export const schluesselSpalten = (art: ErfassungsArt): readonly string[] => ERFASSUNGS_TABELLEN[art].keys;
