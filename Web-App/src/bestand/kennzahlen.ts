import { asIds, type Sicht } from '../haushalt';
import type { InventoryContext } from './kontext';

/** Spannen über alle drei Domänen und gehören deshalb in keine davon. */
export async function getStats(k: InventoryContext, userIdChoice: Sicht | number | number[]) {
  const userId = await k.haushalt.scopeFrom(userIdChoice);
  // asIds(), damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  const [setsRow, instrRow, partsRow, minifigsRow, cur, singleRow] = await Promise.all([
    // COUNT(DISTINCT set_number): Im Haushalt besitzen mehrere Konten dasselbe Set.
    k.kennzahlen.setNumbers(uids),
    k.kennzahlen.instructionNumbers(uids, uids),
    // `fehlt = 1` in einer Multiplikation: Ein manuelles Teil ohne Set zählt einfach.
    k.kennzahlen.partsInInventory(uids),
    k.kennzahlen.minifigsInInventory(uids),
    k.einstellungen.valueInView(uids, 'currency').then(value => (value === null ? undefined : { value })),
    k.kennzahlen.partsSingle(uids),
  ]);
  const ownState = await k.einstellungen.valueInView(uids, 'user_default_condition');
  const globalCond = await k.einstellungen.globalValue('default_price_condition');
  const effectiveCondition = ownState && ['N', 'U'].includes(ownState) ? ownState : globalCond || 'N';
  const pieces = Number(partsRow?.t ?? 0);
  const einzeln = Number(singleRow?.t ?? 0);
  return {
    total_sets: Number(setsRow?.total_sets ?? 0),
    total_quantity: Number(setsRow?.total_quantity ?? 0),
    total_pieces: pieces,
    total_parts: pieces,
    // Dieselbe Zahl zeigt der Teile-Reiter; die Aufschlüsselung macht sie nachvollziehbar.
    set_parts: pieces - einzeln,
    manual_parts: einzeln,
    total_minifigs: Number(minifigsRow?.t ?? 0),
    total_instructions: Number(instrRow?.total_instructions ?? 0),
    currency: cur?.value || 'EUR',
    user_default_condition: ownState || null,
    default_condition: effectiveCondition,
  };
}
