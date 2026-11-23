/** The wanted list — what one WANTS to have, separate from holdings. A helper
 * instead of code in the routes, because both UIs and several entry paths
 * need the same rules. */
import type { Viewer } from '../household';
import * as V from '../infra/validate';
import { failDomain } from '../infra/errorTexts';
import { moneyInput } from '../infra/money';
import { publicError } from '../infra/error';
import { Degradations } from '../infra/result';
import { forSet } from '../catalog';
import { imageIfPresent } from '../images';
import { toCsv, csvRowsFromRequest, csvDate, csvFirst } from '../infra/csvExport';
import { possibleSetNumber, withVersion, normalizeSetNumber } from '../infra/setNumber';
import type { WantedContext } from './context';

/** Each condition on its own: if BrickLink doesn't know one, the other still
 * comes through, and a missing price is a dash, not an error. */
export async function pricesForBothConditions(k: WantedContext, uid: number, setNumber: string) {
  const currency = String(await k.settings.userValue(uid, 'currency', 'EUR'));
  if (!possibleSetNumber(withVersion(setNumber)) || !(await k.catalog.setKnownInCatalog(setNumber)))
    return { currency, current: {} };
  const guideType = String(await k.settings.userValue(uid, 'price_guide_type', 'sold'));
  const ttlHours = String(await k.settings.userValue(uid, 'price_cache_ttl', '24'));
  const current: Record<string, { condition: string; avg_price: unknown; min_price: unknown; max_price: unknown }> = {};
  // "none" after a fetch failure is not "BrickLink knows none".
  const ab = new Degradations();
  for (const c of ['N', 'U']) {
    const pd = await ab.orElse(
      `marktpreis_${c}`,
      k.finances.fetchPrice(setNumber, c, guideType, currency, ttlHours),
      null,
    );
    // A fallback price from the other condition would otherwise show as "market price (new)"; the list says "none".
    if (pd && !pd.is_fallback)
      current[c] = { condition: c, avg_price: pd.avg_price, min_price: pd.min_price, max_price: pd.max_price };
  }
  return { currency, current, ...ab.detail() };
}

export interface WantedItem {
  set_number: string;
  condition: string;
  created_at: Date | string;
  /** In the household tree, other members' wanted items show up too. */
  user_id: number;
  /** In THIS item's condition, from the cache — null as long as none is known. */
  market_price: number | null;
  currency: string;
  /** From rb_sets, not stored itself (see migration 0021). */
  name: string | null;
  year: number | null;
  theme_id: number | null;
  num_parts: number | null;
  image_url: string | null;
  /** Local instead of CDN, because the CSP blocks third-party image sources. */
  image_local: string | null;
  owned: boolean;
  /** Travels along: an alert nobody sees anymore is forgotten. */
  alarm: { direction: string; threshold: number; triggered: boolean } | null;
  /** On the item, not the catalog: the button only needs the set number. */
  price_comparison_url: string;
}

/** Without a value, the user's setting applies, not a hard 'N' — the mix-up once
 * booked an acquisition with the wrong price. */
export async function conditionOrDefault(
  k: WantedContext,
  raw: string | null | undefined,
  userId: number,
): Promise<V.ConditionState> {
  return (
    V.optionalCondition(
      String(raw ?? '')
        .trim()
        .toUpperCase(),
    ) ?? V.conditionOf(await k.settings.userDefaultCondition(userId))
  );
}

/** ON CONFLICT instead of checking first: two devices at once should see no error. */
export async function addWantedItem(
  k: WantedContext,
  userId: number,
  setNumber: string,
  condition: string | null | undefined,
  capturedAt?: string | null,
): Promise<{ item: WantedItem | null; was_new: boolean }> {
  const sn = normalizeSetNumber(setNumber);
  const c = await conditionOrDefault(k, condition, userId);
  const r = await k.wanted.markSetWanted(userId, sn, c, capturedAt ?? null);
  const list = await wantedItemsOf(k, [userId], sn);
  return { item: list.find(w => w.condition === c) ?? null, was_new: !!r?.was_new };
}

