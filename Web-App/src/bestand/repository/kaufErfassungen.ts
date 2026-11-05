import type { DbSchnittstelle } from '../../../db/database';
import { erfassungsTagSql, ERFASSUNGS_TABELLEN as SHAPES } from '../../../db/bestandsmenge';
import type { ErfassungsArt } from '../../../db/bestandsmenge';

/** Gleiche Käufe eines Tages sind eine Zeile (eindeutiger Index, Migration 0070). */

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
