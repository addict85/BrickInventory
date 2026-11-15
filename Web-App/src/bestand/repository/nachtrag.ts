import type { DbSchnittstelle } from '../../../db/database';
import { figurErfassungen, setErfassungen, teilErfassungen } from '../../../db/bestandSicht';
import type { Spalten } from '../../../db/zeilen';

export async function setErfassungenOhnePreis(
  db: DbSchnittstelle,
): Promise<{ id: number; user_id: number; set_number: string; condition: string | null }[]> {
  return db.all<Spalten<'set_acquisitions', 'id' | 'user_id' | 'set_number' | 'condition'>>(
    `SELECT id, user_id, set_number, condition FROM ${setErfassungen()} e WHERE purchase_price IS NULL ORDER BY id ASC`,
  );
}

export async function teilErfassungenOhnePreis(
  db: DbSchnittstelle,
): Promise<{ id: number; user_id: number; part_number: string; color_id: number; condition: string | null }[]> {
  return db.all<Spalten<'part_acquisitions', 'id' | 'user_id' | 'part_number' | 'color_id' | 'condition'>>(
    `SELECT id, user_id, part_number, color_id, condition FROM ${teilErfassungen()} e WHERE unit_price IS NULL ORDER BY id ASC`,
  );
}

export async function figurErfassungenOhnePreis(
  db: DbSchnittstelle,
): Promise<{ id: number; user_id: number; fig_number: string; condition: string | null }[]> {
  return db.all<Spalten<'minifig_acquisitions', 'id' | 'user_id' | 'fig_number' | 'condition'>>(
    `SELECT id, user_id, fig_number, condition FROM ${figurErfassungen()} e WHERE unit_price IS NULL ORDER BY id ASC`,
  );
}
