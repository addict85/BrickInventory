/** Erfassungen ohne Kaufpreis — für den Nachtrag mit dem Marktpreis. */
import * as db from '../../../db/database';

export async function setErfassungenOhnePreis(): Promise<{ id: number; user_id: number; set_number: string; condition: string | null }[]> {
  return db.all('SELECT id, user_id, set_number, condition FROM set_acquisitions WHERE purchase_price IS NULL ORDER BY id ASC');
}

export async function teilErfassungenOhnePreis(): Promise<{ id: number; user_id: number; part_number: string; color_id: number; condition: string | null }[]> {
  return db.all('SELECT id, user_id, part_number, color_id, condition FROM part_acquisitions WHERE unit_price IS NULL ORDER BY id ASC');
}

export async function figurErfassungenOhnePreis(): Promise<{ id: number; user_id: number; fig_number: string; condition: string | null }[]> {
  return db.all('SELECT id, user_id, fig_number, condition FROM minifig_acquisitions WHERE unit_price IS NULL ORDER BY id ASC');
}
