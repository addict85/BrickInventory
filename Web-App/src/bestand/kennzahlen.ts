import { meldeUndLiefere } from '../infra/fehler';
import { asIds, blickfeldAus, type Sicht } from '../haushalt/haushalt';
import { getGlobalSetting } from '../einstellungen/settings';
import * as repo from './repository/kennzahlen';

/** Spannen über alle drei Domänen und gehören deshalb in keine davon. */
export async function getStats(userIdWahl: Sicht | number | number[]) {
  const userId = await blickfeldAus(userIdWahl);
  // asIds(), damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  const [setsRow, instrRow, partsRow, minifigsRow, cur, einzelnRow] = await Promise.all([
    // COUNT(DISTINCT set_number): Im Haushalt besitzen mehrere Konten dasselbe Set.
    // Ausführlich: docs/begruendungen/src/bestand/kennzahlen.ts.md#getstats-2
    repo.setZahlen(uids),
    repo.anleitungsZahlen(uids, uids),
    // `fehlt = 1` in einer Multiplikation: Ein manuelles Teil ohne Set zählt einfach.
    repo.teileImBestand(uids),
    repo.figurenImBestand(uids),
    repo.waehrungImBlickfeld(uids),
    repo.teileEinzeln(uids),
  ]);
  const userCondRow = await repo.vorgabeZustandImBlickfeld(uids).catch(meldeUndLiefere('statistik:ANY', null));
  const globalCond = await getGlobalSetting('default_price_condition');
  const effectiveCondition = (userCondRow?.value && ['N','U'].includes(userCondRow.value))
    ? userCondRow.value : (globalCond || 'N');
  const pieces = Number(partsRow?.t ?? 0);
  const einzeln = Number(einzelnRow?.t ?? 0);
  return {
    total_sets:          Number(setsRow?.total_sets ?? 0),
    total_quantity:      Number(setsRow?.total_quantity ?? 0),
    total_pieces:        pieces,
    total_parts:         pieces,
    // Dieselbe Zahl zeigt der Teile-Reiter; die Aufschlüsselung macht sie nachvollziehbar.
    set_parts:           pieces - einzeln,
    manual_parts:        einzeln,
    total_minifigs:      Number(minifigsRow?.t ?? 0),
    total_instructions:  Number(instrRow?.total_instructions ?? 0),
    currency:            cur?.value || 'EUR',
    user_default_condition: userCondRow?.value || null,
    default_condition:   effectiveCondition,
  };
}

