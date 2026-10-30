import { meldeUndLiefere } from '../httpError';
import * as db from '../../db/database';
import { asIds } from '../household';
import { getGlobalSetting } from '../settings';
import { mengeJoin, mengeAus, teilmengeJoin, teilmengeAus } from '../bestandsmenge';

/**
 * Die Kennzahlen der Übersichtsseite — spannen über alle drei Domänen und
 * gehören deshalb in keine davon.
 * Ausführlich: docs/begruendungen/utils/handlers/stats.ts.md#getstats
 */

async function getStats(userId: number | number[]) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  const [setsRow, instrRow, partsRow, minifigsRow, cur] = await Promise.all([
    // COUNT(DISTINCT set_number), nicht COUNT(*).
    // Ausführlich: docs/begruendungen/utils/handlers/stats.ts.md#getstats-2
    db.get(`SELECT COUNT(DISTINCT s.set_number) AS total_sets,
                   COALESCE(SUM(${mengeAus()}), 0) AS total_quantity
              FROM sets s
              ${mengeJoin('s', 'sm', '= ANY($1)')}
             WHERE s.user_id = ANY($1)`, [uids]),
    db.get(`
      SELECT
        (SELECT COUNT(*) FROM shared_instructions si
           JOIN sets s ON s.set_number = si.set_number AND s.user_id = ANY($1)) +
        (SELECT COUNT(*) FROM instructions WHERE user_id = ANY($2)) AS total_instructions`,
      [uids, userId]),
    // Der Faktor ist die Set-Menge aus den Erfassungen. `fehlt = 1`, weil er
    // in einer MULTIPLIKATION steht: Ein Teil ohne Set-Zeile (manuell
    // erfasst) zaehlt einfach, nicht null — dieselbe Lesart wie das
    // frueherere COALESCE(s.quantity, 1).
    db.get(`SELECT SUM(${teilmengeAus('p', 'part')}*${mengeAus('sm', 1)}) AS t
              FROM parts p ${mengeJoin('p', 'sm', '= ANY($1)')} ${teilmengeJoin('p', 'part')}
             WHERE p.user_id = ANY($1)`, [uids]),
    db.get(`SELECT SUM(${teilmengeAus('m', 'fig')}*${mengeAus('sm', 1)}) AS t
              FROM minifigs m ${mengeJoin('m', 'sm', '= ANY($1)')} ${teilmengeJoin('m', 'fig')}
             WHERE m.user_id = ANY($1)`, [uids]),
    db.get("SELECT value FROM user_settings WHERE user_id = ANY($1) AND key = 'currency'", [uids]),
  ]);
  const userCondRow = await db.get("SELECT value FROM user_settings WHERE user_id = ANY($1) AND key='user_default_condition'", [uids]).catch(meldeUndLiefere('statistik:ANY', null));
  const globalCond = await getGlobalSetting('default_price_condition');
  const effectiveCondition = (userCondRow?.value && ['N','U'].includes(userCondRow.value))
    ? userCondRow.value : (globalCond || 'N');
  const pieces = parseInt(partsRow?.t || 0);
  return {
    total_sets:          parseInt(setsRow?.total_sets || 0),
    total_quantity:      parseInt(setsRow?.total_quantity || 0),
    total_pieces:        pieces,
    total_parts:         pieces,
    total_minifigs:      parseInt(minifigsRow?.t || 0),
    total_instructions:  parseInt(instrRow?.total_instructions || 0),
    currency:            cur?.value || 'EUR',
    user_default_condition: userCondRow?.value || null,
    default_condition:   effectiveCondition,
  };
}

export { getStats };
