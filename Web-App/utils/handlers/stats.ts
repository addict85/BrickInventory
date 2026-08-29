import * as db from '../../db/database';
import { resolveImageLocal } from '../images';
import { asIds } from '../household';
import { ensureFresh } from '../partsSummary';
import { fetchMissingBlIds } from '../../routes/parts';
import { getAllSetParts, getRbKey, httpsGetRobust } from '../../clients/rebrickable';
import { clampPageSize, conditionFromAcquisitions, conditionsFromAcquisitions, applyManualCondition, withOwners, MAX_PAGE_SIZE, UNPAGED_LIMIT, SET_PARTS_MAX_PAGE_SIZE } from './shared';

/**
 * Die Kennzahlen der Übersichtsseite — spannen über alle drei Domänen und
 * gehören deshalb in keine davon.
 *
 * ── Warum aufgeteilt (Nachtrag 133) ────────────────────────────────────────
 * utils/handlers.ts fasste Sets, Teile und Minifiguren in 1313 Zeilen zusammen
 * — benannt nach seiner Rolle („handlers"), nicht nach seinem Inhalt, wie
 * zuvor schon js/07-admin.js. Die drei Domänen berühren sich kaum: Nur
 * getSets() liest Teile, und die Minifiguren-Kennzahlen lesen Sets. Beides
 * geht in EINE Richtung, es entsteht also kein Kreis.
 */

async function getStats(userId: number | number[]) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  const [setsRow, instrRow, partsRow, minifigsRow, cur] = await Promise.all([
    db.get(`SELECT COUNT(*) AS total_sets, COALESCE(SUM(quantity), 0) AS total_quantity FROM sets WHERE user_id = ANY($1)`, [uids]),
    db.get(`
      SELECT
        (SELECT COUNT(*) FROM shared_instructions si
           JOIN sets s ON s.set_number = si.set_number AND s.user_id = ANY($1)) +
        (SELECT COUNT(*) FROM instructions WHERE user_id = ANY($2)) AS total_instructions`,
      [uids, userId]),
    db.get(`SELECT SUM(p.quantity*COALESCE(s.quantity,1)) AS t FROM parts p LEFT JOIN sets s ON s.user_id=p.user_id AND s.set_number=p.set_number WHERE p.user_id = ANY($1)`, [uids]),
    db.get(`SELECT SUM(m.quantity*COALESCE(s.quantity,1)) AS t FROM minifigs m LEFT JOIN sets s ON s.user_id=m.user_id AND s.set_number=m.set_number WHERE m.user_id = ANY($1)`, [uids]),
    db.get("SELECT value FROM user_settings WHERE user_id = ANY($1) AND key = 'currency'", [uids]),
  ]);
  const userCondRow = await db.get("SELECT value FROM user_settings WHERE user_id = ANY($1) AND key='user_default_condition'", [uids]).catch(() => null);
  const globalCondRow = await db.get("SELECT value FROM global_settings WHERE key='default_price_condition'").catch(() => null);
  const effectiveCondition = (userCondRow?.value && ['N','U'].includes(userCondRow.value))
    ? userCondRow.value : (globalCondRow?.value || 'N');
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
