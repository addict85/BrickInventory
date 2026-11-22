import type { DbInterface } from '../../../db/database';

export type Art = 'part' | 'fig';
const TAB = { part: 'parts', fig: 'minifigs' } as const;
const ERF = { part: 'part_acquisitions', fig: 'minifig_acquisitions' } as const;
const KEYS = { part: 'part_number = $2 AND color_id = $3', fig: 'fig_number = $2' } as const;

export type ManualEntry = {
  id: number;
  quantity: number;
  unit_price: number | null;
  condition: string;
  created_at: string;
  price_estimated: boolean;
  currency: string;
};

/** Under the request's key: otherwise moving would book the quantity of a foreign
 * position at the target under the request's key. */
export function manualEntry(tx: DbInterface, art: Art, id: number, uid: number, key: (string | number)[]) {
  const condition = art === 'part' ? 'part_number = $3 AND color_id = $4' : 'fig_number = $3';
  return tx.get<ManualEntry>(
    `SELECT id, quantity, unit_price, COALESCE(condition,'N') AS condition, created_at, price_estimated, currency
       FROM ${ERF[art]} WHERE id = $1 AND user_id = $2 AND ${condition}`,
    [id, uid, ...key],
  );
}

export function manualRow(tx: DbInterface, art: Art, uid: number, key: (string | number)[]) {
  return tx.get<{ id: number; part_number?: string; color_id?: number; fig_number?: string }>(
    `SELECT * FROM ${TAB[art]} WHERE user_id = $1 AND ${KEYS[art]} AND COALESCE(source,'set') = 'manual'`,
    [uid, ...key],
  );
}

export async function removeManual(
  tx: DbInterface,
  art: Art,
  uid: number,
  key: (string | number)[],
  row: number,
): Promise<void> {
  await tx.run(`DELETE FROM ${ERF[art]} WHERE user_id = $1 AND ${KEYS[art]}`, [uid, ...key]);
  await tx.run(`DELETE FROM ${TAB[art]} WHERE id = $1 AND user_id = $2`, [row, uid]);
}
