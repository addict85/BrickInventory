import { mengeAus, mengeJoin, teilmengeAus, teilmengeJoin } from '../../../db/bestandsmenge';
import * as db from '../../../db/database';

/** Die Zahlen der Startseite über das Blickfeld (uids). */

export function setZahlen(uids: number[]) {
  return db.get(`SELECT COUNT(DISTINCT s.set_number) AS total_sets,
                   COALESCE(SUM(${mengeAus()}), 0) AS total_quantity
              FROM sets s
              ${mengeJoin('s', 'sm', '= ANY($1)')}
             WHERE s.user_id = ANY($1)`, [uids]);
}

export function anleitungsZahlen(uids: number[], eigene: number[]) {
  return db.get(`
      SELECT
        (SELECT COUNT(*) FROM shared_instructions si
           JOIN sets s ON s.set_number = si.set_number AND s.user_id = ANY($1)) +
        (SELECT COUNT(*) FROM instructions WHERE user_id = ANY($2)) AS total_instructions`, [uids, eigene]);
}

export function teileImBestand(uids: number[]) {
  return db.get(`SELECT SUM(${teilmengeAus('p', 'part')}*${mengeAus('sm', 1)}) AS t
              FROM parts p ${mengeJoin('p', 'sm', '= ANY($1)')} ${teilmengeJoin('p', 'part')}
             WHERE p.user_id = ANY($1)`, [uids]);
}

export function figurenImBestand(uids: number[]) {
  return db.get(`SELECT SUM(${teilmengeAus('m', 'fig')}*${mengeAus('sm', 1)}) AS t
              FROM minifigs m ${mengeJoin('m', 'sm', '= ANY($1)')} ${teilmengeJoin('m', 'fig')}
             WHERE m.user_id = ANY($1)`, [uids]);
}

export function waehrungImBlickfeld(uids: number[]) {
  return db.get("SELECT value FROM user_settings WHERE user_id = ANY($1) AND key = 'currency'", [uids]);
}

export function vorgabeZustandImBlickfeld(uids: number[]) {
  return db.get("SELECT value FROM user_settings WHERE user_id = ANY($1) AND key='user_default_condition'", [uids]);
}
