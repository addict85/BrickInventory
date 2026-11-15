import type { DbSchnittstelle } from '../../../db/database';
import {
  erfassungsTagSql,
  ERFASSUNGS_TABELLEN as SHAPES,
  type ErfassungsArt,
  type ErfassungsZeile,
} from '../../../db/bestandsmenge';

export async function kontoDerErfassung(db: DbSchnittstelle, art: ErfassungsArt, id: number): Promise<number | null> {
  const r = await db.get<{ user_id: number }>(`SELECT user_id FROM ${SHAPES[art].table} WHERE id = $1`, [id]);
  return r ? Number(r.user_id) : null;
}

export async function zustandDerErfassung(db: DbSchnittstelle, art: ErfassungsArt, id: number): Promise<string | null> {
  return (
    (await db.get<{ condition: string }>(`SELECT condition FROM ${SHAPES[art].table} WHERE id=$1`, [id]))?.condition ??
    null
  );
}

export type ErfassungImFeld = {
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
export function erfassungImSchreibfeld(
  tx: DbSchnittstelle,
  art: ErfassungsArt,
  id: number,
  wids: number[],
  schluessel: (string | number)[],
) {
  const s = SHAPES[art];
  const spalten = s.keys.map((k, i) => ` AND ${k}=$${i + 3}`).join('');
  return tx.get<ErfassungImFeld>(
    `SELECT id, user_id, condition, ${s.price} AS preis, price_estimated, currency, (${erfassungsTagSql()})::text AS tag
       FROM ${s.table} WHERE id=$1 AND user_id = ANY($2)${spalten}`,
    [id, wids, ...schluessel.slice(0, s.keys.length)],
  );
}

/** Schreibend nur in den übergebenen Konten: zweite Linie hinter der Prüfung des Aufrufers. */
export async function setzeErfassungsMenge(
  tx: DbSchnittstelle,
  art: ErfassungsArt,
  id: number,
  menge: number,
  konten: number[],
): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[art].table} SET quantity=$1 WHERE id=$2 AND user_id = ANY($3)`, [menge, id, konten]);
}

export async function setzeErfassungsPreis(
  tx: DbSchnittstelle,
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

export async function setzeErfassungsZustand(
  tx: DbSchnittstelle,
  art: ErfassungsArt,
  id: number,
  zustand: string,
  konten: number[],
): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[art].table} SET condition=$1 WHERE id=$2 AND user_id = ANY($3)`, [zustand, id, konten]);
}

/** Mittag statt Mitternacht: Der Tag bleibt derselbe, in welcher Zeitzone man auch liest. */
export async function setzeErfassungsDatum(
  tx: DbSchnittstelle,
  art: ErfassungsArt,
  id: number,
  datum: string,
  konten: number[],
): Promise<void> {
  await tx.run(
    `UPDATE ${SHAPES[art].table} SET created_at=$1::date + interval '12 hours', tag=$1::date
                 WHERE id=$2 AND user_id = ANY($3)`,
    [datum, id, konten],
  );
}

export async function loescheErfassung(
  tx: DbSchnittstelle,
  art: ErfassungsArt,
  id: number,
  besitzer: number,
): Promise<void> {
  await tx.run(`DELETE FROM ${SHAPES[art].table} WHERE id=$1 AND user_id=$2`, [id, besitzer]);
}

export function setErfassungenImBlickfeld(db: DbSchnittstelle, blickfeld: number[], setNumber: string) {
  return db.all<ErfassungsZeile>(
    `SELECT id, quantity, purchase_price, COALESCE(condition, 'N') AS condition, price_estimated, currency,
            created_at, user_id AS owner_user_id FROM set_acquisitions
      WHERE user_id = ANY($1) AND set_number=$2 ORDER BY created_at ASC, id ASC`,
    [blickfeld, setNumber],
  );
}
