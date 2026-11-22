/** Moving happens via the acquisitions: both accounts' quantities follow from that when reading. */
import { failDomain } from '../infra/errorTexts';
import { withVersion } from '../infra/setNumber';
import * as repo from './repository/move';
import type { SetsContext } from './context';

export interface Shift {
  quantity: number;
  acquisitions: number;
  merged: boolean;
  parts: number;
  minifigs: number;
  instructions: number;
  source_emptied: boolean;
}

/** One after another instead of Promise.all: all queries run on the same
 * transaction connection. */
async function copyContents(t: SetsContext, sn: string, fromId: number, toId: number) {
  const n = { parts: 0, minifigs: 0, instructions: 0 };
  for (const tab of ['parts', 'minifigs'] as const) n[tab] = await t.inventory.setContent.copy(tab, sn, fromId, toId);
  if (!(await repo.hatInstructions(t.db, toId, sn)))
    n.instructions = await repo.copyInstructions(t.db, sn, fromId, toId);
  return n;
}

/** In the caller's transaction (`t`), under the lock of the source inventory.
 * @param acquisitionIds empty = the whole set; otherwise only these purchase price rows */
export async function setEntriesReassign(
  t: SetsContext,
  sn: string,
  fromId: number,
  toId: number,
  acquisitionIds?: number[],
): Promise<Shift> {
  const src = await repo.setRow(t.db, fromId, sn);
  if (!src) failDomain('not_found', 'not_found');

  const all = await repo.moveEntriesTo(t.db, fromId, sn);
  const wanted = acquisitionIds?.length ? all.filter(a => acquisitionIds.includes(parseInt(String(a.id), 10))) : all;
  if (!wanted.length) failDomain('not_found', 'purchase_price_not_found');

  const totalQty = all.reduce((s, a) => s + (a.quantity || 1), 0);
  const movingQty = wanted.reduce((s, a) => s + (a.quantity || 1), 0);
  const remaining = Math.max(0, totalQty - movingQty);

  // Master data describes the set, not the copy: if it already lies with the target,
  // reassigning the acquisitions is enough.
  const dst = await repo.setRow(t.db, toId, sn);
  if (!dst) await t.inventory.createSet(toId, sn, src.added_at);

  for (const a of wanted) {
    await t.inventory.bookDailyEntry('set', toId, [sn], {
      quantity: a.quantity,
      price: a.purchase_price,
      condition: a.condition,
      createdAt: a.created_at,
      estimated: a.price_estimated,
      currency: a.currency,
    });
    await t.inventory.acquisition.remove('set', a.id, fromId);
  }

  const counts = await copyContents(t, sn, fromId, toId);

  // Partial move: the sender keeps copies and therefore set and contents.
  if (remaining > 0) {
    return { quantity: movingQty, acquisitions: wanted.length, merged: !!dst, ...counts, source_emptied: false };
  }
  await repo.removeInstructions(t.db, fromId, sn);
  await t.inventory.setContent.remove([fromId], sn);
  return { quantity: movingQty, acquisitions: wanted.length, merged: !!dst, ...counts, source_emptied: true };
}

/** Account as identifier from the input; schreibziel() checks it. */
type AccountWish = string | number | null | undefined;

/** The entry point: three acquisitions are three purchases; whoever wants everything selects all rows. Under the
 * lock of the source inventory, so that no second path books in between. */
export async function moveSet(
  sk: SetsContext,
  uid: number,
  raw: string,
  fromValue: AccountWish,
  nach: AccountWish,
  acquisitions: number[],
) {
  if (!acquisitions.length) failDomain('invalid', 'purchase_prices_required');
  const sn = withVersion(raw);
  const fromId = await sk.household.writeTarget(uid, fromValue ?? uid);
  const toId = await sk.household.writeTarget(uid, nach);
  if (fromId === toId) failDomain('invalid', 'source_equals_target');
  // Two moves in opposite directions lock the rows of both accounts in reverse order.
  const r = await sk.transact(t => setEntriesReassign(t, sn, fromId, toId, acquisitions), {
    locks: [{ account: fromId, key: sn }],
    repeatAtConflict: true,
  });
  return { set_number: sn, from_user_id: fromId, to_user_id: toId, ...r };
}
