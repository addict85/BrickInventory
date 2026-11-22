import * as repo from './repository/sets';
import { asIds, type Sicht, type ScopeInput as Blickfeld } from '../household';
import type { SetsContext } from './context';

// For deletion and removal; otherwise parts become orphaned. In the caller's transaction (`t`).
export async function deleteSetRows(t: SetsContext, uids: number[], setNumber: string) {
  await t.inventory.setInhalt.remove(uids, setNumber);
}

/** By default in the whole write scope; an account selection narrows it, never widens it. */
export async function deleteSetFor(sk: SetsContext, s: Sicht, setNumber: string) {
  const writable = await sk.household.writeScope(s.nutzer);
  const chosen = s.konten === undefined ? writable : await sk.household.scopeFrom(s);
  return deleteSet(
    sk,
    chosen.filter(id => writable.includes(id)),
    setNumber,
  );
}

/** null: the set does not exist in scope; otherwise the new trash entries. */
export async function deleteSet(sk: SetsContext, userId: Blickfeld, setNumber: string): Promise<number[] | null> {
  const uids = asIds(userId);
  // Atomic: an aborted DELETE would otherwise leave parts and figures without a set in
  // the parts list and finance sums.
  return sk.transact(async t => {
    const owner = await repo.ownerOfSets(t.db, uids, setNumber);
    if (!owner.length) return null;
    // One entry per account: restoring goes into the account it belonged to.
    const trash: number[] = [];
    for (const b of owner) {
      const id = await t.inventory.putInTrash('set', b.user_id, setNumber);
      if (id !== null) trash.push(id);
    }
    await deleteSetRows(t, uids, setNumber);
    return trash;
  });
}
