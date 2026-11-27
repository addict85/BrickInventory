/** Precomputed, because the live query over all of a household's set parts takes seconds. */
import { reportError } from '../infra/error';
import { inSystemContext, rowsContext } from '../infra/accountContext';
import * as repo from './repository/summary';
import type { PartsContext } from './context';

const currentVersion = (k: PartsContext, userId: number) => k.summary.rawState(userId);

export async function rebuildSummary(k: PartsContext, userId: number, version?: { v: number }): Promise<void> {
  const state = version ?? (await currentVersion(k, userId));
  // Whether THIS call built it: if another call holds the lock, there is nothing to catch up on.
  let built = false;
  await k.transact(async t => {
    // Lock via the database, not only via _rebuilding: several processes.
    if (!(await repo.lockAccount(t.db, userId))) {
      return;
    }
    await repo.rebuildAll(t.db, userId, state.v);
    built = true;
  });

  // Without fresh statistics the planner picks the wrong index after the bulk insert.
  // At most every ten minutes, because ANALYZE scans the table across all accounts.
  const z = processState(k);
  if (built && k.clock.now() - z.lastAnalyse > 10 * 60_000) {
    z.lastAnalyse = k.clock.now();
    await k.summary.analyze().catch((e: unknown) => reportError('parts-summary:analyze', e));
  }
}

/** Per access: account IDs, rebuilds and the follow-up belong to the database they run in. */
const processState = (k: PartsContext) =>
  k.compartments.slot('partsSummary', () => ({
    lastAnalyse: 0,
    rebuild: new Map<number, Promise<void>>(),
    followUp: null as ReturnType<typeof runCatalogFollowUp> | null,
  }));

function rebuildInBackground(k: PartsContext, userId: number, v: { v: number }) {
  const _rebuilding = processState(k).rebuild;
  if (_rebuilding.has(userId)) return;
  const p = rebuildSummary(k, userId, v)
    .catch((e: unknown) => reportError('parts-summary:background', e))
    .finally(() => {
      _rebuilding.delete(userId);
    });
  _rebuilding.set(userId, p);
}

// Doesn't rebuild within the request: a rebuild there cost the parts tab seconds.
export async function summaryFresh(
  k: PartsContext,
  userId: number | number[],
  opts?: { strict?: boolean },
): Promise<boolean> {
  // The household view is fresh only if it is for EVERY account involved.
  const ids = Array.isArray(userId) ? userId : [userId];
  if (ids.length > 1) {
    const results = await Promise.all(ids.map(id => summaryFresh(k, id, opts)));
    return results.every(Boolean);
  }
  userId = ids[0] ?? 0;
  try {
    const [v, state] = await Promise.all([currentVersion(k, userId as number), k.summary.builtState(userId)]);
    // If another process holds the lock, the state isn't guaranteed.
    const catalogCaughtUp = !v.openCatalog || (await catalogFollowUpOnce(k)) !== null;
    if (state === v.v && catalogCaughtUp) return true;

    rebuildInBackground(k, userId, v);

    // strict: only a CURRENT state counts, so stats agree everywhere.
    if (opts?.strict) return false;

    // Stale numbers are better than a three-second wait; if there is no state
    // at all yet, the caller must query live.
    return state !== null;
  } catch (e) {
    // Exception: false means "not fresh"; the caller queries live, slower but never wrong.
    reportError('parts-summary:fresh', e);
    return false;
  }
}

/** One follow-up per access: a household's accounts ask at the same time. A request files it
 * as a job, because the web system role can't reach other accounts' stock; until then, stale BL numbers. */
async function catalogFollowUpOnce(k: PartsContext) {
  if (rowsContext().web) {
    await k.jobQueue.placeJobOne('catalog_followup', {}, { key: 'catalog_followup' });
    return { accounts: 0, groups: 0 };
  }
  const z = processState(k);
  z.followUp ??= runCatalogFollowUp(k).finally(() => {
    z.followUp = null;
  });
  return z.followUp;
}

const CATALOG_INDIVIDUAL_UP_TO = 5000;

/** Groups with a changed BL number, before and after. Runs in system scope: the queue
 * is global, whoever drains it follows up for all accounts. @returns null if another run is already catching up */
export function runCatalogFollowUp(k: PartsContext): Promise<{ accounts: number; groups: number } | null> {
  return inSystemContext('catalog-follow-up', () => runCatalogFollowUpInScope(k));
}

async function runCatalogFollowUpInScope(k: PartsContext): Promise<{ accounts: number; groups: number } | null> {
  return k.transact(async t => {
    if (!(await repo.lockCatalogFollowUp(t.db))) return null;
    const numbers = await repo.pendingNumbers(t.db);
    if (!numbers.length) return { accounts: 0, groups: 0 };
    if (numbers.length > CATALOG_INDIVIDUAL_UP_TO) return { accounts: await repo.discardAllStates(t.db), groups: -1 };
    const affected = await repo.affectedGroups(t.db, numbers);
    const perAccount = new Map<number, string[]>();
    for (const b of affected) perAccount.set(b.user_id, [...(perAccount.get(b.user_id) ?? []), b.part_key]);
    for (const [uid, groups] of perAccount) {
      // An in-progress rebuild is waited out so it doesn't overwrite with a stale catalog.
      await repo.waitForAccount(t.db, uid);
      await repo.rebuildGroups(t.db, uid, groups);
    }
    return { accounts: perAccount.size, groups: affected.length };
  });
}

/** For call sites that need guaranteed current numbers right after (end of a CSV import). */
export async function rebuildNow(k: PartsContext, userId: number): Promise<void> {
  const _rebuilding = processState(k).rebuild;
  // A running rebuild (e.g. from summaryFresh) may have read the stock before the caller's last
  // write: wait it out (its error belongs to its own caller), then build from the state as it is now.
  for (let running = _rebuilding.get(userId); running; running = _rebuilding.get(userId))
    await Promise.allSettled([running]);
  const v = await currentVersion(k, userId);
  const p = rebuildSummary(k, userId, v).finally(() => {
    _rebuilding.delete(userId);
  });
  _rebuilding.set(userId, p);
  return p;
}
