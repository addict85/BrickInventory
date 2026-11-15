import { erfassungsTagSql } from '../../../db/bestandsmenge';
import type { DbSchnittstelle } from '../../../db/database';

/** Schreibwege auf die Käufe manueller Teile und Figuren: Die Zeilen gehören dem Bestand
 * (docs/architektur.md), Teile und Figuren rufen sie über t.bestand.kaeufe. Preis und Zustand
 * stehen in der NEUESTEN Erfassung, die Stückzahl ist die Summe der Erfassungen. */

const NEUESTES_TEIL = `(SELECT a.id FROM part_acquisitions a
                   WHERE a.user_id=$2 AND a.part_number=$3 AND a.color_id = $4
                   ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`;

/** 0 heisst in der Erfassung „für nichts gekauft"; ohne Preis steht NULL. */
export async function setzeTeilpreisNeueste(
  db: DbSchnittstelle,
  uid: number,
  partNumber: string,
  colorId: number,
  preis: number | null,
): Promise<void> {
  await db.run(`UPDATE part_acquisitions SET unit_price = NULLIF($1::numeric, 0) WHERE id = ${NEUESTES_TEIL}`, [
    preis,
    uid,
    partNumber,
    colorId,
  ]);
}

export async function setzeTeilzustandNeueste(
  db: DbSchnittstelle,
  uid: number,
  partNumber: string,
  colorId: number,
  zustand: string,
): Promise<void> {
  await db.run(`UPDATE part_acquisitions SET condition=$1 WHERE id = ${NEUESTES_TEIL}`, [
    zustand,
    uid,
    partNumber,
    colorId,
  ]);
}

export function loescheTeilErfassungen(tx: DbSchnittstelle, besitzer: number, partNumber: string, colorId: number) {
  return tx.run('DELETE FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3', [
    besitzer,
    partNumber,
    colorId,
  ]);
}

const NEUESTE_FIGUR = `(SELECT a.id FROM minifig_acquisitions a
                   WHERE a.user_id=$2 AND a.fig_number=$3
                   ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`;

export async function setzeFigurpreisNeueste(
  db: DbSchnittstelle,
  uid: number,
  figNumber: string,
  preis: number | null,
): Promise<void> {
  await db.run(`UPDATE minifig_acquisitions SET unit_price = NULLIF($1::numeric, 0) WHERE id = ${NEUESTE_FIGUR}`, [
    preis,
    uid,
    figNumber,
  ]);
}

export async function setzeFigurzustandNeueste(
  db: DbSchnittstelle,
  uid: number,
  figNumber: string,
  zustand: string,
): Promise<void> {
  await db.run(`UPDATE minifig_acquisitions SET condition=$1 WHERE id = ${NEUESTE_FIGUR}`, [zustand, uid, figNumber]);
}

export function loescheFigurErfassungen(tx: DbSchnittstelle, besitzer: number, figNumber: string) {
  return tx.run('DELETE FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2', [besitzer, figNumber]);
}

/** Umfärben: Käufe, die es in der neuen Farbe am selben Tag gleich schon gibt, gehen darin auf
 * (der eindeutige Index erlaubt keine zweite Zeile); danach fallen die aufgegangenen weg. */
export function stockeGleicheErfassungenAuf(
  tx: DbSchnittstelle,
  uid: number,
  partNumber: string,
  alt: number,
  neu: number,
) {
  return tx.run(
    `UPDATE part_acquisitions z
          SET quantity = z.quantity + a.quantity
         FROM part_acquisitions a
        WHERE a.user_id = $1 AND a.part_number = $2 AND a.color_id = $3
          AND z.user_id = $1 AND z.part_number = $2 AND z.color_id = $4
          AND ${erfassungsTagSql('z')} = ${erfassungsTagSql('a')}
          AND z.condition = a.condition AND z.price_estimated = a.price_estimated
          AND z.currency = a.currency AND COALESCE(z.unit_price, -1) = COALESCE(a.unit_price, -1)`,
    [uid, partNumber, alt, neu],
  );
}

export function loescheAufgestockteErfassungen(
  tx: DbSchnittstelle,
  uid: number,
  partNumber: string,
  alt: number,
  neu: number,
) {
  return tx.run(
    `DELETE FROM part_acquisitions a
        WHERE a.user_id = $1 AND a.part_number = $2 AND a.color_id = $3
          AND EXISTS (SELECT 1 FROM part_acquisitions z
                       WHERE z.user_id = $1 AND z.part_number = $2 AND z.color_id = $4
                         AND ${erfassungsTagSql('z')} = ${erfassungsTagSql('a')}
                         AND z.condition = a.condition AND z.price_estimated = a.price_estimated
                         AND z.currency = a.currency AND COALESCE(z.unit_price, -1) = COALESCE(a.unit_price, -1))`,
    [uid, partNumber, alt, neu],
  );
}

export function faerbeErfassungenUm(tx: DbSchnittstelle, uid: number, partNumber: string, alt: number, neu: number) {
  return tx.run(
    `UPDATE part_acquisitions SET color_id = $4
        WHERE user_id = $1 AND part_number = $2 AND color_id = $3`,
    [uid, partNumber, alt, neu],
  );
}
