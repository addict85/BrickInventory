/** SQL, Rebrickable and jobs only live here and below, so that the routes only know request and response. */
import { deleteSetRows } from './delete';
import { toCsv } from '../infra/csvExport';
import { bookEntry } from './addSet';
import { failDomain } from '../infra/errorTexts';
import { inventoryQuantity, conditionOf } from '../infra/validate';
import * as repo from './repository/sets';
import type { Input } from '../contract';
import { attempts, valueOr, Degradations } from '../infra/result';
import { normalizeLocation } from '../inventory';
import { normalizeSetNumber } from '../infra/setNumber';
import * as detailRepo from './repository/setDetail';
import type { SetsContext } from './context';
export type { CatalogPart, ListenTeil, SetMaster } from './rows';

/** Create, change and output sets — one implementation for web and app, so that
 * both follow the same rules for quantity, purchase price and scope. */

/** Order price cache → BrickLink → history; if everything stays empty,
 * src/inventory/purchasePriceBackfill.ts fills it in later. */
async function priceForNewEntry(sk: SetsContext, userId: number, setNumber: string) {
  // Via the scope: with a bare ID the main account would not find the sub-account's set.
  const scope = valueOr(await attempts('sets:kaufpreis-blickfeld', sk.household.scopeIds(userId)), [userId]);
  const cond = await sk.finances.setState(scope, setNumber);
  // The ACCOUNT's currency: the price is looked up and stored in it.
  const currency = String(await sk.settings.userValue(userId, 'currency', 'EUR'));
  const cached = valueOr(
    await attempts('set-service:cached', sk.finances.marketPriceFromCache(setNumber, currency, cond)),
    null,
  );
  let pp = cached?.market_price || null;
  if (!pp)
    pp = valueOr(
      await attempts('set-service:aktuellerMarktpreis', sk.finances.currentMarketPrice(setNumber, userId, cond)),
      null,
    );
  if (!pp) {
    // The history fills the gap when cache and BrickLink quota come up empty during CSV import; otherwise
    // the acquisition would be created without a purchase price.
    const hist = valueOr(
      await attempts('set-service:hist', sk.finances.marketPriceFromHistory(setNumber, currency, cond)),
      null,
    );
    pp = hist?.market_price || null;
  }
  return { price: pp, condition: cond, geschaetzt: pp != null, currency };
}

/** @param pricePlan determined beforehand; without it, it is fetched here — then
 *        sk must NOT be a transaction, because a network call is involved. */
async function alignEntriesToQuantity(
  sk: SetsContext,
  userId: number,
  setNumber: string,
  newTotalQty: number,
  pricePlan: { price: number | null; condition: string; geschaetzt?: boolean; currency?: string } | null = null,
) {
  // No catch: with an empty list after a read error the adjustment would book the whole quantity anew.
  const rows: { id: number; quantity: number; created_at: Date }[] = await repo.setEntriesNewestFirst(
    sk.db,
    userId,
    setNumber,
  );
  const current = rows.reduce((sum: number, r: { quantity?: number | null }) => sum + (r.quantity || 0), 0);
  let delta = newTotalQty - current;
  if (delta === 0) return [];
  if (delta > 0) {
    if (rows.length) {
      {
        // Topping up or a new daily row is decided by addPurchaseAtTag(), so that the rule exists
        // only once.
        const plan = pricePlan ?? (await priceForNewEntry(sk, userId, setNumber));
        await bookEntry(sk, {
          konto: userId,
          setNumber,
          quantity: delta,
          kaufpreis: plan.price,
          condition: plan.condition,
          geschaetzt: !!plan.geschaetzt,
          currency: plan.currency ?? null,
        });
      }
    } else {
      const plan = pricePlan ?? (await priceForNewEntry(sk, userId, setNumber));
      await bookEntry(sk, {
        konto: userId,
        setNumber,
        quantity: newTotalQty,
        kaufpreis: plan.price,
        condition: plan.condition || 'N',
        geschaetzt: !!plan.geschaetzt,
        currency: plan.currency ?? null,
      });
    }
    return [];
  }
  const dropped: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (delta === 0) break;
    const take = Math.min(r.quantity, -delta);
    const row = await repo.setEntryAsJson(sk.db, r.id);
    if (row) dropped.push({ ...row, quantity: take });
    if (take >= r.quantity) await sk.inventory.erfassung.remove('set', r.id, userId);
    else await sk.inventory.erfassung.change('set', r.id, [userId], { quantity: r.quantity - take });
    delta += take;
  }
  return dropped;
}

