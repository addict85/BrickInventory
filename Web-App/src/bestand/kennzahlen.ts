import { meldeUndLiefere } from '../infra/httpError';
import { asIds } from '../haushalt/haushalt';
import { getGlobalSetting } from '../konto/settings';
import * as repo from './repository/kennzahlen';

/**
 * Die Kennzahlen der Übersichtsseite — spannen über alle drei Domänen und
 * gehören deshalb in keine davon.
 * Ausführlich: docs/begruendungen/src/bestand/kennzahlen.ts.md#getstats
 */
export async function getStats(userId: number | number[]) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in src/haushalt/haushalt.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  const [setsRow, instrRow, partsRow, minifigsRow, cur] = await Promise.all([
    // COUNT(DISTINCT set_number), nicht COUNT(*).
    // Ausführlich: docs/begruendungen/src/bestand/kennzahlen.ts.md#getstats-2
    repo.setZahlen(uids),
    repo.anleitungsZahlen(uids, uids),
    // Der Faktor ist die Set-Menge aus den Erfassungen. `fehlt = 1`, weil er
    // in einer MULTIPLIKATION steht: Ein Teil ohne Set-Zeile (manuell
    // erfasst) zaehlt einfach, nicht null — dieselbe Lesart wie das
    // frueherere COALESCE(s.quantity, 1).
    repo.teileImBestand(uids),
    repo.figurenImBestand(uids),
    repo.waehrungImBlickfeld(uids),
  ]);
  const userCondRow = await repo.vorgabeZustandImBlickfeld(uids).catch(meldeUndLiefere('statistik:ANY', null));
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

