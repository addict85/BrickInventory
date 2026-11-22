import type { DbInterface } from '../../../db/database';

/** The piece count of a manual entry is the sum of its acquisitions. */
export type ManualKind = 'part' | 'fig';
const ERF = { part: 'part_acquisitions', fig: 'minifig_acquisitions' } as const;
const KEYS = { part: 'part_number=$2 AND color_id=$3', fig: 'fig_number=$2' } as const;

export async function sumTheEntries(
  db: DbInterface,
  kind: ManualKind,
  uid: number,
  key: (string | number)[],
): Promise<number> {
  const r = await db.get<{ q: number }>(
    `SELECT COALESCE(SUM(quantity), 0)::int AS q FROM ${ERF[kind]} WHERE user_id=$1 AND ${KEYS[kind]}`,
    [uid, ...key],
  );
  return Number(r?.q ?? 0);
}

/** Newest first: when reducing, the most recently captured goes first. */
export function entriesNewestFirst(tx: DbInterface, kind: ManualKind, uid: number, key: (string | number)[]) {
  return tx.all<{ id: number; quantity: number }>(
    `SELECT id, quantity FROM ${ERF[kind]} WHERE user_id=$1 AND ${KEYS[kind]} ORDER BY created_at DESC, id DESC`,
    [uid, ...key],
  );
}

export async function removeEntry(tx: DbInterface, kind: ManualKind, id: number, accounts: number[]): Promise<void> {
  await tx.run(`DELETE FROM ${ERF[kind]} WHERE id=$1 AND user_id = ANY($2)`, [id, accounts]);
}

export async function shortenEntry(
  tx: DbInterface,
  kind: ManualKind,
  id: number,
  around: number,
  accounts: number[],
): Promise<void> {
  await tx.run(`UPDATE ${ERF[kind]} SET quantity=quantity-$1 WHERE id=$2 AND user_id = ANY($3)`, [
    around,
    id,
    accounts,
  ]);
}