/** What a reduction removed, in the shape of the response: the UI names the purchase in the undo toast. */
function droppedResponse(rows: Record<string, unknown>[]) {
  return rows.map(z => ({
    id: Number(z.id),
    quantity: Number(z.quantity),
    purchase_price: z.purchase_price == null ? null : Number(z.purchase_price),
    currency: z.currency == null ? null : String(z.currency),
    price_estimated: !!z.price_estimated,
    condition: String(z.condition ?? 'N'),
    date: z.day == null ? null : String(z.day),
  }));
}

/** The LAST acquisition, because the detail dialog edits exactly that one.
 * @param field  fixed column name, NOT an input from outside */
async function writeInLastEntry(
  sk: SetsContext,
  field: 'purchase_price' | 'condition',
  wert: number | string | null,
  ownerId: number,
  sn: string,
) {
  await sk.inventory.setNewest('set', field === 'purchase_price' ? 'preis' : 'zustand', wert, ownerId, [sn]);
}

export async function changeSet(sk: SetsContext, uid: number, sn: string, body: Input<'PUT /api/v2/sets/:setNumber'>) {
  // WRITE scope instead of the own ID, otherwise a set of the sub-account would find no row.
  const _wids = await sk.household.writeScope(uid);
  // The OWN row wins, otherwise the table order would decide.
  const existing = await repo.setRowInWriteField(sk.db, _wids, sn, uid);
  if (!existing) failDomain('not_found', 'set_not_found');
  // From here on the OWNER counts, otherwise acquisitions would arise in the wrong account.
  const ownerId = parseInt(String(existing.user_id), 10);

  const hatDelta = body.quantity_delta !== undefined && body.quantity_delta !== null;
  const hasQuantity = hatDelta || (body.quantity !== undefined && body.quantity !== null);
  let trash: number | null = null;
  let dropped: ReturnType<typeof droppedResponse> = [];
  // A market price that did not come, or a quantity that could not be read back, is listed in `degradiert`.
  const ab = new Degradations();

  if (hasQuantity) {
    // Relative, so that two concurrent "+1" yield two instead of overwriting each other.
    const delta = hatDelta ? Number(body.quantity_delta) : null;
    if (delta !== null && (!Number.isInteger(delta) || Math.abs(delta) > 9999))
      failDomain('ungueltig', 'value_invalid');
    // In the household every quantity belongs to one account; without a value to the own one. A foreign one only in the write scope.
    const target = body.owner_user_id == null ? uid : Number(body.owner_user_id);
    if (!_wids.includes(target)) failDomain('verboten', 'no_write_access');
    const desiredTotal = delta === null ? inventoryQuantity(body.quantity) : null;
    const readField = await sk.household.scopeIds(uid);
    // The household is displayed, only the target account is changed.
    const eigenesZiel = async (s: SetsContext) => {
      const totalBefore = await repo.setMenge(s.db, 'blickfeld', readField, sn);
      const ownBefore = await repo.setMenge(s.db, 'eines', target, sn);
      // Capped at 0: I cannot take away copies of another account.
      const change = delta ?? Number(desiredTotal) - totalBefore;
      return { ownBefore, eigenZiel: Math.max(0, ownBefore + change) };
    };
    // The market price is fetched BEFORE the lock (network call); what counts is the calculation within the lock.
    const upfront = await eigenesZiel(sk);
    const plan =
      upfront.eigenZiel > upfront.ownBefore
        ? await ab.orElse('kaufpreis', priceForNewEntry(sk, target, sn), { price: null, condition: 'N' })
        : { price: null, condition: 'N' };
    await sk.transact(
      async t => {
        const { ownBefore, eigenZiel } = await eigenesZiel(t);
        if (eigenZiel === ownBefore) return;
        // If the set so far only belonged to another account, the adjustment would otherwise come to nothing.
        if (ownBefore === 0 && eigenZiel > 0) await t.inventory.createSet(target, sn);
        // Quantity 0 goes through the trash, so that a typo can be undone.
        if (eigenZiel === 0) {
          dropped = droppedResponse(await repo.setEntriesAsJson(t.db, target, sn));
          trash = await t.inventory.putInTrash('set', target, sn);
          await deleteSetRows(t, [target], sn);
        } else {
          // Individual purchases go through the trash too: otherwise a purchase price would vanish without a way back.
          const route = await alignEntriesToQuantity(t, target, sn, eigenZiel, plan);
          dropped = droppedResponse(route);
          trash = await t.inventory.putPurchasesInTrash(target, sn, route);
        }
      },
      { sperren: [{ konto: target, schluessel: sn }] },
    );
  }
  // With a quantity change the app sends the old price and condition as an echo; applied, they would overwrite
  // the market price of the new acquisition.
  if (body.purchase_price !== undefined && !hasQuantity) {
    let pp: number | null = body.purchase_price;
    if (pp === null || Number.isNaN(pp)) {
      // Condition of the LAST acquisition, otherwise the price for "new" would come. No catch: after a read error
      // the new price would otherwise go into a used set.
      const lastCond = await repo.stateNewestSetEntry(sk.db, ownerId, sn);
      pp = await sk.finances.currentMarketPrice(sn, ownerId, lastCond?.condition || null);
    }
    const val = pp !== null && !Number.isNaN(pp) ? pp : null;
    await writeInLastEntry(sk, 'purchase_price', val, ownerId, sn);
  }
  // null means "not set", not 'N'.
  if (body.condition !== undefined && body.condition !== null && !hasQuantity) {
    // ownerId: with the caller the UPDATE would hit no row for the sub-account.
    await writeInLastEntry(sk, 'condition', conditionOf(body.condition), ownerId, sn);
  }
  // Writing is already done; if only reading back fails, the response says "unknown" instead of 0.
  const after = await ab.orElse(
    'menge',
    async () => (await repo.setMenge(sk.db, 'blickfeld', await sk.household.scopeIds(uid), sn)) ?? 0,
    null,
  );
  return {
    quantity: after,
    ...(trash ? { trash } : {}),
    ...(dropped.length ? { dropped } : {}),
    ...ab.detail(),
  };
}

