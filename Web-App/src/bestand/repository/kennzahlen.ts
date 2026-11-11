import { mengeAus, mengeJoin, teilmengeAus, teilmengeJoin } from '../../../db/bestandsmenge';
import type { DbSchnittstelle } from '../../../db/database';

export function setZahlen(db: DbSchnittstelle, uids: number[]) {
  return db.get<{ total_sets: string; total_quantity: string }>(`SELECT COUNT(DISTINCT s.set_number) AS total_sets,
                   COALESCE(SUM(${mengeAus()}), 0) AS total_quantity
              FROM sets s
              ${mengeJoin('s', 'sm', '= ANY($1)')}
             WHERE s.user_id = ANY($1)`, [uids]);
}

export function anleitungsZahlen(db: DbSchnittstelle, uids: number[], eigene: number[]) {
  return db.get<{ total_instructions: string }>(`
      SELECT
        (SELECT COUNT(*) FROM shared_instructions si
           JOIN sets s ON s.set_number = si.set_number AND s.user_id = ANY($1)) +
        (SELECT COUNT(*) FROM instructions WHERE user_id = ANY($2)) AS total_instructions`, [uids, eigene]);
}

export function teileImBestand(db: DbSchnittstelle, uids: number[]) {
  return db.get<{ t: string | null }>(`SELECT SUM(${teilmengeAus('p', 'part')}*${mengeAus('sm', 1)}) AS t
              FROM parts p ${mengeJoin('p', 'sm', '= ANY($1)')} ${teilmengeJoin('p', 'part')}
             WHERE p.user_id = ANY($1)`, [uids]);
}

/** Nur die einzeln erfassten Teile, für die Aufschlüsselung „aus Sets · einzeln“. */
export function teileEinzeln(db: DbSchnittstelle, uids: number[]) {
  return db.get<{ t: string | null }>(`SELECT SUM(${teilmengeAus('p', 'part')}*${mengeAus('sm', 1)}) AS t
              FROM parts p ${mengeJoin('p', 'sm', '= ANY($1)')} ${teilmengeJoin('p', 'part')}
             WHERE p.user_id = ANY($1) AND p.source = 'manual'`, [uids]);
}

export function figurenImBestand(db: DbSchnittstelle, uids: number[]) {
  return db.get<{ t: string | null }>(`SELECT SUM(${teilmengeAus('m', 'fig')}*${mengeAus('sm', 1)}) AS t
              FROM minifigs m ${mengeJoin('m', 'sm', '= ANY($1)')} ${teilmengeJoin('m', 'fig')}
             WHERE m.user_id = ANY($1)`, [uids]);
}

export function waehrungImBlickfeld(db: DbSchnittstelle, uids: number[]) {
  return db.get<{ value: string }>("SELECT value FROM user_settings WHERE user_id = ANY($1) AND key = 'currency'", [uids]);
}

export function vorgabeZustandImBlickfeld(db: DbSchnittstelle, uids: number[]) {
  return db.get<{ value: string }>("SELECT value FROM user_settings WHERE user_id = ANY($1) AND key='user_default_condition'", [uids]);
}
