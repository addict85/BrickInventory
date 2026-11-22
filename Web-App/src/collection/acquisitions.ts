/** One rule for three kinds, so the webapp and the app don't drift apart. */
import { moneyInput } from '../infra/geld';
import type { Sicht } from '../household';
import { Degradations } from '../infra/result';
import { inventoryKey } from '../../db/txLock';
import { fachfehler, type ErrorCode } from '../infra/errorTexts';
import { quantityOfSets, quantityThePosition, priceColumn, type ErfassungsArt } from '../../db/stockQuantity';
import { inventoryQuantity, zustand } from '../infra/validate';
import type { CollectionContext } from './context';

export type { ErfassungsArt } from '../../db/stockQuantity';
type Keys = Array<string | number>;

interface Kind {
  notFound: ErrorCode;
  /** In this row's condition, if the price is cleared. */
  resolvePrice: (uid: number, keys: Keys, cond: string | null) => Promise<number | null>;
  /** Inside the transaction: `t` is its context. */
  cleanupWhenEmpty: (t: CollectionContext, ownerId: number, keys: Keys) => Promise<unknown>;
}

const kinds = (k: CollectionContext): Record<ErfassungsArt, Kind> => ({
  set: {
    notFound: 'erfassung_nicht_gefunden',
    resolvePrice: (uid, [sn], cond) => k.finances.aktuellerMarktpreis(String(sn), uid, cond || null),
    // Same as explicit deletion: the set's parts and minifigs would otherwise
    // sit in the parts/minifigs list and finance totals without a set.
    cleanupWhenEmpty: (t, ownerId, [sn]) => t.sets.deleteSetRows([ownerId], String(sn)),
  },
  part: {
    notFound: 'nicht_gefunden',
    resolvePrice: (uid, [pn, cid], cond) => k.finances.currentPartMarketPrice(String(pn), Number(cid), uid, cond),
    // Only the manual holding; set parts go with their set.
    cleanupWhenEmpty: (t, ownerId, keys) => t.inventory.deleteManual('part', ownerId, keys),
  },
  fig: {
    notFound: 'nicht_gefunden',
    resolvePrice: async (uid, [fn], cond) =>
      k.finances.currentMinifigMarketPrice(
        String(fn),
        uid,
        await k.catalog.blFetchNumber('fig', String(fn), uid),
        cond,
      ),
    cleanupWhenEmpty: (t, ownerId, keys) => t.inventory.deleteManual('fig', ownerId, keys),
  },
});

interface Row {
  id: number;
  user_id: number;
  condition: string | null;
  preis: number | null;
  price_estimated: boolean;
  currency: string;
  tag: string;
}

/** Only for the lock key and price fallback; the query inside the transaction checks the rights. */
async function beforehand(k: CollectionContext, art: ErfassungsArt, uid: number, id: number, keys: Keys) {
  return k.inventory.erfassung.imSchreibfeld(art, id, await k.household.schreibbereich(uid), keys);
}

/** 0 "empty" and null "no row" are cleaned up; a read error propagates, a fallback would hide the
 * cause inside the transaction (every command after is lost then, 25P02). */
function holdingQuantity(
  t: CollectionContext,
  art: ErfassungsArt,
  ownerId: number,
  keys: Keys,
): Promise<number | null> {
  return art === 'set' ? quantityOfSets(ownerId, String(keys[0]), t.db) : quantityThePosition(art, ownerId, keys, t.db);
}
const isEmpty = (q: number | null) => q === null || q <= 0;

/** Write scope: a sub-account must not write backwards. */
async function rowInWriteScope(
  t: CollectionContext,
  art: ErfassungsArt,
  wids: number[],
  id: number,
  keys: Keys,
): Promise<Row> {
  const a = kinds(t)[art];
  const z = await t.inventory.erfassung.imSchreibfeld(art, id, wids, keys);
  if (!z) fachfehler('nicht_gefunden', a.notFound);
  return z;
}

async function response(
  k: CollectionContext,
  art: ErfassungsArt,
  uid: number,
  keys: Keys,
  payload: Record<string, unknown>,
) {
  return art === 'set' ? k.sets.withSetAggregate(uid, String(keys[0]), payload) : payload;
}

export interface Change {
  quantity?: unknown;
  condition?: unknown;
  date?: unknown;
  owner_user_id?: unknown;
  [preis: string]: unknown;
}