export async function setsAlsCsv(sk: SetsContext, uid: number) {
  const rows = await repo.setsForCsv(sk.db, uid);

  return toCsv(
    ['set_number', 'quantity', 'purchase_price', 'condition', 'acquired_at'],
    rows.map(r => ({ ...r, purchase_price: r.purchase_price ?? '' })),
  );
}

export async function rebrickableList(sk: SetsContext, uid: number) {
  const sets = await detailRepo.setsWithQuantity(sk.db, uid);
  return sets.map(s => ({ 'Set Number': s.set_number, Quantity: s.quantity }));
}

/** An instruction is attached to the set via a foreign key. */
export async function setBelongsAccount(sk: SetsContext, uid: number, sn: string): Promise<boolean> {
  return !!(await detailRepo.setOfAccount(sk.db, uid, sn));
}

/** Hits all rows of the set in the write scope: whoever packs the box packs
 * it for everyone who looks into it. */
export async function setLocationOfSets(sk: SetsContext, uid: number, sn: string, storage: string | null | undefined) {
  const location = normalizeLocation(storage);
  const n = await sk.inventory.locationService.setLocation(
    'set',
    { schreiber: uid },
    [normalizeSetNumber(sn)],
    location,
  );
  return { location, n };
}

/** The list can span several accounts, the default is always that of the
 * requester: an inherited star would be a statement about someone else's home. */
export async function locationsWithDefault(sk: SetsContext, uid: number, owner: string | undefined) {
  const [locations, preset] = await Promise.all([
    sk.inventory.locationsFor(uid, owner),
    sk.inventory.locationService.defaultOf(uid),
  ]);
  return { locations, preset };
}
