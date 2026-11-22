import type { DbInterface, Row } from '../../../db/database';
import { acquisitionDaySql, ENTRY_TABLES as SHAPES, type AcquisitionKind } from '../../../db/stockQuantity';

/** Identical purchases of one day are one row (unique index, migration 0070). */

export type NewEntry = {
  quantity: number;
  preis: number | null;
  condition: string;
  geschaetzt: boolean;
  currency: string | null;
  am: string | null;
};

/** In one statement against the index, so that concurrent acquisitions
 * add up. @returns whether topped up */
export async function addEntryAdd(
  dbh: DbInterface,
  kind: AcquisitionKind,
  userId: number,
  key: (string | number)[],
  e: NewEntry,
): Promise<boolean> {
  const shape = SHAPES[kind];
  const cols = [
    'user_id',
    ...shape.keys,
    'quantity',
    shape.price,
    'condition',
    'price_estimated',
    'currency',
    'created_at',
  ];
  const vals = [userId, ...key, e.quantity, e.preis, e.condition, e.geschaetzt, e.currency, e.am];
  const ph = vals.map((_, i) => `$${i + 1}`);
  ph[ph.length - 1] = `COALESCE(${ph[ph.length - 1]}::timestamptz, NOW())`;
  const target = [
    'user_id',
    ...shape.keys,
    `(${acquisitionDaySql()})`,
    'condition',
    `(COALESCE(${shape.price}, -1))`,
    'price_estimated',
    'currency',
  ];
  const row = await dbh.get<{ merged: boolean }>(
    `INSERT INTO ${shape.table} AS t (${cols.join(', ')}) VALUES (${ph.join(', ')})
     ON CONFLICT (${target.join(', ')}) DO UPDATE SET quantity = t.quantity + EXCLUDED.quantity
     RETURNING (xmax <> 0) AS merged`,
    vals,
  );
  return !!row?.merged;
}

export type Features = { condition: string; preis: number | null; geschaetzt: boolean; currency: string | null };

export async function sameEntryAtTag(
  dbh: DbInterface,
  kind: AcquisitionKind,
  userId: number,
  key: unknown[],
  tag: string,
  except: number,
  m: Features,
): Promise<number | null> {
  const shape = SHAPES[kind];
  const keyWhere = shape.keys.map((c, i) => `${c} = $${i + 2}`).join(' AND ');
  const n = shape.keys.length;
  const row = await dbh.get<{ id: number }>(
    `SELECT id FROM ${shape.table}
      WHERE user_id = $1 AND ${keyWhere}
        AND id <> $${n + 2} AND ${acquisitionDaySql()} = $${n + 3}::date
        AND condition = $${n + 4}
        AND COALESCE(${shape.price}, -1) = COALESCE($${n + 5}::numeric, -1)
        AND price_estimated = $${n + 6}
        AND ($${n + 7}::text IS NULL OR currency = $${n + 7})
      LIMIT 1`,
    [userId, ...key, except, tag, m.condition, m.preis, m.geschaetzt, m.currency],
  );
  return row ? Number(row.id) : null;
}

/** With the day, as the index carries it. */
export function lockEntry(tx: DbInterface, kind: AcquisitionKind, id: number) {
  return tx.get<Row<{ user_id: number; tag: string; condition: string; currency: string | null; quantity: number }>>(
    `SELECT *, (${acquisitionDaySql()})::text AS tag FROM ${SHAPES[kind].table} WHERE id = $1 FOR UPDATE`,
    [id],
  );
}

/** Put quantity back into an existing row of the account (trash). @returns whether the row existed */
export async function stallEntryOn(
  tx: DbInterface,
  kind: AcquisitionKind,
  id: number,
  userId: number,
  quantity: number,
): Promise<boolean> {
  const r = await tx.run(`UPDATE ${SHAPES[kind].table} SET quantity = quantity + $1 WHERE id = $2 AND user_id = $3`, [
    quantity,
    id,
    userId,
  ]);
  return !!r.changes;
}

export async function putEntryTogether(
  tx: DbInterface,
  kind: AcquisitionKind,
  fromValue: number,
  nach: number,
  quantity: number,
): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[kind].table} SET quantity = quantity + $1 WHERE id = $2`, [quantity, nach]);
  await tx.run(`DELETE FROM ${SHAPES[kind].table} WHERE id = $1`, [fromValue]);
}

export async function setPriceEstimated(
  tx: DbInterface,
  kind: AcquisitionKind,
  id: number,
  price: number,
): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[kind].table} SET ${SHAPES[kind].price} = $1, price_estimated = true WHERE id = $2`, [
    price,
    id,
  ]);
}

/** Amounts into the account's currency, at the day's rate (in_currency, 0077); null without a rate. */
export async function inCurrencyOfAccount(
  db: DbInterface,
  uid: number,
  amounts: (number | null)[],
  currencies: (string | null)[],
  days: (string | null)[],
) {
  const rows = await db.all<{ i: string; k: number | null }>(
    `SELECT t.i, in_currency(t.b, COALESCE(t.c, account_currency($1)), account_currency($1), COALESCE(t.d, CURRENT_DATE))::float8 AS k
       FROM unnest($2::numeric[], $3::text[], $4::date[]) WITH ORDINALITY AS t(b, c, d, i)`,
    [uid, amounts, currencies, days],
  );
  const currency = (await db.get<{ w: string }>('SELECT account_currency($1) AS w', [uid]))?.w ?? 'EUR';
  const from: (number | null)[] = amounts.map(() => null);
  for (const z of rows) from[Number(z.i) - 1] = z.k == null ? null : Number(z.k);
  return { currency, amounts: from };
}
