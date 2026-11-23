import { savePrice, cacheUsable, priceFromCache, parallelLimit } from './financeCalc';
import { reportError, errorMessage, logAndContinue } from '../infra/error';
import { JobMove, type JobContext } from '../jobQueue';
import { withoutBricklinkPrice } from '../infra/setNumber';
import { hasPrice } from '../catalog';
import { BricklinkNotReachable } from '../externalSources';
import { receiptsSessionLock } from '../../db/txLock';
import { LOCKS } from '../infra/lockNamespaces';
import { attempts } from '../infra/result';
import { conditionOf } from '../infra/validate';
import type { FinancesContext } from './context';
import { checkSet } from './priceAlert';

/** The job runs in the job process, reading happens in the web process — hence in laufzustand. */
export const PRICE_STATUS = 'preis_job_stand';
const _log: string[] = [];

const PRICE_JOB_LOCK = LOCKS.PRICE_JOB;

/** On an OWN connection for the whole runtime: manual triggers
 * run in other processes, `state.running` does not see them.
 * @returns release function, or null if a run is already going on elsewhere */
async function acquireRunLock(k: FinancesContext): Promise<(() => Promise<void>) | null> {
  let approval: (() => Promise<void>) | null;
  try {
    approval = await receiptsSessionLock(k.db, PRICE_JOB_LOCK);
  } catch (e) {
    // Exception: better to run without a lock than not at all; within the process the kind's exclusivity protects.
    log(`Sperre nicht verfügbar (${errorMessage(e)}) — Lauf ohne prozessübergreifenden Schutz`);
    return async () => {};
  }
  if (!approval) return null;
  const f = approval;
  return () => f().catch(e => log(`Sperre konnte nicht freigegeben werden: ${errorMessage(e)}`));
}

function log(msg: string) {
  const line = `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] ${msg}`;
  console.log(`  PriceJob: ${msg}`);
  _log.unshift(line);
  if (_log.length > 50) _log.length = 50;
}

// `string | number`: getGlobalSetting() delivers text, other callers a number.
async function fetchAndCachePrice(
  k: FinancesContext,
  setNumber: string,
  condition: string,
  guideType: string,
  currency: string,
  forceTtlHours?: string | number,
) {
  if (withoutBricklinkPrice(await k.catalog.catalogEntry(setNumber))) return 'skipped_gear';

  const ttl = Math.max(1, parseInt(String(forceTtlHours ?? ''), 10));
  // The same freshness rule as in the request path: a zero row is retried after six hours as well.
  const present = await priceFromCache(k, setNumber, condition, currency, ttl);
  if (cacheUsable(present, ttl, k.clock.now())) return 'skipped';

  const rl = await k.externalSources.quotaFree('bricklink');
  if (!rl.allowed) return 'rate_limited';

  const fallback = condition === 'N' ? 'U' : 'N';
  let g: Awaited<ReturnType<typeof k.catalog.priceGuide>>;
  try {
    g = await k.catalog.priceGuide(setNumber, condition, guideType, currency);
  } catch (e) {
    if (e instanceof BricklinkNotReachable) return 'nicht_erreichbar';
    log(`Error ${setNumber} (${condition}): ${errorMessage(e).substring(0, 60)}`);
    return 'error';
  }

  // A response with nothing but zeros is written as well: it holds back the next run, otherwise
  // the same set would cost two fetches every time.
  const p = await savePrice(k, setNumber, condition, currency, g);

  if (!hasPrice({ avg_price: p.avg, qty_avg_price: p.qavg })) {
    const rl2 = await k.externalSources.quotaFree('bricklink');
    if (rl2.allowed) {
      try {
        const g2 = await k.catalog.priceGuide(setNumber, fallback, guideType, currency);
        await savePrice(k, setNumber, fallback, currency, g2);
      } catch (e) {
        reportError('preis-job:rueckfall-zustand', e);
      }
    }
  }
  return 'updated';
}

/** Counters and abort reasons of a run, shared by all parallel sets. */
interface RunState {
  updated: number;
  skipped: number;
  errors: number;
  omitted: number;
  // Once the quota is used up, every further set would come back with the same answer.
  limitReached?: boolean;
  notReachable?: boolean;
  current: number;
  total: number;
}

/** Wishlist items too: /price-history only reads the cache; without this run their history would stay empty. */
async function pricePlacesPerAccount(k: FinancesContext): Promise<Map<number, string[]>> {
  const own = await k.priceRun.inventoryPlaces();
  const wanted = await attempts('preis-job:gewuenschte', k.priceRun.wantedListsPlaces());
  if (!wanted.ok) log('Merkliste nicht lesbar — nur eigene Sets');
  const perAccount = new Map<number, string[]>();
  for (const r of [...own, ...(wanted.ok ? wanted.value : [])].sort((a, b) => a.user_id - b.user_id)) {
    const list = perAccount.get(r.user_id) ?? [];
    if (!list.includes(r.set_number)) list.push(r.set_number);
    perAccount.set(r.user_id, list);
  }
  return perAccount;
}

