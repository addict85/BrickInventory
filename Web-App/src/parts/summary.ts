/** Precomputed, because the live query over all of a household's set parts takes seconds. */
import { reportError } from '../infra/fehler';
import { inSystemContext, rowsContext } from '../infra/kontoKontext';
import * as repo from './repository/summary';
import type { PartsContext } from './context';

const currentVersion = (k: PartsContext, userId: number) => k.summary.rawState(userId);

export async function rebuildSummary(k: PartsContext, userId: number, version?: { v: number }): Promise<void> {
  const stand = version ?? (await currentVersion(k, userId));
  // Whether THIS call built it: if another call holds the lock, there is nothing to catch up on.
  let gebaut = false;
  await k.transaktion(async t => {
    // Lock via the database, not only via _rebuilding: several processes.
    if (!(await repo.lockAccount(t.db, userId))) {
      return;
    }
    await repo.rebuildAll(t.db, userId, stand.v);
    gebaut = true;
  });

  // Without fresh statistics the planner picks the wrong index after the bulk insert.
  // At most every ten minutes, because ANALYZE scans the table across all accounts.
  const z = state(k);
  if (gebaut && k.uhr.jetzt() - z.lastAnalyse > 10 * 60_000) {
    z.lastAnalyse = k.uhr.jetzt();
    await k.summary.analyze().catch((e: unknown) => reportError('parts-summary:analyze', e));
  }
}

/** Per access: account IDs, rebuilds and the follow-up belong to the database they run in. */
const state = (k: PartsContext) =>
  k.faecher.fach('partsSummary', () => ({
    lastAnalyse: 0,
    neuaufbau: new Map<number, Promise<void>>(),
    followUp: null as ReturnType<typeof runCatalogFollowUp> | null,
  }));

function rebuildInBackground(k: PartsContext, userId: number, v: { v: number }) {
  const _rebuilding = state(k).neuaufbau;
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
    await k.jobQueue.placeJobOne('katalog_nachzug', {}, { schluessel: 'katalog_nachzug' });
    return { konten: 0, gruppen: 0 };
  }
  const z = state(k);
  z.followUp ??= runCatalogFollowUp(k).finally(() => {
    z.followUp = null;
  });
  return z.followUp;
}

const CATALOG_INDIVIDUAL_UP_TO = 5000;

/** Groups with a changed BL number, before and after. Runs in system scope: the queue
 * is global, whoever drains it follows up for all accounts. @returns null if another run is already catching up */
export function runCatalogFollowUp(k: PartsContext): Promise<{ konten: number; gruppen: number } | null> {
  return inSystemContext('catalog-follow-up', () => runCatalogFollowUpInScope(k));
}

async function runCatalogFollowUpInScope(k: PartsContext): Promise<{ konten: number; gruppen: number } | null> {
  return k.transaktion(async t => {
    if (!(await repo.lockCatalogFollowUp(t.db))) return null;
    const nummern = await repo.pendingNumbers(t.db);
    if (!nummern.length) return { konten: 0, gruppen: 0 };
    if (nummern.length > CATALOG_INDIVIDUAL_UP_TO) return { konten: await repo.discardAllStates(t.db), gruppen: -1 };
    const betroffen = await repo.affectedGroups(t.db, nummern);
    const jeAccount = new Map<number, string[]>();
    for (const b of betroffen) jeAccount.set(b.user_id, [...(jeAccount.get(b.user_id) ?? []), b.part_key]);
    for (const [uid, gruppen] of jeAccount) {
      // An in-progress rebuild is waited out so it doesn't overwrite with a stale catalog.
      await repo.waitForAccount(t.db, uid);
      await repo.rebuildGroups(t.db, uid, gruppen);
    }
    return { konten: jeAccount.size, gruppen: betroffen.length };
  });
}

/** For call sites that need guaranteed current numbers right after (end of a CSV import). */
export async function rebuildNow(k: PartsContext, userId: number): Promise<void> {
  const _rebuilding = state(k).neuaufbau;
  const running = _rebuilding.get(userId);
  if (running) return running;
  const v = await currentVersion(k, userId);
  const p = rebuildSummary(k, userId, v).finally(() => {
    _rebuilding.delete(userId);
  });
  _rebuilding.set(userId, p);
  return p;
}
