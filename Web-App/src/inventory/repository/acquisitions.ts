import type { DbInterface } from '../../../db/database';
import { acquisitionDaySql, ENTRY_TABLES as SHAPES, type AcquisitionKind } from '../../../db/stockQuantity';

export type EntryInField = {
  id: number;
  user_id: number;
  condition: string | null;
  price: number | null;
  price_estimated: boolean;
  currency: string;
  tag: string;
};

/** Only in the write scope and only under the key from the path: otherwise
 * `/parts/A/1/acquisitions/{acquisition of B}` would change B's row while lock and
 * quantity check ran on A. */
export function entryInWriteField(
  tx: DbInterface,
  kind: AcquisitionKind,
  id: number,
  wids: number[],
  key: (string | number)[],
) {
  const s = SHAPES[kind];
  const columns = s.keys.map((k, i) => ` AND ${k}=$${i + 3}`).join('');
  return tx.get<EntryInField>(
    `SELECT id, user_id, condition, ${s.price} AS price, price_estimated, currency, (${acquisitionDaySql()})::text AS tag
       FROM ${s.table} WHERE id=$1 AND user_id = ANY($2)${columns}`,
    [id, wids, ...key.slice(0, s.keys.length)],
  );
}

/** Writing only in the passed accounts: a second line behind the caller's check. */
export async function setEntryQuantity(
  tx: DbInterface,
  kind: AcquisitionKind,
  id: number,
  quantity: number,
  accounts: number[],
): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[kind].table} SET quantity=$1 WHERE id=$2 AND user_id = ANY($3)`, [
    quantity,
    id,
    accounts,
  ]);
}

export async function setEntryPrice(
  tx: DbInterface,
  kind: AcquisitionKind,
  id: number,
  price: number | null,
  estimated: boolean,
  accounts: number[],
): Promise<void> {
  await tx.run(
    `UPDATE ${SHAPES[kind].table} SET ${SHAPES[kind].price}=$1, price_estimated=$2 WHERE id=$3 AND user_id = ANY($4)`,
    [price, estimated, id, accounts],
  );
}

export async function setEntryState(
  tx: DbInterface,
  kind: AcquisitionKind,
  id: number,
  condition: string,
  accounts: number[],
): Promise<void> {
  await tx.run(`UPDATE ${SHAPES[kind].table} SET condition=$1 WHERE id=$2 AND user_id = ANY($3)`, [
    condition,
    id,
    accounts,
  ]);
}

/** Noon instead of midnight: the day stays the same in whatever time zone it is read. */
export async function setEntryDate(
  tx: DbInterface,
  kind: AcquisitionKind,
  id: number,
  date: string,
  accounts: number[],
): Promise<void> {
  await tx.run(
    `UPDATE ${SHAPES[kind].table} SET created_at=$1::date + interval '12 hours', day=$1::date
                 WHERE id=$2 AND user_id = ANY($3)`,
    [date, id, accounts],
  );
}

export async function deleteEntry(tx: DbInterface, kind: AcquisitionKind, id: number, owner: number): Promise<void> {
  await tx.run(`DELETE FROM ${SHAPES[kind].table} WHERE id=$1 AND user_id=$2`, [id, owner]);
}
