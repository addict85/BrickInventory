import * as db from '../../../db/database';
import type { DbSchnittstelle } from '../../../db/database';
import { erfassungsTagSql } from '../../../db/bestandsmenge';

/** Der eindeutige Index (Migration 0070): Konto, Element, Tag, Zustand, Preis,
 * Schätzung, Währung — gleiche Käufe eines Tages sind eine Zeile. */
export type ErfassungsArt = 'set' | 'part' | 'fig';

const SHAPES = {
  set:  { table: 'set_acquisitions',     price: 'purchase_price', keys: ['set_number'] },
  part: { table: 'part_acquisitions',    price: 'unit_price',     keys: ['part_number', 'color_id'] },
  fig:  { table: 'minifig_acquisitions', price: 'unit_price',     keys: ['fig_number'] },
} as const;

export const preisSpalte = (art: ErfassungsArt): string => SHAPES[art].price;
export const schluesselSpalten = (art: ErfassungsArt): readonly string[] => SHAPES[art].keys;

export type NeueErfassung = { menge: number; preis: number | null; zustand: string; geschaetzt: boolean;
  waehrung: string | null; am: string | null };

/** In einer Anweisung gegen den Index, damit gleichzeitige Erfassungen sich
 * addieren. @returns ob aufgestockt */
export async function fuegeErfassungHinzu(dbh: DbSchnittstelle, art: ErfassungsArt, userId: number,
                                          schluessel: (string | number)[], e: NeueErfassung): Promise<boolean> {
  const shape = SHAPES[art];
  const cols = ['user_id', ...shape.keys, 'quantity', shape.price, 'condition', 'price_estimated', 'currency', 'created_at'];
  const vals = [userId, ...schluessel, e.menge, e.preis, e.zustand, e.geschaetzt, e.waehrung, e.am];
  const ph = vals.map((_, i) => `$${i + 1}`);
  ph[ph.length - 1] = `COALESCE(${ph[ph.length - 1]}::timestamptz, NOW())`;
  const ziel = ['user_id', ...shape.keys, `(${erfassungsTagSql()})`, 'condition',
    `(COALESCE(${shape.price}, -1))`, 'price_estimated', 'currency'];
  const row = await dbh.get(
    `INSERT INTO ${shape.table} AS t (${cols.join(', ')}) VALUES (${ph.join(', ')})
     ON CONFLICT (${ziel.join(', ')}) DO UPDATE SET quantity = t.quantity + EXCLUDED.quantity
     RETURNING (xmax <> 0) AS merged`, vals);
  return !!row?.merged;
}

export type Merkmale = { zustand: string; preis: number | null; geschaetzt: boolean; waehrung: string | null };

export async function gleicheErfassungAmTag(dbh: DbSchnittstelle, art: ErfassungsArt, userId: number,
                                            schluessel: unknown[], tag: string, ausser: number, m: Merkmale): Promise<number | null> {
  const shape = SHAPES[art];
  const keyWhere = shape.keys.map((c, i) => `${c} = $${i + 2}`).join(' AND ');
  const n = shape.keys.length;
  const row = await dbh.get(
    `SELECT id FROM ${shape.table}
      WHERE user_id = $1 AND ${keyWhere}
        AND id <> $${n + 2} AND ${erfassungsTagSql()} = $${n + 3}::date
        AND condition = $${n + 4}
        AND COALESCE(${shape.price}, -1) = COALESCE($${n + 5}::numeric, -1)
        AND price_estimated = $${n + 6}
        AND ($${n + 7}::text IS NULL OR currency = $${n + 7})
      LIMIT 1`,
    [userId, ...schluessel, ausser, tag, m.zustand, m.preis, m.geschaetzt, m.waehrung]);
  return row ? parseInt(row.id) : null;
}

/** Mit dem Tag, wie der Index ihn führt. */
export function erfassungSperren(tx: DbSchnittstelle, art: ErfassungsArt, id: number) {
  return tx.get(`SELECT *, (${erfassungsTagSql()})::text AS tag FROM ${SHAPES[art].table} WHERE id = $1 FOR UPDATE`, [id]);
}