export async function changeAcquisition(
  k: CollectionContext,
  art: ErfassungsArt,
  uid: number,
  id: number,
  keys: Keys,
  body: Change,
) {
  const a = kinds(k)[art];
  const { quantity, condition, date } = body;
  const rawPrice = body[priceColumn(art)];

  const ownerReq = body.owner_user_id;
  if (ownerReq !== undefined && ownerReq !== null && ownerReq !== '') {
    const from = await k.household.moveSource(uid, art, id);
    const to = await k.household.writeTargetOrNull(uid, ownerReq);
    if (to === null) fachfehler('verboten', 'kein_schreibrecht');
    if (from === to) return { unchanged: true };
    // Like moveSet(): opposite directions lock both accounts' rows in reverse order.
    const moved = await k.transaktion(
      t =>
        art === 'set'
          ? t.sets.setEntriesReassign(String(keys[0]), from, to, [id])
          : t.inventory.manualEntryReassign(art, keys, id, from, to),
      { sperren: [{ konto: from, schluessel: inventoryKey(art, keys) }], repeatAtConflict: true },
    );
    return { from_user_id: from, to_user_id: to, ...moved };
  }

  // The market-price fallback runs before the transaction, or a network call would
  // hold the lock and connection open.
  let priceVal: number | null = null;
  let priceEstimated = false;
  // If the market price doesn't arrive, the price stays empty; the response says so in `degradiert`.
  const ab = new Degradations();
  if (rawPrice !== undefined) {
    let p = moneyInput(rawPrice, priceColumn(art) === 'purchase_price' ? 'Kaufpreis' : 'Stückpreis');
    if (p === null) {
      priceEstimated = true;
      const bisher = condition ? null : ((await beforehand(k, art, uid, id, keys))?.condition ?? null);
      p = await ab.oder('marktpreis', a.resolvePrice(uid, keys, String(condition || bisher || '') || null), null);
    }
    priceVal = p;
  }

  const besitzer = (await beforehand(k, art, uid, id, keys))?.user_id ?? uid;
  await k.transaktion(
    async t => {
      const wids = await t.household.schreibbereich(uid);
      const acq = await rowInWriteScope(t, art, wids, id, keys);
      // From here on the row's owner counts, not the viewer.
      const ownerId = Number(acq.user_id);
      let newDate: string | null = null;
      if (date !== undefined && date !== null && date !== '') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) fachfehler('ungueltig', 'datum_ungueltig');
        newDate = String(date);
      }
      const hasCondition = condition !== undefined && condition !== null;
      const targetCondition = hasCondition ? zustand(condition) : acq.condition || 'N';
      const targetEstimated = rawPrice !== undefined ? priceEstimated && priceVal != null : !!acq.price_estimated;
      // Checked against the values AFTER this change.
      if (newDate || rawPrice !== undefined || hasCondition) {
        const clash = await t.inventory.entryAtSameTag(art, ownerId, keys, newDate || acq.tag, id, targetCondition, {
          preis: rawPrice !== undefined ? priceVal : acq.preis,
          geschaetzt: targetEstimated,
          waehrung: acq.currency,
        });
        if (clash) fachfehler('konflikt', 'datum_belegt');
      }
      const hasQuantity = quantity !== undefined && quantity !== null;
      await t.inventory.erfassung.aendere(art, id, wids, {
        ...(hasQuantity ? { menge: inventoryQuantity(quantity, 1) } : {}),
        ...(rawPrice !== undefined ? { preis: { wert: priceVal, geschaetzt: targetEstimated } } : {}),
        ...(hasCondition ? { zustand: targetCondition } : {}),
        ...(newDate ? { datum: newDate } : {}),
      });
      if (hasQuantity && isEmpty(await holdingQuantity(t, art, ownerId, keys)))
        await a.cleanupWhenEmpty(t, ownerId, keys);
    },
    { sperren: [{ konto: besitzer, schluessel: inventoryKey(art, keys) }] },
  );
  return response(k, art, uid, keys, { ...ab.angabe() });
}

/** If nothing is left afterwards, the holding row goes with it. */
export async function deleteAcquisition(k: CollectionContext, art: ErfassungsArt, uid: number, id: number, keys: Keys) {
  const a = kinds(k)[art];
  const besitzer = (await beforehand(k, art, uid, id, keys))?.user_id ?? uid;
  const menge = await k.transaktion(
    async t => {
      const acq = await rowInWriteScope(t, art, await t.household.schreibbereich(uid), id, keys);
      const ownerId = Number(acq.user_id);
      await t.inventory.erfassung.loesche(art, id, ownerId);
      const q = await holdingQuantity(t, art, ownerId, keys);
      if (isEmpty(q)) await a.cleanupWhenEmpty(t, ownerId, keys);
      return q;
    },
    { sperren: [{ konto: besitzer, schluessel: inventoryKey(art, keys) }] },
  );
  return response(k, art, uid, keys, { new_quantity: menge ?? 0 });
}

export async function setAcquisitionsForSet(k: CollectionContext, sicht: Sicht | number[], setNumber: string) {
  return k.setAcquisitions.inScope(await k.household.scopeFrom(sicht), setNumber);
}
