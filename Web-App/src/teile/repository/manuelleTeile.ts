import * as db from '../../../db/database';

/** Preis und Zustand stehen in der NEUESTEN Erfassung, die Stückzahl ist die
 * Summe der Erfassungen — die Bestandszeile trägt nur den Schlüssel. */

export function teilZeileManuell(uid: number, partNumber: string, colorId: number): Promise<{ id: number } | undefined> {
  return db.get("SELECT id FROM parts WHERE user_id=$1 AND part_number=$2 AND color_id=$3 AND source='manual'",
    [uid, partNumber, colorId]);
}

export function teilZeileMitZustand(uid: number, partNumber: string, colorId: number) {
  return db.get<{ id: number; condition: string | null }>(
    `SELECT p.id,
            (SELECT a.condition FROM part_acquisitions a
              WHERE a.user_id = p.user_id AND a.part_number = p.part_number
                AND a.color_id = p.color_id
              ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS condition
       FROM parts p
      WHERE p.user_id=$1 AND p.part_number=$2 AND p.color_id=$3 AND p.source='manual'`,
    [uid, partNumber, colorId]);
}

/** Ohne Menge: Sie entsteht aus der ersten Erfassung. */
export async function legeTeilManuellAn(uid: number, partNumber: string, colorId: number): Promise<void> {
  await db.run(`INSERT INTO parts (user_id, set_number, part_number, color_id, source)
                VALUES ($1, NULL, $2, $3, 'manual') ON CONFLICT DO NOTHING`, [uid, partNumber, colorId]);
}

export async function rbFarbcode(colorId: number): Promise<string | null> {
  return (await db.get<{ rgb: string | null }>('SELECT rgb FROM rb_colors WHERE id=$1', [colorId]))?.rgb || null;
}

const NEUESTE = `(SELECT a.id FROM part_acquisitions a
                   WHERE a.user_id=$2 AND a.part_number=$3 AND a.color_id = $4
                   ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`;

/** 0 heisst in der Erfassung „für nichts gekauft"; ohne Preis steht NULL. */
export async function setzeTeilpreisNeueste(uid: number, partNumber: string, colorId: number, preis: number | null): Promise<void> {
  await db.run(`UPDATE part_acquisitions SET unit_price = NULLIF($1::numeric, 0) WHERE id = ${NEUESTE}`,
    [preis, uid, partNumber, colorId]);
}

export async function setzeTeilzustandNeueste(uid: number, partNumber: string, colorId: number, zustand: string): Promise<void> {
  await db.run(`UPDATE part_acquisitions SET condition=$1 WHERE id = ${NEUESTE}`, [zustand, uid, partNumber, colorId]);
}

export function teilErfassungen(uids: number[], partNumber: string, colorId: number) {
  return db.all(
    `SELECT a.id, a.quantity, a.unit_price,
            COALESCE(a.condition, 'N') AS condition, a.price_estimated, a.currency,
            a.created_at, a.user_id AS owner_user_id
     FROM part_acquisitions a
     WHERE a.user_id = ANY($1) AND a.part_number=$2 AND a.color_id=$3
     ORDER BY a.created_at ASC, a.id ASC`, [uids, partNumber, colorId]);
}
