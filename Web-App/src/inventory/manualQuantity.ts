/** Relative (`quantity_delta`) for devices that collect offline: two
 * concurrent "+1" yield +2, an absolute quantity from an old state
 * would overwrite the other access. */
import { inventoryKey } from '../../db/txLock';
import { inventoryQuantity } from '../infra/validate';
import { failDomain } from '../infra/errorTexts';
import { Degradations } from '../infra/result';
import { addPurchaseAtTag } from './acquisitions';
import * as repo from './repository/manualQuantities';
import type { ManualKind } from './repository/manualQuantities';
import type { InventoryContext } from './context';

/** A manual entry only disappears via deletion, never via the quantity. */
const AT_LEAST = 1;

export type QuantityRequest = { absolute: number } | { delta: number };

/** quantity_delta wins if both come. */
export function quantityRequest(body: { quantity?: unknown; quantity_delta?: unknown }): QuantityRequest | null {
  if (body.quantity_delta !== undefined && body.quantity_delta !== null) {
    const delta = Number(body.quantity_delta);
    if (!Number.isInteger(delta) || Math.abs(delta) > 9999) failDomain('invalid', 'value_invalid');
    return { delta };
  }
  if (body.quantity !== undefined) return { absolute: inventoryQuantity(body.quantity, AT_LEAST) };
  return null;
}

const target = (w: QuantityRequest, previous: number) =>
  'absolute' in w ? w.absolute : Math.max(AT_LEAST, previous + w.delta);

/** Computed within the inventory lock so that web and app do not overtake each other.
 * @param marketPrice is asked BEFORE the lock and only for an increasing quantity
 * @returns the quantity afterwards */
export async function adjustManualQuantity(
  k: InventoryContext,
  kind: ManualKind,
  uid: number,
  key: (string | number)[],
  wish: QuantityRequest,
  condition: string,
  marketPrice: () => Promise<number | null>,
  ab = new Degradations(),
): Promise<number> {
  const upfront = await k.manualQuantities.sumTheEntries(kind, uid, key);
  const mp = target(wish, upfront) > upfront ? await ab.orElse('kaufpreis', marketPrice, null) : null;
  const locks = [{ account: uid, key: inventoryKey(kind, key) }];
  return k.transact(
    async t => {
      const acquisitions = await repo.entriesNewestFirst(t.db, kind, uid, key);
      const previous = acquisitions.reduce((s, r) => s + r.quantity, 0);
      const expected = target(wish, previous);
      if (expected > previous) {
        await addPurchaseAtTag(t, kind, uid, key, {
          quantity: expected - previous,
          price: mp,
          condition: condition,
          estimated: true,
        });
      }
      let rest = previous - expected;
      for (const a of acquisitions) {
        if (rest <= 0) break;
        const route = Math.min(a.quantity, rest);
        if (route >= a.quantity) await repo.removeEntry(t.db, kind, a.id, [uid]);
        else await repo.shortenEntry(t.db, kind, a.id, route, [uid]);
        rest -= route;
      }
      return expected;
    },
    { locks },
  );
}
