import { fachfehler } from '../infra/fehlerTexte';
import { addPurchaseAtTag } from './acquisitions';
import { putRowAn } from './inhalt';
import * as mengen from './repository/manuelleMengen';
import * as repo from './repository/umhaengen';
import type { InventoryContext } from './kontext';

/** Über den KAUFPREIS, nicht über den Eintrag; was beim Absender bleibt, folgt
 * aus seinen Erfassungen. */
export async function manualEntryReassign(
  t: InventoryContext,
  kind: 'part' | 'fig',
  keyValues: (string | number)[],
  acquisitionId: number,
  fromId: number,
  toId: number,
): Promise<{ quantity: number; merged: boolean; source_emptied: boolean }> {
  const acq = await repo.manualEntry(t.db, kind, acquisitionId, fromId, keyValues);
  if (!acq) fachfehler('nicht_gefunden', 'kaufpreis_nicht_gefunden');

  const src = await repo.manualRow(t.db, kind, fromId, keyValues);
  if (!src) fachfehler('nicht_gefunden', 'nicht_gefunden');

  const movingQty = Math.max(1, parseInt(String(acq.quantity), 10) || 1);
  const remaining = Math.max(0, (await mengen.sumTheEntries(t.db, kind, fromId, keyValues)) - movingQty);

  const dst = await repo.manualRow(t.db, kind, toId, keyValues);
  if (!dst) await putRowAn(t, kind, toId, keyValues);

  await addPurchaseAtTag(t, kind, toId, keyValues, {
    quantity: movingQty,
    price: acq.unit_price,
    condition: acq.condition,
    createdAt: acq.created_at,
    geschaetzt: acq.price_estimated,
    currency: acq.currency,
  });
  await mengen.removeEntry(t.db, kind, acq.id, [fromId]);

  if (remaining > 0) return { quantity: movingQty, merged: !!dst, source_emptied: false };
  await repo.removeManual(t.db, kind, fromId, keyValues, src.id);
  return { quantity: movingQty, merged: !!dst, source_emptied: true };
}
