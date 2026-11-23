import type { Writer } from '../household';
import type { DbInterface } from '../../db/database';
import * as repo from './repository/trash';
import * as purchase from './repository/purchaseAcquisitions';
import type { PaperKind } from './repository/trash';
import type { InventoryContext } from './context';
import type { InventoryReadContract } from './readContract';
import { failDomain, notFound } from '../infra/errorTexts';

export type Kind = PaperKind;
export const RETENTION_DAYS = 30;

const ACQUISITIONS: Record<Kind, string> = {
  set: 'set_acquisitions',
  teil: 'part_acquisitions',
  figur: 'minifig_acquisitions',
};

function parameter(kind: Kind, userId: number, number: string, colorId: number | null) {
  return kind === 'teil' ? [userId, number, colorId] : [userId, number];
}

/** In the deletion's transaction, BEFORE the DELETEs: if storing fails,
 * nothing is deleted either.
 * @returns the entry's id, or null if there was no master row */
export async function putInTrash(
  k: InventoryContext,
  kind: Kind,
  userId: number,
  number: string,
  colorId: number | null = null,
): Promise<number | null> {
  const p = parameter(kind, userId, number, colorId);
  const rows = await repo.inventoryRows(k.db, kind, p);
  const master = repo.tablesTheKind(kind)[0] ?? '';
  if (!rows[master]?.length) return null;

  const name = await repo.label(k.db, kind, userId, number, colorId);
  return repo.createEntry(k.db, userId, kind, number, kind === 'teil' ? colorId : null, name, rows);
}

/** Individual purchases of a set that a quantity reduction removed: the inventory row stays, hence an
 * entry without a `sets` row. Restoring puts the quantities back (placePurchasesAgainHer).
 * @param rows per purchase the whole row, `quantity` = the removed quantity */
export async function putPurchasesInTrash(
  k: InventoryContext,
  userId: number,
  number: string,
  rows: Record<string, unknown>[],
): Promise<number | null> {
  if (!rows.length) return null;
  const name = await repo.label(k.db, 'set', userId, number, null);
  const emptyTables = Object.fromEntries(repo.tablesTheKind('set').map(t => [t, [] as unknown[]]));
  return repo.createEntry(k.db, userId, 'set', number, null, name, { ...emptyTables, set_acquisitions: rows });
}

/** Back into the row the quantity came from; if it no longer exists, into an identical row of the same day
 * (the unique index allows no second one), otherwise as a new row. Without an inventory row the set has
 * gone entirely in the meantime: then restore its entry first. */
async function restorePurchases(
  tx: DbInterface,
  l: InventoryReadContract,
  e: { user_id: number; number: string },
  purchases: Purchase[],
) {
  if (!(await repo.hasSetRow(tx, l, e.user_id, e.number))) return false;
  for (const k of purchases) {
    const quantity = Number(k.quantity) || 0;
    if (await purchase.stallEntryOn(tx, 'set', Number(k.id), e.user_id, quantity)) continue;
    const same = await purchase.sameEntryAtTag(tx, 'set', e.user_id, [e.number], String(k.day), -1, {
      condition: String(k.condition ?? 'N'),
      price: k.purchase_price == null ? null : Number(k.purchase_price),
      estimated: !!k.price_estimated,
      currency: k.currency == null ? null : String(k.currency),
    });
    if (same && (await purchase.stallEntryOn(tx, 'set', same, e.user_id, quantity))) continue;
    await repo.writeBack(tx, 'set', { set_acquisitions: [k] });
  }
  return true;
}
type Purchase = Record<string, unknown>;

export interface TrashEntry {
  id: number;
  user_id: number;
  type: Kind;
  number: string;
  color_id: number | null;
  label: string | null;
  count: number;
  deleted_at: string;
  purge_at: string;
}

export async function listTrash(k: InventoryContext, uidsChoice: Writer | number[]): Promise<TrashEntry[]> {
  const uids = await k.household.writeAreaFrom(uidsChoice);
  const rows = await k.trash.entries(uids, RETENTION_DAYS);
  return rows.map(r => {
    const acquisitions = r.rows?.[ACQUISITIONS[r.type]] ?? [];
    const { rows: _z, ...rest } = r;
    return { ...rest, count: acquisitions.reduce((s, e) => s + (Number(e.quantity) || 0), 0) };
  });
}

export type Restoration = { type: Kind; number: string; user_id: number };

/** If the element exists again in the meantime, a unique index applies — then
 * nothing is changed and the entry stays. */
export async function restore(k: InventoryContext, uidsChoice: Writer | number[], id: number): Promise<Restoration> {
  const uids = await k.household.writeAreaFrom(uidsChoice);
  try {
    return await k.transact(async (t): Promise<Restoration> => {
      const e = await repo.lockTrashEntry(t.db, id, uids);
      if (!e) notFound();
      const kind = e.type as Kind;
      const purchases = kind === 'set' && !e.rows?.sets?.length ? (e.rows?.set_acquisitions ?? []) : null;
      if (purchases) {
        if (!(await restorePurchases(t.db, t.readContract, { user_id: e.user_id, number: e.number }, purchases)))
          notFound();
        await repo.removeTrashEntry(t.db, id);
        return { type: kind, number: e.number, user_id: e.user_id };
      }
      await repo.writeBack(t.db, kind, e.rows ?? {});
      await repo.removeTrashEntry(t.db, id);
      return { type: kind, number: e.number, user_id: e.user_id };
    });
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') failDomain('conflict', 'trash_already_exists');
    throw err;
  }
}

export async function deleteFinal(k: InventoryContext, uidsChoice: Writer | number[], id: number): Promise<void> {
  const uids = await k.household.writeAreaFrom(uidsChoice);
  if (!(await k.trash.removeEntryOfAccount(id, uids))) notFound();
}

export async function emptyTrash(k: InventoryContext, uidsChoice: Writer | number[]): Promise<number> {
  const uids = await k.household.writeAreaFrom(uidsChoice);
  return k.trash.removeAll(uids);
}

export async function cleanTrashOn(k: InventoryContext): Promise<number> {
  return k.trash.removeOlder(RETENTION_DAYS);
}
