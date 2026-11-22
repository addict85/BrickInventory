/** One rule for three kinds, so the webapp and the app don't drift apart. */
import { moneyInput } from '../infra/money';
import type { Sicht } from '../household';
import { Degradations } from '../infra/result';
import { inventoryKey } from '../../db/txLock';
import { failDomain, type ErrorCode } from '../infra/errorTexts';
import { quantityOfSets, quantityThePosition, priceColumn, type AcquisitionKind } from '../../db/stockQuantity';
import { inventoryQuantity, conditionOf } from '../infra/validate';
import type { CollectionContext } from './context';

export type { AcquisitionKind } from '../../db/stockQuantity';
type Keys = Array<string | number>;

interface Kind {
  notFound: ErrorCode;
  /** In this row's condition, if the price is cleared. */
  resolvePrice: (uid: number, keys: Keys, cond: string | null) => Promise<number | null>;
  /** Inside the transaction: `t` is its context. */
  cleanupWhenEmpty: (t: CollectionContext, ownerId: number, keys: Keys) => Promise<unknown>;
}

const kinds = (k: CollectionContext): Record<AcquisitionKind, Kind> => ({
  set: {
    notFound: 'acquisition_not_found',
    resolvePrice: (uid, [sn], cond) => k.finances.currentMarketPrice(String(sn), uid, cond || null),
    // Same as explicit deletion: the set's parts and minifigs would otherwise
    // sit in the parts/minifigs list and finance totals without a set.
    cleanupWhenEmpty: (t, ownerId, [sn]) => t.sets.deleteSetRows([ownerId], String(sn)),
  },
  part: {
    notFound: 'not_found',
    resolvePrice: (uid, [pn, cid], cond) => k.finances.currentPartMarketPrice(String(pn), Number(cid), uid, cond),
    // Only the manual holding; set parts go with their set.
    cleanupWhenEmpty: (t, ownerId, keys) => t.inventory.deleteManual('part', ownerId, keys),
  },
  fig: {
    notFound: 'not_found',
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
  price: number | null;
  price_estimated: boolean;
  currency: string;
  tag: string;
}

/** Only for the lock key and price fallback; the query inside the transaction checks the rights. */
async function beforehand(k: CollectionContext, kind: AcquisitionKind, uid: number, id: number, keys: Keys) {
  return k.inventory.acquisition.inWriteScope(kind, id, await k.household.writeScope(uid), keys);
}

/** 0 "empty" and null "no row" are cleaned up; a read error propagates, a fallback would hide the
 * cause inside the transaction (every command after is lost then, 25P02). */
function holdingQuantity(
  t: CollectionContext,
  kind: AcquisitionKind,
  ownerId: number,
  keys: Keys,
): Promise<number | null> {
  return kind === 'set'
    ? quantityOfSets(ownerId, String(keys[0]), t.db)
    : quantityThePosition(kind, ownerId, keys, t.db);
}
const isEmpty = (q: number | null) => q === null || q <= 0;

/** Write scope: a sub-account must not write backwards. */
async function rowInWriteScope(
  t: CollectionContext,
  kind: AcquisitionKind,
  wids: number[],
  id: number,
  keys: Keys,
): Promise<Row> {
  const a = kinds(t)[kind];
  const z = await t.inventory.acquisition.inWriteScope(kind, id, wids, keys);
  if (!z) failDomain('not_found', a.notFound);
  return z;
}

async function response(
  k: CollectionContext,
  kind: AcquisitionKind,
  uid: number,
  keys: Keys,
  payload: Record<string, unknown>,
) {
  return kind === 'set' ? k.sets.withSetAggregate(uid, String(keys[0]), payload) : payload;
}

export interface Change {
  quantity?: unknown;
  condition?: unknown;
  date?: unknown;
  owner_user_id?: unknown;
  [price: string]: unknown;
}

/** Like moveSet(): opposite directions lock both accounts' rows in reverse order. */
async function moveToOwner(
  k: CollectionContext,
  kind: AcquisitionKind,
  uid: number,
  id: number,
  keys: Keys,
  ownerReq: unknown,
) {
  const from = await k.household.moveSource(uid, kind, id);
  const to = await k.household.writeTargetOrNull(uid, ownerReq);
  if (to === null) failDomain('forbidden', 'no_write_access');
  if (from === to) return { unchanged: true };
  const moved = await k.transact(
    t =>
      kind === 'set'
        ? t.sets.setEntriesReassign(String(keys[0]), from, to, [id])
        : t.inventory.manualEntryReassign(kind, keys, id, from, to),
    { locks: [{ account: from, key: inventoryKey(kind, keys) }], repeatAtConflict: true },
  );
  return { from_user_id: from, to_user_id: to, ...moved };
}

/** The market-price fallback runs before the transaction, or a network call would
 * hold the lock and connection open. If the market price doesn't arrive, the price stays
 * empty; the response says so in `degradiert`. */
async function incomingPrice(
  k: CollectionContext,
  kind: AcquisitionKind,
  at: { uid: number; id: number; keys: Keys },
  rawPrice: unknown,
  condition: unknown,
  ab: Degradations,
): Promise<{ value: number | null; estimated: boolean }> {
  const p = moneyInput(rawPrice, priceColumn(kind) === 'purchase_price' ? 'Kaufpreis' : 'Stückpreis');
  if (p !== null) return { value: p, estimated: false };
  const bisher = condition ? null : ((await beforehand(k, kind, at.uid, at.id, at.keys))?.condition ?? null);
  const market = kinds(k)[kind].resolvePrice(at.uid, at.keys, String(condition || bisher || '') || null);
  return { value: await ab.orElse('marktpreis', market, null), estimated: true };
}

function newDateOf(date: unknown): string | null {
  if (date === undefined || date === null || date === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) failDomain('invalid', 'date_invalid');
  return String(date);
}

type Tx = Parameters<Parameters<CollectionContext['transact']>[0]>[0];

async function changeInTransaction(
  t: Tx,
  a: Kind,
  kind: AcquisitionKind,
  at: { uid: number; id: number; keys: Keys },
  body: Change,
  price: { value: number | null; estimated: boolean } | undefined,
): Promise<void> {
  const { uid, id, keys } = at;
  const { quantity, condition } = body;
  const wids = await t.household.writeScope(uid);
  const acq = await rowInWriteScope(t, kind, wids, id, keys);
  // From here on the row's owner counts, not the viewer.
  const ownerId = Number(acq.user_id);
  const newDate = newDateOf(body.date);
  const hasCondition = condition !== undefined && condition !== null;
  const targetCondition = hasCondition ? conditionOf(condition) : acq.condition || 'N';
  const targetEstimated = price ? price.estimated && price.value != null : !!acq.price_estimated;
  // Checked against the values AFTER this change.
  if (newDate || price || hasCondition) {
    const clash = await t.inventory.entryAtSameTag(kind, ownerId, keys, newDate || acq.tag, id, targetCondition, {
      price: price ? price.value : acq.price,
      estimated: targetEstimated,
      currency: acq.currency,
    });
    if (clash) failDomain('conflict', 'date_taken');
  }
  const hasQuantity = quantity !== undefined && quantity !== null;
  await t.inventory.acquisition.change(kind, id, wids, {
    ...(hasQuantity ? { quantity: inventoryQuantity(quantity, 1) } : {}),
    ...(price ? { price: { wert: price.value, estimated: targetEstimated } } : {}),
    ...(hasCondition ? { condition: targetCondition } : {}),
    ...(newDate ? { date: newDate } : {}),
  });
  if (hasQuantity && isEmpty(await holdingQuantity(t, kind, ownerId, keys))) await a.cleanupWhenEmpty(t, ownerId, keys);
}

export async function changeAcquisition(
  k: CollectionContext,
  kind: AcquisitionKind,
  uid: number,
  id: number,
  keys: Keys,
  body: Change,
) {
  const a = kinds(k)[kind];
  const rawPrice = body[priceColumn(kind)];
  const ownerReq = body.owner_user_id;
  if (ownerReq !== undefined && ownerReq !== null && ownerReq !== '')
    return moveToOwner(k, kind, uid, id, keys, ownerReq);

  const at = { uid, id, keys };
  const ab = new Degradations();
  const price = rawPrice !== undefined ? await incomingPrice(k, kind, at, rawPrice, body.condition, ab) : undefined;
  const owner = (await beforehand(k, kind, uid, id, keys))?.user_id ?? uid;
  await k.transact(t => changeInTransaction(t, a, kind, at, body, price), {
    locks: [{ account: owner, key: inventoryKey(kind, keys) }],
  });
  return response(k, kind, uid, keys, { ...ab.detail() });
}

/** If nothing is left afterwards, the holding row goes with it. */
export async function deleteAcquisition(
  k: CollectionContext,
  kind: AcquisitionKind,
  uid: number,
  id: number,
  keys: Keys,
) {
  const a = kinds(k)[kind];
  const owner = (await beforehand(k, kind, uid, id, keys))?.user_id ?? uid;
  const quantity = await k.transact(
    async t => {
      const acq = await rowInWriteScope(t, kind, await t.household.writeScope(uid), id, keys);
      const ownerId = Number(acq.user_id);
      await t.inventory.acquisition.remove(kind, id, ownerId);
      const q = await holdingQuantity(t, kind, ownerId, keys);
      if (isEmpty(q)) await a.cleanupWhenEmpty(t, ownerId, keys);
      return q;
    },
    { locks: [{ account: owner, key: inventoryKey(kind, keys) }] },
  );
  return response(k, kind, uid, keys, { new_quantity: quantity ?? 0 });
}

export async function setAcquisitionsForSet(k: CollectionContext, sicht: Sicht | number[], setNumber: string) {
  return k.setAcquisitions.inScope(await k.household.scopeFrom(sicht), setNumber);
}