/** No error if there was none — the goal is already met. */
export async function removeWantedItem(
  k: WantedContext,
  userId: number,
  setNumber: string,
  c: V.ConditionState,
): Promise<number> {
  const r = await k.wanted.removeWantedEntry(userId, normalizeSetNumber(setNumber), c);
  return r.changes ?? 0;
}

/** Wanted-item changes read first and write several times afterward (item, alert,
 * holdings): all in one transaction, locked per account on the item. */
function withWantedItemLock<T>(
  k: WantedContext,
  accounts: number[],
  sn: string,
  c: string,
  fn: (t: WantedContext) => Promise<T>,
): Promise<T> {
  return k.transact(fn, {
    locks: accounts.map(account => ({ account, key: `merk:${sn}:${c}` })),
    repeatAtConflict: true,
  });
}

// UPDATE instead of delete-and-recreate: the added date and price alert stay.
export async function moveWantedItem(
  k: WantedContext,
  ofId: number,
  setNumber: string,
  c: V.ConditionState,
  toId: number,
): Promise<{ moved: boolean; merged: boolean }> {
  const sn = normalizeSetNumber(setNumber);
  if (ofId === toId) return { moved: false, merged: false };

  return withWantedItemLock(k, [ofId, toId], sn, c, async t => {
    if (await t.wanted.isWanted(toId, sn, c)) {
      const route = await removeWantedItem(t, ofId, sn, c);
      await t.finances.priceAlert.deleteAlert(ofId, sn, c);
      return { moved: route > 0, merged: true };
    }
    const r = await t.wanted.transferWantedEntry(toId, ofId, sn, c);
    const moved = (r.changes ?? 0) > 0;
    // Only carry the alert along if the item really moved.
    if (moved) await t.finances.priceAlert.alarmTransfer(toId, ofId, sn, c);
    return { moved, merged: false };
  });
}

export interface WantedFilter {
  /** Number OR name, substring, case-insensitive. */
  search?: unknown;
  /** 'N' or 'U'. Anything else means: both. */
  condition?: unknown;
  /** Unknown falls back to added_desc. */
  sort?: unknown;
}

/** `userIds`: the wanted list follows the household tree like everything else. */
export async function wantedItemsOf(
  k: WantedContext,
  userIdsChoice: Viewer | number[],
  onlySet?: string,
  currency = 'EUR',
  filter?: WantedFilter,
): Promise<WantedItem[]> {
  const userIds = await k.household.scopeFrom(userIdsChoice);
  if (!userIds?.length) return [];
  // Unknown means "both", not "none": an emptied list would look like an empty wanted list.
  const condition = String(filter?.condition ?? '').toUpperCase();
  const rows = await k.wanted.wantedListInScope(
    userIds,
    {
      setOnly: onlySet ? normalizeSetNumber(onlySet) : null,
      search: String(filter?.search ?? '').trim() || null,
      condition: condition === 'N' || condition === 'U' ? condition : null,
      sort: filter?.sort,
    },
    currency,
  );

  // Order the image here: the proxy only leaves a note for previews, but the
  // detail view asks for the full image.
  return rows.map(({ alarm_direction, alarm_threshold, alarm_triggered, ...r }) => {
    // Synchronous and cached — no filesystem access per row. Same naming rule
    // as when storing it (src/images/setImages.ts).
    const local = imageIfPresent(`/images/sets/${String(r.set_number).replace(/[^a-z0-9-]/gi, '_')}.jpg`) ?? null;
    if (!local && r.image_url) k.images.rememberUsed(String(r.image_url), String(r.set_number));
    return {
      ...r,
      currency,
      owned: !!r.owned,
      price_comparison_url: forSet(r.set_number, r.name),
      image_local: local,
      alarm:
        alarm_direction == null
          ? null
          : {
              direction: alarm_direction,
              threshold: Number(alarm_threshold),
              triggered: !!alarm_triggered,
            },
    };
  });
}

