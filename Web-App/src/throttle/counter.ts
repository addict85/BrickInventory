/** Counter with fallback: when the database locks up, the process keeps counting in memory so
 * a brake doesn't end up wide open. It only counts per process; reported at most once per minute. */
import { errorMessage } from '../infra/error';
import { processWide } from '../infra/processWide';
import type { ThrottleContext } from './context';

export interface CounterState {
  count: number;
  waitMin: number;
  sinceLast: number;
}
export type State = CounterState & { laufend: number };

type Entry = { count: number; firstAt: number; lastAt: number | null; laufend: number };
const fallback = () => processWide('anmeldeRueckfall', () => ({ eintraege: new Map<string, Entry>(), reportedAt: 0 }));
const MEMORY_AT_MOST = 5000;

function inMemory(wo: string, e: unknown): void {
  const r = fallback();
  if (Date.now() - r.reportedAt < 60_000) return;
  r.reportedAt = Date.now();
  console.warn(`[login] counter in process memory instead of the database (${wo}): ${errorMessage(e)}`);
}

function trim(windowMs: number): void {
  if (fallback().eintraege.size <= MEMORY_AT_MOST) return;
  const limit = Date.now() - windowMs;
  for (const [k, v] of fallback().eintraege) if (v.firstAt < limit) fallback().eintraege.delete(k);
}

const restMin = (firstAt: number, windowMin: number, now: number) =>
  Math.max(1, Math.ceil((firstAt + windowMin * 60000 - now) / 60000));

export async function counterState(k: ThrottleContext, key: string, windowMin: number): Promise<CounterState | null> {
  try {
    const row = await k.counter.read(key, windowMin);
    if (!row) return null;
    return {
      count: parseInt(row.count, 10) || 0,
      waitMin: Math.max(1, Math.ceil(parseFloat(row.wait_min) || 1)),
      sinceLast: Math.max(0, parseFloat(row.seit) || 0),
    };
  } catch (error) {
    inMemory('read', error);
    const e = fallback().eintraege.get(key);
    const now = k.uhr.jetzt();
    if (!e || now - e.firstAt > windowMin * 60000) return null;
    return {
      count: e.count,
      waitMin: restMin(e.firstAt, windowMin, now),
      sinceLast: (now - (e.lastAt ?? e.firstAt)) / 1000,
    };
  }
}

/** A failed attempt: counts it and frees the occupied slot. @returns the new state */
export async function countAttempt(k: ThrottleContext, key: string, windowMin: number): Promise<number> {
  try {
    return await k.counter.increase(key, windowMin);
  } catch (error) {
    inMemory('count', error);
    const now = k.uhr.jetzt();
    const e = fallback().eintraege.get(key);
    if (!e || now - e.firstAt > windowMin * 60000)
      fallback().eintraege.set(key, { count: 1, firstAt: now, lastAt: now, laufend: 0 });
    else {
      e.count++;
      e.lastAt = now;
      e.laufend = Math.max(0, (e.laufend || 0) - 1);
    }
    trim(windowMin * 60000);
    return fallback().eintraege.get(key)?.count ?? 1;
  }
}

/** BEFORE the check, under a row lock: concurrent attempts see one another. */
export async function reserve(
  k: ThrottleContext,
  key: string,
  windowMin: number,
  decayS: number,
  allowed: (s: State) => boolean,
): Promise<{ ok: boolean; stand: State }> {
  try {
    return await k.transact(async t => {
      const r = await t.counter.lock(key, windowMin, decayS);
      const fresh = !!r.abgelaufen;
      const s: State = {
        count: fresh ? 0 : parseInt(r.count, 10) || 0,
        laufend: r.laufend_alt ? 0 : parseInt(r.ongoing, 10) || 0,
        waitMin: fresh ? windowMin : Math.max(1, Math.ceil(parseFloat(r.wait_min) || 1)),
        sinceLast: Math.max(0, parseFloat(r.seit) || 0),
      };
      if (!allowed(s)) return { ok: false, stand: s };
      await t.counter.occupySlot(key, s.laufend + 1, fresh);
      return { ok: true, stand: s };
    });
  } catch (error) {
    inMemory('reserve', error);
    // In process memory this block without await is atomic.
    const now = k.uhr.jetzt();
    let e = fallback().eintraege.get(key);
    if (!e || now - e.firstAt > windowMin * 60000) {
      e = { count: 0, firstAt: now, lastAt: null, laufend: 0 };
      fallback().eintraege.set(key, e);
    }
    const s: State = {
      count: e.count,
      laufend: e.laufend || 0,
      waitMin: restMin(e.firstAt, windowMin, now),
      sinceLast: (now - (e.lastAt ?? e.firstAt)) / 1000,
    };
    if (!allowed(s)) return { ok: false, stand: s };
    e.laufend = s.laufend + 1;
    trim(windowMin * 60000);
    return { ok: true, stand: s };
  }
}

export async function releaseSlot(k: ThrottleContext, key: string): Promise<void> {
  try {
    await k.counter.freeSlot(key);
  } catch (error) {
    inMemory('release', error);
    const e = fallback().eintraege.get(key);
    if (e) e.laufend = Math.max(0, (e.laufend || 0) - 1);
  }
}

/** With `alsoBelow` also every counter `key|…`: the daily limit counts separate rows per address. */
export async function forgetCounter(k: ThrottleContext, key: string, o: { alsoBelow?: boolean } = {}): Promise<void> {
  try {
    await k.counter.deleteCounter(key);
    if (o.alsoBelow) await k.counter.deleteCountersWithPrefix(`${key}|`);
  } catch (e) {
    inMemory('delete', e);
    fallback().eintraege.delete(key);
    if (o.alsoBelow)
      for (const n of fallback().eintraege.keys()) if (n.startsWith(`${key}|`)) fallback().eintraege.delete(n);
  }
}

/** In one step, otherwise concurrent requests slipped through. Rejected ones count but don't extend the window. */
export async function countInWindow(
  k: ThrottleContext,
  key: string,
  windowMin: number,
): Promise<{ count: number; waitMin: number }> {
  try {
    const r = await k.counter.countUp(key, windowMin);
    return { count: parseInt(r.count, 10) || 0, waitMin: Math.max(1, Math.ceil(parseFloat(r.wait_min) || 1)) };
  } catch (error) {
    inMemory('request', error);
    const now = k.uhr.jetzt();
    let e = fallback().eintraege.get(key);
    if (!e || now - e.firstAt > windowMin * 60000) {
      e = { count: 0, firstAt: now, lastAt: now, laufend: 0 };
      fallback().eintraege.set(key, e);
    }
    e.count++;
    e.lastAt = now;
    trim(windowMin * 60000);
    return { count: e.count, waitMin: restMin(e.firstAt, windowMin, now) };
  }
}

/** Every unknown name creates a row; without cleanup the table would grow with every attempt. */
export function cleanUp(k: ThrottleContext, knownMin: number): Promise<number> {
  return k.counter.deleteOldCounters(knownMin);
}

/** Count and return state in one statement, so two requests can't both get through. @returns whether the day was free */
export async function oncePerDay(k: ThrottleContext, key: string): Promise<boolean> {
  return !!(await k.counter.countOncePerDay(key));
}
