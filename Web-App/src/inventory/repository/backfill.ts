import type { DbInterface } from '../../../db/database';
import type { InventoryReadContract } from '../readContract';
import type { Columns } from '../../../db/rows';

export async function setEntriesWithoutPrice(
  db: DbInterface,
  l: InventoryReadContract,
): Promise<{ id: number; user_id: number; set_number: string; condition: string | null }[]> {
  return db.all<Columns<'set_acquisitions', 'id' | 'user_id' | 'set_number' | 'condition'>>(
    `SELECT id, user_id, set_number, condition FROM ${l.setAcquisitions()} e WHERE purchase_price IS NULL ORDER BY id ASC`,
  );
}

export async function partEntriesWithoutPrice(
  db: DbInterface,
  l: InventoryReadContract,
): Promise<{ id: number; user_id: number; part_number: string; color_id: number; condition: string | null }[]> {
  return db.all<Columns<'part_acquisitions', 'id' | 'user_id' | 'part_number' | 'color_id' | 'condition'>>(
    `SELECT id, user_id, part_number, color_id, condition FROM ${l.partAcquisitions()} e WHERE unit_price IS NULL ORDER BY id ASC`,
  );
}

export async function minifigEntriesWithoutPrice(
  db: DbInterface,
  l: InventoryReadContract,
): Promise<{ id: number; user_id: number; fig_number: string; condition: string | null }[]> {
  return db.all<Columns<'minifig_acquisitions', 'id' | 'user_id' | 'fig_number' | 'condition'>>(
    `SELECT id, user_id, fig_number, condition FROM ${l.figAcquisitions()} e WHERE unit_price IS NULL ORDER BY id ASC`,
  );
}
