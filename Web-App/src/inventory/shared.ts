import * as repo from './repository/shared';
import * as purchases from './repository/purchases';
import { isSparePart, NO_COLOR } from '../infra/validate';
import { asIds, type Sicht } from '../household';
import type { InventoryContext } from './context';

// What sets, parts and figures need in common.

/** Per request, independent of the query path — one place instead of five literals. */
export const MAX_PAGE_SIZE = 500;

/** Without page_size the whole inventory would otherwise be in memory in one response. */
export const UNPAGED_LIMIT = 2000;

/** The app's set detail view only fetches page 1; the normal limit would cut it off. */
export const SET_PARTS_MAX_PAGE_SIZE = 5000;

export function clampPageSize(value: unknown, fallback: number): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(value), 10) || fallback));
}

/** COUNT(*) is bigint and comes from the driver as a string. */
type CountValue = number | string | null | undefined;

/** THE condition rule for sets, manual parts and figures: one used
 * acquisition makes the entry used. */
export function conditionFromAcquisitions(acqCount: CountValue, usedCount: CountValue) {
  // COUNT(*) comes as text ("2").
  const acq = parseInt(String(acqCount ?? ''), 10) || 0;
  const used = parseInt(String(usedCount ?? ''), 10) || 0;
  // One expression, so that the rule stays readable as ONE line.
  if (acq > 0) return used > 0 ? 'U' : 'N';
  return 'N';
}

/** For the badges: whoever has new and used should see both. */
export function conditionsFromAcquisitions(acqCount: CountValue, usedCount: CountValue): ('N' | 'U')[] {
  const acq = parseInt(String(acqCount ?? ''), 10) || 0;
  const used = parseInt(String(usedCount ?? ''), 10) || 0;
  // Without acquisitions the one badge "new".
  if (acq <= 0) return ['N'];
  const out: ('N' | 'U')[] = [];
  if (acq - used > 0) out.push('N');
  if (used > 0) out.push('U');
  return out.length ? out : ['N'];
}

// As for sets: one used acquisition makes the entry used; one query per page.
type Key = { part_number?: string; color_id?: number | null; fig_number?: string };
export async function setManualCondition<R extends Key>(
  k: InventoryContext,
  userId: number | number[],
  rows: R[],
  kind: 'part' | 'fig',
) {
  // asIds(), so that older callers with a bare ID keep working.
  const uids = asIds(userId);
  if (!rows?.length) return rows;

  const isPart = kind === 'part';
  const keyOf = (r: Key) => (isPart ? `${r.part_number}|${r.color_id ?? NO_COLOR}` : String(r.fig_number));

  const acq = await k.gemeinsam.entryMetrics(isPart ? 'part' : 'fig', uids);

  const byKey = new Map(acq.map(a => [keyOf(a), a]));

  return rows.map(r => {
    const a = byKey.get(keyOf(r));
    const acqCount = parseInt(String(a?.acq_count), 10) || 0;
    const usedCount = parseInt(String(a?.used_count), 10) || 0;
    return {
      ...r,
      condition: conditionFromAcquisitions(acqCount, usedCount),
      conditions: conditionsFromAcquisitions(acqCount, usedCount),
      acq_count: acqCount,
      used_count: usedCount,
      // Weighted by quantity over the acquisitions, not the most recently written unit price.
      avg_purchase_price: a?.avg_purchase_price != null ? Number(a.avg_purchase_price) : null,
    };
  });
}

// One function for parts and figures: only table and key change.
export interface UsingSet {
  set_number: string;
  set_name: string | null;
  quantity: number;
  image_local: string | null;
  image_url: string | null;
  owner_user_id: number;
}

export interface ComponentHeader {
  nummer: string;
  name: string | null;
  color_id: number | null;
  color_name: string | null;
  color_hex: string | null;
  category_name: string | null;
  image_local: string | null;
  image_url: string | null;
  is_spare: boolean;
  /** string_agg: the same part can lie in several boxes; one value would conceal the others. */
  storage: string | null;
  /** For the storage location selection in the dialog. */
  owner_ids: number[];
  total_quantity: number;
}

export interface ComponentResponse {
  item: ComponentHeader | null;
  sets: UsingSet[];
}

export async function usingSets(
  k: InventoryContext,
  uidsChoice: Sicht | number[],
  table: 'parts' | 'minifigs',
  key: Record<string, string | number>,
): Promise<ComponentResponse> {
  const uids = await k.household.scopeFrom(uidsChoice);
  const rows = await k.gemeinsam.setsWithComponent(uids, table, key);

  const sets: UsingSet[] = rows.map(r => ({
    set_number: String(r.set_number),
    set_name: r.set_name ?? null,
    quantity: parseInt(String(r.quantity), 10) || 0,
    image_local: r.set_image_local ?? null,
    image_url: r.set_image_url ?? null,
    owner_user_id: parseInt(String(r.owner_user_id), 10),
  }));

  // The header from the same rows as the list; the image from the first one with an image.
  const first = rows[0];
  const withImage = rows.find(r => r.teil_image_local || r.teil_image_url);
  const item: ComponentHeader | null = first
    ? {
        nummer: String(first.nummer),
        name: first.name ?? null,
        color_id: first.color_id == null ? null : parseInt(String(first.color_id), 10),
        color_name: first.color_name ?? null,
        color_hex: first.color_hex ?? null,
        category_name: first.category_name ?? null,
        image_local: withImage?.teil_image_local ?? null,
        image_url: withImage?.teil_image_url ?? null,
        // istErsatzteil(): aggregates come as strings, and "0" is truthy.
        is_spare: isSparePart(first.is_spare),
        storage: first.storage ?? null,
        owner_ids: [...new Set(sets.map(s => s.owner_user_id))].filter(Number.isFinite),
        total_quantity: sets.reduce((n, s) => n + s.quantity, 0),
      }
    : null;

  return { item, sets };
}

/** One place for the delete route and cleaning up the acquisitions; in a transaction via `t`. */
/** The row and, if it existed, its purchases: the finance sums would otherwise keep counting the part. */
export async function deleteManual(
  k: InventoryContext,
  art: 'part' | 'fig',
  ownerId: number,
  key: (string | number)[],
) {
  const [number = '', color = 0] = key;
  const r =
    art === 'part'
      ? await repo.loescheTeilZeile(k.db, ownerId, String(number), Number(color))
      : await repo.deleteMinifigRow(k.db, ownerId, String(number));
  if (!r.changes) return r;
  if (art === 'part') await purchases.deletePartEntries(k.db, ownerId, String(number), Number(color) || 0);
  else await purchases.deleteMinifigEntries(k.db, ownerId, String(number));
  return r;
}
