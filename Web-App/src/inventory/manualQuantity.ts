/** Relative (`quantity_delta`) for devices that collect offline: two
 * concurrent "+1" yield +2, an absolute quantity from an old state
 * would overwrite the other access. */
import { inventoryKey } from '../../db/txLock';
import { inventoryQuantity } from '../infra/validate';
import { fachfehler } from '../infra/errorTexts';
import { Degradations } from '../infra/result';
import { addPurchaseAtTag } from './acquisitions';
import * as repo from './repository/manualQuantities';
import type { ManualKind } from './repository/manualQuantities';
import type { InventoryContext } from './context';

/** A manual entry only disappears via deletion, never via the quantity. */
const AT_LEAST = 1;

export type Mengenwunsch = { absolut: number } | { delta: number };

/** quantity_delta wins if both come. */
export function mengenwunsch(body: { quantity?: unknown; quantity_delta?: unknown }): Mengenwunsch | null {
  if (body.quantity_delta !== undefined && body.quantity_delta !== null) {
    const delta = Number(body.quantity_delta);
    if (!Number.isInteger(delta) || Math.abs(delta) > 9999) fachfehler('ungueltig', 'wert_ungueltig');
    return { delta };
  }
  if (body.quantity !== undefined) return { absolut: inventoryQuantity(body.quantity, AT_LEAST) };
  return null;
}

const ziel = (w: Mengenwunsch, bisher: number) => ('absolut' in w ? w.absolut : Math.max(AT_LEAST, bisher + w.delta));

/** Computed within the inventory lock so that web and app do not overtake each other.
 * @param marktpreis is asked BEFORE the lock and only for an increasing quantity
 * @returns the quantity afterwards */
export async function passeManualQuantityAn(
  k: InventoryContext,
  art: ManualKind,
  uid: number,
  schluessel: (string | number)[],
  wish: Mengenwunsch,
  zustand: string,
  marktpreis: () => Promise<number | null>,
  ab = new Degradations(),
): Promise<number> {
  const upfront = await k.manuelleMengen.sumTheEntries(art, uid, schluessel);
  const mp = ziel(wish, upfront) > upfront ? await ab.oder('kaufpreis', marktpreis, null) : null;
  const sperren = [{ konto: uid, schluessel: inventoryKey(art, schluessel) }];
  return k.transaktion(
    async t => {
      const erfassungen = await repo.entriesNewestFirst(t.db, art, uid, schluessel);
      const bisher = erfassungen.reduce((s, r) => s + r.quantity, 0);
      const soll = ziel(wish, bisher);
      if (soll > bisher) {
        await addPurchaseAtTag(t, art, uid, schluessel, {
          quantity: soll - bisher,
          price: mp,
          condition: zustand,
          geschaetzt: true,
        });
      }
      let rest = bisher - soll;
      for (const a of erfassungen) {
        if (rest <= 0) break;
        const weg = Math.min(a.quantity, rest);
        if (weg >= a.quantity) await repo.removeEntry(t.db, art, a.id, [uid]);
        else await repo.shortenEntry(t.db, art, a.id, weg, [uid]);
        rest -= weg;
      }
      return soll;
    },
    { sperren },
  );
}
