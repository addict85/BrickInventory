import { asIds, type Sicht } from '../household';
import type { InventoryContext } from './context';

/** Span all three domains and therefore belong to none of them. */
export async function getStats(k: InventoryContext, userIdChoice: Sicht | number | number[]) {
  const userId = await k.household.scopeFrom(userIdChoice);
  // asIds(), so that older callers with a bare ID keep working.
  const uids = asIds(userId);
  const [setsRow, instrRow, partsRow, minifigsRow, cur, singleRow] = await Promise.all([
    // COUNT(DISTINCT set_number): in the household several accounts own the same set.
    k.kennzahlen.setNumbers(uids),
    k.kennzahlen.instructionNumbers(uids, uids),
    // `fehlt = 1` in a multiplication: a manual part without a set simply counts.
    k.kennzahlen.partsInInventory(uids),
    k.kennzahlen.minifigsInInventory(uids),
    k.einstellungen.valueInView(uids, 'currency').then(value => (value === null ? undefined : { value })),
    k.kennzahlen.partsSingle(uids),
  ]);
  const ownState = await k.einstellungen.valueInView(uids, 'user_default_condition');
  const globalCond = await k.einstellungen.globalValue('default_price_condition');
  const effectiveCondition = ownState && ['N', 'U'].includes(ownState) ? ownState : globalCond || 'N';
  const pieces = Number(partsRow?.t ?? 0);
  const single = Number(singleRow?.t ?? 0);
  return {
    total_sets: Number(setsRow?.total_sets ?? 0),
    total_quantity: Number(setsRow?.total_quantity ?? 0),
    total_pieces: pieces,
    total_parts: pieces,
    // The parts tab shows the same number; the breakdown makes it traceable.
    set_parts: pieces - single,
    manual_parts: single,
    total_minifigs: Number(minifigsRow?.t ?? 0),
    total_instructions: Number(instrRow?.total_instructions ?? 0),
    currency: cur?.value || 'EUR',
    user_default_condition: ownState || null,
    default_condition: effectiveCondition,
  };
}
