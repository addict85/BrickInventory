import type { DbSchnittstelle } from '../../../db/database';
import * as db from '../../../db/database';

/** Datenzugriff zum Löschen von Bestand. */

export function loescheTeilErfassungen(tx: DbSchnittstelle, besitzer: number, partNumber: string, colorId: number) {
  return tx.run('DELETE FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3', [besitzer, partNumber, colorId]);
}

export function loescheFigurErfassungen(tx: DbSchnittstelle, besitzer: number, figNumber: string) {
  return tx.run('DELETE FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2', [besitzer, figNumber]);
}

export function setsDesKontos(uid: number) {
  return db.all('SELECT set_number FROM sets WHERE user_id = $1', [uid]);
}

export function manuelleTeileDesKontos(uid: number) {
  return db.all("SELECT part_number, color_id FROM parts WHERE user_id = $1 AND source = 'manual'", [uid]);
}

export function manuelleFigurenDesKontos(uid: number) {
  return db.all("SELECT fig_number FROM minifigs WHERE user_id = $1 AND source = 'manual'", [uid]);
}