export async function legeErfassungZusammen(tx: DbSchnittstelle, art: ErfassungsArt, von: number, nach: number, menge: number): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[art].table} SET quantity = quantity + $1 WHERE id = $2`, [menge, nach]);
  await tx.run(`DELETE FROM ${SHAPES[art].table} WHERE id = $1`, [von]);
}

export async function setzePreisGeschaetzt(tx: DbSchnittstelle, art: ErfassungsArt, id: number, preis: number): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[art].table} SET ${SHAPES[art].price} = $1, price_estimated = true WHERE id = $2`, [preis, id]);
}

export async function kontoDerErfassung(art: ErfassungsArt, id: number): Promise<number | null> {
  const r = await db.get<{ user_id: number }>(`SELECT user_id FROM ${SHAPES[art].table} WHERE id = $1`, [id]);
  return r ? Number(r.user_id) : null;
}

export async function zustandDerErfassung(art: ErfassungsArt, id: number): Promise<string | null> {
  return (await db.get<{ condition: string }>(`SELECT condition FROM ${SHAPES[art].table} WHERE id=$1`, [id]))?.condition ?? null;
}

export type ErfassungImFeld = { id: number; user_id: number; condition: string | null; preis: number | null;
  price_estimated: boolean; currency: string; tag: string };

/** Nur im Schreib-Blickfeld; beim Set zusätzlich an der Setnummer der Anfrage. */
export function erfassungImSchreibfeld(tx: DbSchnittstelle, art: ErfassungsArt, id: number, wids: number[], schluessel: (string | number)[]) {
  const s = SHAPES[art];
  return tx.get<ErfassungImFeld>(
    `SELECT id, user_id, condition, ${s.price} AS preis, price_estimated, currency, (${erfassungsTagSql()})::text AS tag
       FROM ${s.table} WHERE id=$1 AND user_id = ANY($2)${art === 'set' ? ' AND set_number=$3' : ''}`,
    art === 'set' ? [id, wids, ...schluessel] : [id, wids]);
}

export async function setzeErfassungsMenge(tx: DbSchnittstelle, art: ErfassungsArt, id: number, menge: number): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[art].table} SET quantity=$1 WHERE id=$2`, [menge, id]);
}

export async function setzeErfassungsPreis(tx: DbSchnittstelle, art: ErfassungsArt, id: number, preis: number | null, geschaetzt: boolean): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[art].table} SET ${SHAPES[art].price}=$1, price_estimated=$2 WHERE id=$3`, [preis, geschaetzt, id]);
}

export async function setzeErfassungsZustand(tx: DbSchnittstelle, art: ErfassungsArt, id: number, zustand: string): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[art].table} SET condition=$1 WHERE id=$2`, [zustand, id]);
}

/** Mittag statt Mitternacht: Der Tag bleibt derselbe, in welcher Zeitzone man auch liest. */
export async function setzeErfassungsDatum(tx: DbSchnittstelle, art: ErfassungsArt, id: number, datum: string): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[art].table} SET created_at=$1::date + interval '12 hours', tag=$1::date WHERE id=$2`, [datum, id]);
}

export async function loescheErfassung(tx: DbSchnittstelle, art: ErfassungsArt, id: number, besitzer: number): Promise<void> {
  await tx.run(`DELETE FROM ${SHAPES[art].table} WHERE id=$1 AND user_id=$2`, [id, besitzer]);
}

export function setErfassungenImBlickfeld(blickfeld: number[], setNumber: string) {
  return db.all(
    `SELECT id, quantity, purchase_price, COALESCE(condition, 'N') AS condition, price_estimated, currency,
            created_at, user_id AS owner_user_id FROM set_acquisitions
      WHERE user_id = ANY($1) AND set_number=$2 ORDER BY created_at ASC, id ASC`, [blickfeld, setNumber]);
}