/** BrickLink at its daily limit or unreachable: said once per run, the rest follows next run. */
function noteUnavailable(st: RunState, r: 'rate_limited' | 'nicht_erreichbar'): void {
  const limit = r === 'rate_limited';
  if (limit ? !st.limitReached : !st.notReachable)
    log(
      `${limit ? 'BrickLink-Tageslimit erreicht' : 'BrickLink nicht erreichbar (Wartung)'} — die übrigen Sets folgen im nächsten Lauf`,
    );
  if (limit) st.limitReached = true;
  else st.notReachable = true;
  st.omitted++;
}

/** A set in all conditions it needs; the result counts in `st`. */
async function refreshSet(
  k: FinancesContext,
  sn: string,
  states: string[],
  currency: string,
  ttl: string,
  st: RunState,
) {
  let last = 'skipped';
  for (const c of states) {
    try {
      const r = await fetchAndCachePrice(k, sn, c, 'sold', currency, ttl);
      if (r === 'rate_limited' || r === 'nicht_erreichbar') {
        noteUnavailable(st, r);
        return 'rate_limited';
      }
      if (r === 'updated') {
        st.updated++;
        last = 'updated';
      } else if (last !== 'updated') st.skipped++;
    } catch (e) {
      st.errors++;
      log(`Error ${sn} (${c}): ${errorMessage(e).substring(0, 80)}`);
      last = 'error';
    }
  }
  return last;
}

/** 'sold' = prices actually achieved in the last six months; five sets in parallel. */
async function refreshAccount(kx: FinancesContext, userId: number, setNumbers: string[], st: RunState, k?: JobContext) {
  const currency = await kx.settings.userValue(userId, 'currency', 'EUR');
  const ttlHours = (await kx.settings.globalValue('price_cache_ttl', '24')) || '24';
  const valid = setNumbers.filter(sn => /^[a-zA-Z0-9]+-\d+$/.test(sn));
  // Three queries per account instead of per set.
  const states = await statesPerSet(kx, userId, valid);
  const tasks = valid.map(sn => async () => {
    st.current++;
    k?.signal.throwIfAborted();
    if (st.limitReached || st.notReachable) {
      st.omitted++;
      return 'rate_limited';
    }
    if (k && st.current % 10 === 1)
      await k.progress({ done: st.current, total: st.total, text: `${sn} (${st.current}/${st.total})` });
    return refreshSet(kx, sn, states.get(sn) ?? ['N'], currency, ttlHours, st);
  });
  await parallelLimit(tasks, 5);
}

/** Once per run, not per fetch; a failure is recorded in the state, throwing it would repeat the whole run. */
async function afterTheRun(k: FinancesContext, job?: JobContext) {
  log('Writing daily price_history snapshot from price_cache...');
  const state = await attempts('preis-job:tagesstand', k.priceRun.writeDailyStatus());
  if (state.ok) log(`Daily snapshot: ${state.value} price history entries inserted`);
  const alerts = await attempts('preis-job:preisalarme', async () => {
    const waiting = await k.priceRun.setsWithAlarm();
    let reported = 0;
    for (const sn of waiting) reported += await checkSet(k, sn, k.mail);
    if (waiting?.length) log(`Preisalarm: ${waiting.length} Sets geprueft, ${reported} gemeldet`);
  });
  const without = [state.ok ? null : 'tagesstand', alerts.ok ? null : 'preisalarme'].filter(x => x !== null);
  if (without.length) await job?.progress({ text: `ohne ${without.join(', ')}`, without });
}

async function reportResult(kx: FinancesContext, st: RunState, duration: number, k?: JobContext) {
  const reason = st.notReachable ? 'BrickLink nicht erreichbar' : 'Tageslimit';
  log(
    `Done: ${st.updated} updated, ${st.skipped} skipped, ${st.errors} errors${st.omitted ? `, ${st.omitted} wegen ${reason} ausgelassen` : ''} — ${(duration / 1000).toFixed(1)}s`,
  );
  await rememberStatus(kx, {
    lastRun: kx.clock.date().toISOString(),
    lastDuration: duration,
    lastUpdated: st.updated,
    lastErrors: st.errors,
  });
  await k?.progress({
    done: st.total,
    total: st.total,
    text: `${st.updated} aktualisiert, ${st.errors} Fehler — ${(duration / 1000).toFixed(1)}s`,
  });
}

