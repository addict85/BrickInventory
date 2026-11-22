import { resolveImageLocal } from '../images';
import { asIds, type Sicht } from '../household';
import { clampPageSize, conditionFromAcquisitions, conditionsFromAcquisitions } from '../inventory';
import { withVersion } from '../infra/setNumber';
import { Degradations } from '../infra/result';
import type { MinifigsContext } from './context';

// Read queries for minifigs.

/** Without page_size, unchanged behavior — the Android app calls it this way. */
type MinifigsQuery = {
  search?: string | undefined;
  source?: string | undefined;
  set_number?: string | undefined;
  page?: number | undefined;
  page_size?: number | null | undefined;
};
export async function readMinifigs(
  k: MinifigsContext,
  userIdChoice: Sicht | number | number[],
  { search, source, set_number, page = 1, page_size = null }: MinifigsQuery = {},
) {
  const userId = await k.household.scopeFrom(userIdChoice);
  // asIds(), so older callers with a bare ID keep working.
  const uids = asIds(userId);
  const size = page_size ? clampPageSize(page_size, 60) : null;
  const { figCount, figs } = await k.minifigsList.groupedMinifigs(uids, {
    search: search ?? null,
    source: source ?? null,
    setNumber: set_number ? withVersion(set_number) : null,
    seite: size ? { groesse: size, versatz: (Math.max(1, page || 1) - 1) * size } : null,
  });

  // One "used" acquisition is enough for the minifig to count as used.
  const usedFigRows = await k.minifigsList.conditionCountsOfManualMinifigs(uids);
  const conditionByMinifig = new Map<string, { acq_count: number; used_count: number }>(
    usedFigRows.map(r => [r.fkey, r] as [string, { acq_count: number; used_count: number }]),
  );

  const condition = (f: { fig_number: unknown }) => conditionByMinifig.get(String(f.fig_number).trim().toLowerCase());
  const mappedFigs = figs.map(({ owner_ids, ...f }) => ({
    ...f,
    // owner_ids only in a household: in a single account "mine" would be noise.
    ...(uids.length > 1 ? { owner_ids: (owner_ids || []).map((n: unknown) => parseInt(String(n), 10)) } : {}),
    image_local: resolveImageLocal(f.image_local),
    // 'N' without an acquisition.
    condition: conditionFromAcquisitions(condition(f)?.acq_count, condition(f)?.used_count),
    conditions: conditionsFromAcquisitions(condition(f)?.acq_count, condition(f)?.used_count),
  }));

  // With a total count for infinite scroll, as with setsLesen.
  return {
    figs: await k.household.attachOwners(uids, mappedFigs),
    total: figCount ? figCount.c : mappedFigs.length,
  };
}

// One count for the webapp and the app; the app used to count itself, differently.
export async function computeMinifigStats(k: MinifigsContext, userIdChoice: Sicht | number | number[]) {
  const userId = await k.household.scopeFrom(userIdChoice);
  const uids = asIds(userId);
  const row = await k.minifigsList.minifigStats(uids);
  return {
    types: row?.types ?? 0,
    total_quantity: row?.total_quantity ?? 0,
    manual: row?.manual ?? 0,
    // Old name of the webapp response, so the tile doesn't depend on the rename.
    unique_figs: row?.types ?? 0,
  };
}

/** @param viewerId whose settings apply (currency); `userId` says whose data. */
export async function readManualMinifigs(
  k: MinifigsContext,
  userIdChoice: Sicht | number | number[],
  viewerId: number,
  {
    page = 1,
    page_size = null,
    search = null,
  }: { page?: number; page_size?: number | null; search?: string | null } = {},
  ab = new Degradations(),
) {
  const userId = await k.household.scopeFrom(userIdChoice);
  const uids = asIds(userId);
  const size = page_size ? clampPageSize(page_size, 60) : null;
  const figs = await k.minifigsList.manualMinifigsList(
    uids,
    search,
    size ? { groesse: size, versatz: (Math.max(1, page || 1) - 1) * size } : null,
  );
  const mapped = figs.map(f => ({ ...f, image_local: resolveImageLocal(f.image_local) }));
  const withCondition = await k.inventory.setManualCondition(uids, mapped, 'fig');

  // The market price ONLY from the cache, in one query for the whole list: a
  // live lookup per entry would make the list wait on BrickLink.
  const prices = await ab.orElse(
    'marktpreise',
    k.finances.marketPricesFromCacheForMinifigs(withCondition, viewerId),
    new Map<string, number>(),
  );
  const withPrice = withCondition.map(f => ({ ...f, avg_price: prices.get(String(f.fig_number)) ?? null }));

  return k.household.attachOwners(uids, withPrice);
}
