import type { DbInterface } from '../../../db/database';
import { erfassungsTagSql, ENTRY_TABLES as SHAPES, type ErfassungsArt } from '../../../db/bestandsmenge';

export type EntryInField = {
  id: number;
  user_id: number;
  condition: string | null;
  preis: number | null;
  price_estimated: boolean;
  currency: string;
  tag: string;
};

/** Nur im Schreib-Blickfeld und nur unter dem Schlüssel aus dem Pfad: Sonst änderte
 * `/parts/A/1/acquisitions/{Erfassung von B}` die Zeile von B, während Sperre und
 * Mengenprüfung auf A liefen. */
export function entryInWriteField(
  tx: DbInterface,
  art: ErfassungsArt,
  id: number,
  wids: number[],
  schluessel: (string | number)[],
) {
  const s = SHAPES[art];
  const spalten = s.keys.map((k, i) => ` AND ${k}=$${i + 3}`).join('');
  return tx.get<EntryInField>(
    `SELECT id, user_id, condition, ${s.price} AS preis, price_estimated, currency, (${erfassungsTagSql()})::text AS tag
       FROM ${s.table} WHERE id=$1 AND user_id = ANY($2)${spalten}`,
    [id, wids, ...schluessel.slice(0, s.keys.length)],
  );
}

/** Schreibend nur in den übergebenen Konten: zweite Linie hinter der Prüfung des Aufrufers. */
export async function setEntryQuantity(
  tx: DbInterface,
  art: ErfassungsArt,
  id: number,
  menge: number,
  konten: number[],
): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[art].table} SET quantity=$1 WHERE id=$2 AND user_id = ANY($3)`, [menge, id, konten]);
}

export async function setEntryPrice(
  tx: DbInterface,
  art: ErfassungsArt,
  id: number,
  preis: number | null,
  geschaetzt: boolean,
  konten: number[],
): Promise<void> {
  await tx.run(
    `UPDATE ${SHAPES[art].table} SET ${SHAPES[art].price}=$1, price_estimated=$2 WHERE id=$3 AND user_id = ANY($4)`,
    [preis, geschaetzt, id, konten],
  );
}

export async function setEntryState(
  tx: DbInterface,
  art: ErfassungsArt,
  id: number,
  zustand: string,
  konten: number[],
): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[art].table} SET condition=$1 WHERE id=$2 AND user_id = ANY($3)`, [zustand, id, konten]);
}

/** Mittag statt Mitternacht: Der Tag bleibt derselbe, in welcher Zeitzone man auch liest. */
export async function setEntryDate(
  tx: DbInterface,
  art: ErfassungsArt,
  id: number,
  datum: string,
  konten: number[],
): Promise<void> {
  await tx.run(
    `UPDATE ${SHAPES[art].table} SET created_at=$1::date + interval '12 hours', day=$1::date
                 WHERE id=$2 AND user_id = ANY($3)`,
    [datum, id, konten],
  );
}

export async function deleteEntry(tx: DbInterface, art: ErfassungsArt, id: number, besitzer: number): Promise<void> {
  await tx.run(`DELETE FROM ${SHAPES[art].table} WHERE id=$1 AND user_id=$2`, [id, besitzer]);
}
