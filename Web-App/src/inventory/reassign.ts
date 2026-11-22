import { failDomain } from '../infra/errorTexts';
import { addPurchaseAtTag } from './acquisitions';
import { createRow } from './content';
import * as quantities from './repository/manualQuantities';
import * as repo from './repository/reassign';
import type { InventoryContext } from './context';

/** Via the PURCHASE PRICE, not via the entry; what stays with the sender follows
 * from its acquisitions. */
export async function manualEntryReassign(
  t: InventoryContext,
  kind: 'part' | 'fig',
  keyValues: (string | number)[],
  acquisitionId: number,
  fromId: number,
  toId: number,
): Promise<{ quantity: number; merged: boolean; source_emptied: boolean }> {
  const acq = await repo.manualEntry(t.db, kind, acquisitionId, fromId, keyValues);
  if (!acq) failDomain('nicht_gefunden', 'kaufpreis_nicht_gefunden');

  const src = await repo.manualRow(t.db, kind, fromId, keyValues);
  if (!src) failDomain('nicht_gefunden', 'nicht_gefunden');

  const movingQty = Math.max(1, parseInt(String(acq.quantity), 10) || 1);
  const remaining = Math.max(0, (await quantities.sumTheEntries(t.db, kind, fromId, keyValues)) - movingQty);

  const dst = await repo.manualRow(t.db, kind, toId, keyValues);
  if (!dst) await createRow(t, kind, toId, keyValues);

  await addPurchaseAtTag(t, kind, toId, keyValues, {
    quantity: movingQty,
    price: acq.unit_price,
    condition: acq.condition,
    createdAt: acq.created_at,
    geschaetzt: acq.price_estimated,
    currency: acq.currency,
  });
  await quantities.removeEntry(t.db, kind, acq.id, [fromId]);

  if (remaining > 0) return { quantity: movingQty, merged: !!dst, source_emptied: false };
  await repo.removeManual(t.db, kind, fromId, keyValues, src.id);
  return { quantity: movingQty, merged: !!dst, source_emptied: true };
}
