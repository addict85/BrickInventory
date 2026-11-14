import type { DbSchnittstelle } from '../../../db/database';

export function setsDesKontos(db: DbSchnittstelle, uid: number) {
  return db.all<{ set_number: string }>('SELECT set_number FROM sets WHERE user_id = $1', [uid]);
}

export function manuelleTeileDesKontos(db: DbSchnittstelle, uid: number) {
  return db.all<{ part_number: string; color_id: number }>(
    "SELECT part_number, color_id FROM parts WHERE user_id = $1 AND source = 'manual'",
    [uid],
  );
}

export function manuelleFigurenDesKontos(db: DbSchnittstelle, uid: number) {
  return db.all<{ fig_number: string }>("SELECT fig_number FROM minifigs WHERE user_id = $1 AND source = 'manual'", [
    uid,
  ]);
}
