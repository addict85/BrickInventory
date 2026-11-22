import { systemClock, type Clock } from '../infra/clock';

/** Rebrickable allows one call per second on average; a 429 names the
 * waiting time, and exactly that long is held back. */
export class RateLimiter {
  maxRequests: number;
  windowMs: number;
  lastCall: number;
  queue: Array<() => void>;
  _scheduled: boolean;
  takt: Tick | null;
  clock: Clock;

  /** @param tick Cross-process tick (table api_takt); without it
   *             the instance only throttles itself. */
  constructor(maxRequests: number, windowMs: number, tick: Tick | null = null, clock: Clock = systemClock) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.lastCall = 0; // timestamp of last allowed call
    this.queue = []; // pending {resolve} entries
    this._scheduled = false;
    this.takt = tick;
    this.clock = clock;
  }

  async waitForSlot() {
    await new Promise<void>(resolve => {
      this.queue.push(resolve);
      this._schedule();
    });
    if (this.takt) await waitOnTick(this.takt);
  }

  _schedule() {
    if (this._scheduled || !this.queue.length) return;
    this._scheduled = true;
    const now = this.clock.now();
    const next = this.lastCall + this.windowMs;
    const wait = Math.max(0, next - now);
    setTimeout(() => {
      this._scheduled = false;
      if (!this.queue.length) return;
      this.lastCall = this.clock.now();
      const resolve = this.queue.shift();
      // this.queue.length is checked two lines before; shift() does not know that.
      if (resolve) resolve();
      if (this.queue.length) this._schedule();
    }, wait);
  }

  throttle(waitMs: number) {
    this.lastCall = this.clock.now() + waitMs - this.windowMs;
    if (this.takt) suspendTick(this.takt, waitMs);
    if (!this._scheduled && this.queue.length) this._schedule();
  }

  get status() {
    return { limit: this.maxRequests, window: this.windowMs, queued: this.queue.length };
  }
}

import { reportError } from '../infra/error';
import { checkAndCountQuota, REBRICKABLE_DEFAULT_DAILY } from './apiQuota';
import { attempts } from '../infra/result';
import type { ForeignSourcesContext } from './context';

/** A single UPDATE moves the point in time forward — two processes never get
 * the same slot, without one holding a lock while it waits. */
export async function waitOnTick(tick: Tick): Promise<void> {
  const { api, gapMs, apiTakt, clock = systemClock } = tick;
  if (clock.now() < tick.disruptedUntil) return;
  try {
    const r = await apiTakt.receiptsTick(api, gapMs);
    const wait = Math.ceil(Number(r?.warte_ms) || 0);
    if (wait > 0) await new Promise(res => setTimeout(res, wait));
  } catch (e) {
    tick.disruptedUntil = clock.now() + 60_000;
    reportError('drossel:gemeinsamer-takt', e);
  }
}

/** A 429 applies to all processes. */
function suspendTick({ api, apiTakt, disruptedUntil, clock = systemClock }: Tick, waitMs: number) {
  if (clock.now() < disruptedUntil) return;
  apiTakt.pushTick(api, waitMs).catch(e => reportError('drossel:takt-aussetzen', e));
}

/** One call per second for all processes together: the throttles only order within the process, the spacing
 * is kept by the shared tick (table api_takt). */
export interface Tick {
  api: string;
  gapMs: number;
  apiTakt: ForeignSourcesContext['apiTick'];
  /** After a database error one minute without a shared tick: otherwise every call would
   * first run into the connection timeout. The own throttle stays. */
  disruptedUntil: number;
  clock?: Clock;
}

/** Once per set of services (createForeignSources): foreground and background share the tick. */
export function throttleRebrickable(apiTakt: Tick['apiTakt'], clock: Clock) {
  const tick: Tick = { api: 'rebrickable', gapMs: 1000, apiTakt, disruptedUntil: 0, clock };
  return { foreground: new RateLimiter(1, 1500, tick, clock), hintergrund: new RateLimiter(1, 1500, tick, clock) };
}

// Counted in the database: counted per process, the limit would multiply.
export async function consumeRebrickableDaily(k: ForeignSourcesContext): Promise<boolean> {
  const rl = await attempts('takt:kontingentPruefenUndZaehlen', checkAndCountQuota(k, 'rebrickable'));
  // When in doubt let it through: an exceeded daily quota merely costs
  // calls — the opposite of the login counter, where the fallback locks.
  return rl.ok ? rl.wert.allowed : true;
}

/** Two concurrent downloads, but at most one new one per second: the CDN
 * tolerates some parallelism, not a rush. */
export class ConcurrentRateLimiter {
  maxConcurrent: number;
  intervalMs: number;
  active: number;
  queue: Array<() => void>;
  lastStart: number;
  _timer: NodeJS.Timeout | null;
  clock: Clock;

  constructor(maxConcurrent: number, intervalMs: number, clock: Clock = systemClock) {
    this.maxConcurrent = maxConcurrent; // max parallel requests in flight
    this.intervalMs = intervalMs; // min ms between starting new requests
    this.active = 0; // currently in-flight
    this.queue = []; // waiting resolvers
    this.lastStart = 0; // timestamp last request was started
    this._timer = null;
    this.clock = clock;
  }

  acquire() {
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
      this._drain();
    });
  }

  release() {
    this.active--;
    this._drain();
  }

  _drain() {
    if (this._timer || !this.queue.length) return;
    const now = this.clock.now();
    const wait = Math.max(0, this.lastStart + this.intervalMs - now);
    const canStart = this.active < this.maxConcurrent;
    if (canStart && wait === 0) {
      this._start();
    } else if (canStart) {
      this._timer = setTimeout(() => {
        this._timer = null;
        this._drain();
      }, wait);
    }
  }

  _start() {
    if (!this.queue.length || this.active >= this.maxConcurrent) return;
    this.active++;
    this.lastStart = this.clock.now();
    const resolve = this.queue.shift();
    // The length is checked in the guard at the start of the method.
    if (resolve) resolve();
    if (this.queue.length && this.active < this.maxConcurrent) {
      this._timer = setTimeout(() => {
        this._timer = null;
        this._drain();
      }, this.intervalMs);
    }
  }
}

export { REBRICKABLE_DEFAULT_DAILY };
