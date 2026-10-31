/** Stammdaten aus den Rebrickable-CSV-Tabellen: Inventare und Farben. */
import * as db from '../../../db/database';

/** Das neueste Inventar zu einer der Schreibweisen, oder null. */
export async function inventarNachKandidaten(kandidaten: string[]): Promise<number | null> {
  const row = await db.get<{ id: number }>(
    'SELECT id FROM rb_inventories WHERE set_num = ANY($1) ORDER BY version DESC LIMIT 1', [kandidaten]);
  return row ? row.id : null;
}

/** Die geladene Farbtabelle (ohne „keine Farbe“ und ohne Namenlose). */
export async function geladeneFarben(): Promise<{ id: number; name: string; hex: string | null }[]> {
  return db.all(
    `SELECT id, name, NULLIF(rgb, '') AS hex FROM rb_colors
      WHERE id >= 0 AND name IS NOT NULL ORDER BY id`);
}