/** Via setErfassen(): without network, so with removing the wanted item in one
 * transaction; the job fills in the catalog and an estimated price. */
export async function fulfillWantedItem(
  k: WantedContext,
  readerId: number,
  ownerId: number,
  setNumber: string,
  wantedKey: V.ConditionState,
  body: {
    quantity?: unknown;
    purchase_price?: unknown;
    condition?: string | null | undefined;
    storage?: unknown;
  } = {},
): Promise<{ action: string; set_number: string }> {
  const sn = normalizeSetNumber(setNumber);

  // Two conditions: `wantedKey` is the wanted item's key, which disappears;
  // `eingabe.condition` is the one the set is recorded in.
  const wantedCondition = await conditionOrDefault(k, wantedKey, ownerId);
  const condition = body.condition == null ? wantedCondition : await conditionOrDefault(k, body.condition, ownerId);
  const quantity = V.acquisitionQuantity(body.quantity ?? 1);
  const purchasePrice = moneyInput(body.purchase_price, 'Kaufpreis');

  // Record and remove together: otherwise the set would sit in holdings AND
  // still on the wanted list at the same time.
  return withWantedItemLock(k, [ownerId], sn, wantedCondition, async t => {
    // A wanted item is being fulfilled; without it, this would be a second way to record.
    if (!(await t.wanted.isWanted(ownerId, sn, wantedCondition))) failDomain('not_found', 'not_found');
    // Already in scope means "exists", not increase; the wanted item is still done.
    const r = await t.sets.acquireSet({
      requester: readerId,
      ownerWish: ownerId,
      setNumber: sn,
      quantity,
      purchasePrice,
      condition,
      storage: body.storage == null ? null : String(body.storage),
    });
    // After the WANTED-ITEM's condition: this is about the entry that was fulfilled.
    await removeWantedItem(t, ownerId, sn, wantedCondition);
    await t.finances.priceAlert.deleteAlert(ownerId, sn, wantedCondition);
    return r.action === 'added'
      ? { action: 'added', set_number: r.set_number, name: r.name, catalog_pending: r.catalog_pending }
      : { action: 'exists', set_number: r.set_number };
  });
}

/** Only account, set, condition and date: the view derives everything else. */
export async function wantedListCsv(k: WantedContext, uid: number): Promise<string> {
  const rows = await k.wanted.wantedListForExport(uid);

  return toCsv(['set_number', 'condition', 'created_at'], rows);
}

/** The counterpart to wantedListCsv(); runs as a job (src/collection/importJobs.ts). */
export async function importWantedListCsv(k: WantedContext, owner: number, text: string) {
  const { records, cleaned, skipped } = csvRowsFromRequest(text);

  let added = 0,
    updated = 0,
    errors = 0;
  const results: Array<{ set_number: string; action: string; error?: string }> = [];

  for (const row of cleaned) {
    // Last fallback: a file without a header row, first column = set number —
    // the same leniency as the minifig import.
    const setNumber = String(csvFirst(row, 'set_number', 'Setnummer', 'set_num') || Object.values(row)[0] || '').trim();
    if (!setNumber) continue;

    const condition = String(csvFirst(row, 'condition', 'zustand', 'Zustand') || '').trim();
    const am = csvDate(row.created_at || row.captured_at || row['Auf der Liste seit']);

    try {
      const { was_new } = await addWantedItem(k, owner, setNumber, condition, am);
      if (was_new) {
        added++;
        results.push({ set_number: setNumber, action: 'added' });
      } else {
        updated++;
        results.push({ set_number: setNumber, action: 'exists' });
      }
    } catch (e) {
      errors++;
      results.push({ set_number: setNumber, action: 'error', error: publicError(e, 'wanted-csv:zeile').error });
    }
  }
  return { added, updated, errors, records, results, skipped };
}