/** If another process holds the lock, the job is retried one minute later. */
async function runPriceRefresh(kx: FinancesContext, k?: JobContext) {
  if (!(await kx.settings.globalValue('bricklink_consumer_key', ''))) {
    log('BrickLink credentials not configured, skipping');
    await rememberStatus(kx, {});
    return;
  }
  const releaseLock = await acquireRunLock(kx);
  if (!releaseLock) throw new JobMove(new Date(kx.clock.now() + 60_000), 'Läuft bereits in einem anderen Prozess');
  const t0 = kx.clock.now();
  const st: RunState = { updated: 0, skipped: 0, errors: 0, omitted: 0, current: 0, total: 0 };
  await k?.progress({ done: 0, total: 0, text: 'Starte…' });
  try {
    const perAccount = await pricePlacesPerAccount(kx);
    st.total = [...perAccount.values()].reduce((n, l) => n + l.length, 0);
    if (!st.total) {
      log('No sets, nothing to do');
      await rememberStatus(kx, { lastRun: kx.clock.date().toISOString() });
      return;
    }
    log(`Starting: ${st.total} set-slots`);
    await k?.progress({ done: 0, total: st.total, text: `0/${st.total} Sets` });
    for (const [userId, setNumbers] of perAccount) await refreshAccount(kx, userId, setNumbers, st, k);
    await reportResult(kx, st, kx.clock.now() - t0, k);
    await afterTheRun(kx, k);
  } catch (e) {
    log(`Fatal: ${errorMessage(e)}`);
    await rememberStatus(kx, {});
    throw e;
  } finally {
    await releaseLock(); // MUST stay here: otherwise a crashed run blocks the lock
  }
}

/** Mixed sets need both prices, pure ones one; one version for nightly run and capture.
 * @param hintCondition condition of an acquisition that does not exist yet */
async function statesPerSet(
  k: FinancesContext,
  userId: number,
  setNumbers: string[],
  hintCondition: string | null = null,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (!setNumbers.length) return result;

  type StateRow = { set_number: string; c?: string | null };
  const collect = async (query: Promise<StateRow[]>): Promise<Map<string, Set<string>>> => {
    // No catch: without the conditions every set would fall back to 'N', and the used price would be silently missing.
    const rows = await query;
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!m.has(r.set_number)) m.set(r.set_number, new Set<string>());
      m.get(r.set_number)!.add(conditionOf(r.c));
    }
    return m;
  };

  const recorded = await collect(k.priceRun.recordedStates(userId, setNumbers));
  const wanted = await collect(k.priceRun.desiredStates(userId, setNumbers));

  for (const sn of setNumbers) {
    // Without an acquisition the hint is the only source: the new set's acquisition is not yet
    // written (conditionsNeededFor).
    const own = new Set<string>(recorded.get(sn) ?? []);
    if (hintCondition === 'U' || hintCondition === 'N') own.add(hintCondition);
    for (const c of wanted.get(sn) ?? []) own.add(c);
    result.set(sn, own.size ? [...own] : ['N']);
  }
  return result;
}

/** On capture the acquisition does not exist yet; without the hint the
 * rule would fall back to 'N'.
 * @returns e.g. ['N'], ['U'] or ['N','U'] */
async function conditionsNeededFor(
  k: FinancesContext,
  setNumber: string,
  userId: number,
  hintCondition: string | null = null,
): Promise<string[]> {
  return (await statesPerSet(k, userId, [setNumber], hintCondition)).get(setNumber) ?? ['N'];
}

async function fetchPriceForSet(
  k: FinancesContext,
  setNumber: string,
  userId: number,
  hintCondition: string | null = null,
) {
  if (!/^[a-zA-Z0-9]+-\d+$/.test(setNumber)) {
    log(`Skipping invalid: ${setNumber}`);
    return;
  }
  const ck = await k.settings.globalValue('bricklink_consumer_key', '');
  if (!ck) return;
  try {
    const currency = await k.settings.userValue(userId, 'currency', 'EUR');
    const guideType = 'sold';
    // All conditions the set has — otherwise one half is missing for mixed sets.
    const conditions = await conditionsNeededFor(k, setNumber, userId, hintCondition);
    log(`Immediate price fetch: ${setNumber} (${conditions.join('+')})`);
    for (const c of conditions) {
      const r = await fetchAndCachePrice(k, setNumber, c, guideType, currency, 0);
      if (r === 'rate_limited' || r === 'nicht_erreichbar') {
        log(
          `${r === 'rate_limited' ? 'BrickLink-Tageslimit erreicht' : 'BrickLink nicht erreichbar (Wartung)'} — ${setNumber} folgt im nächsten Lauf`,
        );
        break;
      }
    }
    log(`Immediate price done: ${setNumber}`);
  } catch (e) {
    // Connection errors resolve on the next attempt.
    const isConnErr =
      errorMessage(e).includes('timeout') ||
      errorMessage(e).includes('terminated') ||
      errorMessage(e).includes('connect');
    if (!isConnErr) log(`Immediate price failed for ${setNumber}: ${errorMessage(e).substring(0, 80)}`);
  }
}

async function rememberStatus(k: FinancesContext, fresh: Record<string, unknown>): Promise<void> {
  const alt = await k.jobQueue.readState(PRICE_STATUS).then(
    r => (r ? JSON.parse(r) : {}),
    () => ({}),
  );
  await k.jobQueue
    .setState(PRICE_STATUS, JSON.stringify({ ...alt, ...fresh, log: _log.slice(0, 15) }))
    .catch(logAndContinue('preis-job:stand'));
}

export { runPriceRefresh, fetchPriceForSet, fetchAndCachePrice, statesPerSet, conditionsNeededFor };
