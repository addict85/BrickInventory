import { savePrice, cacheUsable, priceFromCache, parallelLimit } from './financeCalc';
import { reportError, fehlertext, logAndContinue } from '../infra/error';
import { JobMove, type JobContext } from '../jobQueue';
import { withoutBricklinkPrice } from '../infra/setNumber';
import { hatPrice } from '../catalog';
import { BricklinkNotReachable } from '../externalSources';
import { receiptsSessionLock } from '../../db/txLock';
import { LOCKS } from '../infra/lockNamespaces';
import { versuche } from '../infra/result';
import { zustand } from '../infra/validate';
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
  let freigabe: (() => Promise<void>) | null;
  try {
    freigabe = await receiptsSessionLock(k.db, PRICE_JOB_LOCK);
  } catch (e) {
    // Exception: better to run without a lock than not at all; within the process the kind's exclusivity protects.
    log(`Sperre nicht verfügbar (${fehlertext(e)}) — Lauf ohne prozessübergreifenden Schutz`);
    return async () => {};
  }
  if (!freigabe) return null;
  const f = freigabe;
  return () => f().catch(e => log(`Sperre konnte nicht freigegeben werden: ${fehlertext(e)}`));
}

function log(msg: string) {
  const line = `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] ${msg}`;
  console.log(`  PriceJob: ${msg}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
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
  const vorhanden = await priceFromCache(k, setNumber, condition, currency, ttl);
  if (cacheUsable(vorhanden, ttl, k.uhr.jetzt())) return 'skipped';

  const rl = await k.externalSources.quotaFree('bricklink');
  if (!rl.allowed) return 'rate_limited';

  const fallback = condition === 'N' ? 'U' : 'N';
  let g: Awaited<ReturnType<typeof k.catalog.priceGuide>>;
  try {
    g = await k.catalog.priceGuide(setNumber, condition, guideType, currency);
  } catch (e) {
    if (e instanceof BricklinkNotReachable) return 'nicht_erreichbar';
    log(`Error ${setNumber} (${condition}): ${fehlertext(e).substring(0, 60)}`);
    return 'error';
  }

  // A response with nothing but zeros is written as well: it holds back the next run, otherwise
  // the same set would cost two fetches every time.
  const p = await savePrice(k, setNumber, condition, currency, g);

  if (!hatPrice({ avg_price: p.avg, qty_avg_price: p.qavg })) {
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
interface Laufstand {
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
async function pricePlacesJeAccount(k: FinancesContext): Promise<Map<number, string[]>> {
  const eigene = await k.preisLauf.inventoryPlaces();
  const gewuenschte = await versuche('preis-job:gewuenschte', k.preisLauf.wantedListsPlaces());
  if (!gewuenschte.ok) log('Merkliste nicht lesbar — nur eigene Sets');
  const jeAccount = new Map<number, string[]>();
  for (const r of [...eigene, ...(gewuenschte.ok ? gewuenschte.wert : [])].sort((a, b) => a.user_id - b.user_id)) {
    const liste = jeAccount.get(r.user_id) ?? [];
    if (!liste.includes(r.set_number)) liste.push(r.set_number);
    jeAccount.set(r.user_id, liste);
  }
  return jeAccount;
}

/** A set in all conditions it needs; the result counts in `st`. */
async function refreshSet(
  k: FinancesContext,
  sn: string,
  states: string[],
  currency: string,
  ttl: string,
  st: Laufstand,
) {
  let last = 'skipped';
  for (const c of states) {
    try {
      const r = await fetchAndCachePrice(k, sn, c, 'sold', currency, ttl);
      if (r === 'updated') {
        st.updated++;
        last = 'updated';
      } else if (r === 'rate_limited' || r === 'nicht_erreichbar') {
        const limit = r === 'rate_limited';
        if (limit ? !st.limitReached : !st.notReachable)
          log(
            `${limit ? 'BrickLink-Tageslimit erreicht' : 'BrickLink nicht erreichbar (Wartung)'} — die übrigen Sets folgen im nächsten Lauf`,
          );
        if (limit) st.limitReached = true;
        else st.notReachable = true;
        st.omitted++;
        return 'rate_limited';
      } else if (last !== 'updated') st.skipped++;
    } catch (e) {
      st.errors++;
      log(`Error ${sn} (${c}): ${fehlertext(e).substring(0, 80)}`);
      last = 'error';
    }
  }
  return last;
}

/** 'sold' = prices actually achieved in the last six months; five sets in parallel. */
async function refreshAccount(
  kx: FinancesContext,
  userId: number,
  setNumbers: string[],
  st: Laufstand,
  k?: JobContext,
) {
  const currency = await kx.einstellungen.userValue(userId, 'currency', 'EUR');
  const ttlHours = (await kx.einstellungen.globalValue('price_cache_ttl', '24')) || '24';
  const valid = setNumbers.filter(sn => /^[a-zA-Z0-9]+-\d+$/.test(sn));
  // Three queries per account instead of per set.
  const states = await statesJeSet(kx, userId, valid);
  const tasks = valid.map(sn => async () => {
    st.current++;
    k?.signal.throwIfAborted();
    if (st.limitReached || st.notReachable) {
      st.omitted++;
      return 'rate_limited';
    }
    if (k && st.current % 10 === 1)
      await k.fortschritt({ erledigt: st.current, gesamt: st.total, text: `${sn} (${st.current}/${st.total})` });
    return refreshSet(kx, sn, states.get(sn) ?? ['N'], currency, ttlHours, st);
  });
  await parallelLimit(tasks, 5);
}

/** Once per run, not per fetch; a failure is recorded in the state, throwing it would repeat the whole run. */
async function afterTheRun(k: FinancesContext, auftrag?: JobContext) {
  log('Writing daily price_history snapshot from price_cache...');
  const stand = await versuche('preis-job:tagesstand', k.preisLauf.writeDailyStatus());
  if (stand.ok) log(`Daily snapshot: ${stand.wert} price history entries inserted`);
  const alarme = await versuche('preis-job:preisalarme', async () => {
    const wartende = await k.preisLauf.setsWithAlarm();
    let gemeldet = 0;
    for (const sn of wartende) gemeldet += await checkSet(k, sn, k.mail);
    if (wartende?.length) log(`Preisalarm: ${wartende.length} Sets geprueft, ${gemeldet} gemeldet`);
  });
  const ohne = [stand.ok ? null : 'tagesstand', alarme.ok ? null : 'preisalarme'].filter(x => x !== null);
  if (ohne.length) await auftrag?.fortschritt({ text: `ohne ${ohne.join(', ')}`, ohne });
}

async function reportResult(kx: FinancesContext, st: Laufstand, duration: number, k?: JobContext) {
  const grund = st.notReachable ? 'BrickLink nicht erreichbar' : 'Tageslimit';
  log(
    `Done: ${st.updated} updated, ${st.skipped} skipped, ${st.errors} errors${st.omitted ? `, ${st.omitted} wegen ${grund} ausgelassen` : ''} — ${(duration / 1000).toFixed(1)}s`,
  );
  await rememberStatus(kx, {
    lastRun: kx.uhr.datum().toISOString(),
    lastDuration: duration,
    lastUpdated: st.updated,
    lastErrors: st.errors,
  });
  await k?.fortschritt({
    erledigt: st.total,
    gesamt: st.total,
    text: `${st.updated} aktualisiert, ${st.errors} Fehler — ${(duration / 1000).toFixed(1)}s`,
  });
}

/** If another process holds the lock, the job is retried one minute later. */
async function runPriceRefresh(kx: FinancesContext, k?: JobContext) {
  if (!(await kx.einstellungen.globalValue('bricklink_consumer_key', ''))) {
    log('BrickLink credentials not configured, skipping');
    await rememberStatus(kx, {});
    return;
  }
  const releaseLock = await acquireRunLock(kx);
  if (!releaseLock) throw new JobMove(new Date(kx.uhr.jetzt() + 60_000), 'Läuft bereits in einem anderen Prozess');
  const t0 = kx.uhr.jetzt();
  const st: Laufstand = { updated: 0, skipped: 0, errors: 0, omitted: 0, current: 0, total: 0 };
  await k?.fortschritt({ erledigt: 0, gesamt: 0, text: 'Starte…' });
  try {
    const jeAccount = await pricePlacesJeAccount(kx);
    st.total = [...jeAccount.values()].reduce((n, l) => n + l.length, 0);
    if (!st.total) {
      log('No sets, nothing to do');
      await rememberStatus(kx, { lastRun: kx.uhr.datum().toISOString() });
      return;
    }
    log(`Starting: ${st.total} set-slots`);
    await k?.fortschritt({ erledigt: 0, gesamt: st.total, text: `0/${st.total} Sets` });
    for (const [userId, setNumbers] of jeAccount) await refreshAccount(kx, userId, setNumbers, st, k);
    await reportResult(kx, st, kx.uhr.jetzt() - t0, k);
    await afterTheRun(kx, k);
  } catch (e) {
    log(`Fatal: ${fehlertext(e)}`);
    await rememberStatus(kx, {});
    throw e;
  } finally {
    await releaseLock(); // MUST stay here: otherwise a crashed run blocks the lock
  }
}

/** Mixed sets need both prices, pure ones one; one version for nightly run and capture.
 * @param hintCondition condition of an acquisition that does not exist yet */
async function statesJeSet(
  k: FinancesContext,
  userId: number,
  setNumbers: string[],
  hintCondition: string | null = null,
): Promise<Map<string, string[]>> {
  const ergebnis = new Map<string, string[]>();
  if (!setNumbers.length) return ergebnis;

  type StateRow = { set_number: string; c?: string | null };
  const collect = async (abfrage: Promise<StateRow[]>): Promise<Map<string, Set<string>>> => {
    // No catch: without the conditions every set would fall back to 'N', and the used price would be silently missing.
    const zeilen = await abfrage;
    const m = new Map<string, Set<string>>();
    for (const r of zeilen) {
      if (!m.has(r.set_number)) m.set(r.set_number, new Set<string>());
      m.get(r.set_number)!.add(zustand(r.c));
    }
    return m;
  };

  const erfasst = await collect(k.preisLauf.recordedStates(userId, setNumbers));
  const gewuenscht = await collect(k.preisLauf.desiredStates(userId, setNumbers));

  for (const sn of setNumbers) {
    // Without an acquisition the hint is the only source: the new set's acquisition is not yet
    // written (conditionsNeededFor).
    const eigene = new Set<string>(erfasst.get(sn) ?? []);
    if (hintCondition === 'U' || hintCondition === 'N') eigene.add(hintCondition);
    for (const c of gewuenscht.get(sn) ?? []) eigene.add(c);
    ergebnis.set(sn, eigene.size ? [...eigene] : ['N']);
  }
  return ergebnis;
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
  return (await statesJeSet(k, userId, [setNumber], hintCondition)).get(setNumber) ?? ['N'];
}

async function preisFuerSetHolen(
  k: FinancesContext,
  setNumber: string,
  userId: number,
  hintCondition: string | null = null,
) {
  if (!/^[a-zA-Z0-9]+-\d+$/.test(setNumber)) {
    log(`Skipping invalid: ${setNumber}`);
    return;
  }
  const ck = await k.einstellungen.globalValue('bricklink_consumer_key', '');
  if (!ck) return;
  try {
    const currency = await k.einstellungen.userValue(userId, 'currency', 'EUR');
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
      fehlertext(e).includes('timeout') || fehlertext(e).includes('terminated') || fehlertext(e).includes('connect');
    if (!isConnErr) log(`Immediate price failed for ${setNumber}: ${fehlertext(e).substring(0, 80)}`);
  }
}

async function rememberStatus(k: FinancesContext, neu: Record<string, unknown>): Promise<void> {
  const alt = await k.jobQueue.liesZustand(PRICE_STATUS).then(
    r => (r ? JSON.parse(r) : {}),
    () => ({}),
  );
  await k.jobQueue
    .setzeZustand(PRICE_STATUS, JSON.stringify({ ...alt, ...neu, log: _log.slice(0, 15) }))
    .catch(logAndContinue('preis-job:stand'));
}

export { runPriceRefresh, preisFuerSetHolen, fetchAndCachePrice, statesJeSet, conditionsNeededFor };
