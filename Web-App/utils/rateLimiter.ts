/**
 * Rebrickable API Rate Limiter
 * Rules from https://rebrickable.com/api/v3/docs/:
 * - Average 1 request/second, with small burst allowance
 * - 429 response: {"detail": "Request was throttled. Expected available in X seconds."}
 * - On 429: parse wait time from response and back off
 */

class RateLimiter {
  maxRequests: number;
  windowMs: number;
  lastCall: number;
  queue: Array<() => void>;
  _scheduled: boolean;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs    = windowMs;
    this.lastCall    = 0;  // timestamp of last allowed call
    this.queue       = []; // pending {resolve} entries
    this._scheduled  = false;
  }

  waitForSlot() {
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
      this._schedule();
    });
  }

  _schedule() {
    if (this._scheduled || !this.queue.length) return;
    this._scheduled = true;
    const now  = Date.now();
    const next = this.lastCall + this.windowMs;
    const wait = Math.max(0, next - now);
    setTimeout(() => {
      this._scheduled = false;
      if (!this.queue.length) return;
      this.lastCall = Date.now();
      const resolve = this.queue.shift();
      // this.queue.length ist zwei Zeilen vorher geprüft; shift() weiss das nicht.
      if (resolve) resolve();
      // Schedule next if more waiting
      if (this.queue.length) this._schedule();
    }, wait);
  }

  // Call when a 429 is received — pauses queue for the specified duration
  throttle(waitMs: number) {
    this.lastCall = Date.now() + waitMs - this.windowMs;
    // Re-schedule in case queue is waiting
    if (!this._scheduled && this.queue.length) this._schedule();
  }

  get status() {
    return { limit: this.maxRequests, window: this.windowMs, queued: this.queue.length };
  }
}

class DailyLimiter {
  max: number;
  dbKey: string | null;
  date: string;
  count: number;

  constructor(maxPerDay: number, dbKey?: string) {
    this.max   = maxPerDay;
    this.dbKey = dbKey || null;
    this.date  = '';
    this.count = 0;
  }

  setMax(newMax: number) { this.max = newMax; }

  tryConsume() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.date !== today) { this.date = today; this.count = 0; }
    if (this.count >= this.max) return false;
    this.count++;
    // Persist to DB so UI can display counts.
    // Das frühere `const db = require(...)` ist weg: Seit der Schreibweg über
    // setGlobalSetting() läuft, greift hier keine SQL-Anweisung mehr direkt zu.
    if (this.dbKey) {
      try {
        setGlobalSetting(`api_calls_${this.dbKey}`, String(this.count)).catch(()=>{});
        setGlobalSetting(`api_calls_date_${this.dbKey}`, new Date().toISOString().slice(0, 10)).catch(()=>{});
      } catch (e) { meldeUndWeiter('kontingent:zaehler-schreiben', e); }
    }
    return true;
  }

  get status() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.date !== today) return { count: 0, max: this.max, remaining: this.max };
    return { count: this.count, max: this.max, remaining: this.max - this.count };
  }
}

// Primary limiter: CSV import, set info, image downloads (foreground)
import { meldeUndWeiter } from './httpError';
import { setGlobalSetting } from '../utils/settings';

const rebrickableLimiter = new RateLimiter(1, 1500);
// Secondary limiter: background enrichment jobs (parts catalog, BL IDs)
const rebrickableBackgroundLimiter = new RateLimiter(1, 1500);
// Tageskontingent Rebrickable. Nur der Rückfallwert, falls global_settings
// nichts sagt — die wirksame Grenze steht in api_limit_rebrickable und wird bei
// JEDEM Aufruf gelesen (getLimitForApi).
const REBRICKABLE_DEFAULT_DAILY = 25000;

/**
 * Einen Rebrickable-Aufruf vom Tageskontingent abziehen.
 * Ausführlich: docs/begruendungen/utils/rateLimiter.ts.md#consumerebrickabledaily
 * @returns true, wenn der Aufruf erlaubt ist (und gezählt wurde)
 */
async function consumeRebrickableDaily(): Promise<boolean> {
  // Lazy require: utils/financeCalc zieht viel nach sich, ein Import auf
  // Modulebene ergäbe einen Zyklus.
  const { checkAndIncrementRateLimit } = require('./financeCalc');
  const rl = await checkAndIncrementRateLimit('rebrickable').catch(() => null);
  // Im Zweifel durchlassen: Ein Datenbankproblem darf nicht dazu führen, dass
  // gar nichts mehr geladen wird. Umgekehrte Abwägung als beim Login-Zähler —
  // dort sperrt der Rückfall, hier öffnet er, weil ein überschrittenes
  // Tageskontingent bloss Aufrufe kostet.
  return rl ? rl.allowed : true;
}

/** Stand des Rebrickable-Tageskontingents — für Meldungen und Anzeige. */
async function rebrickableDailyStatus(): Promise<{ count: number; limit: number; remaining: number }> {
  const { getRateLimitStatus } = require('./financeCalc');
  return getRateLimitStatus('rebrickable')
    .catch(() => ({ count: 0, limit: REBRICKABLE_DEFAULT_DAILY, remaining: 0 }));
}

/**
 * CDN image download limiter: max 1 new request per second, up to 2 running concurrently.
 * Unlike RateLimiter (strict sequential), this allows 2 simultaneous downloads while
 * still throttling throughput to 1 new download per 1000ms.
 */
class ConcurrentRateLimiter {
  maxConcurrent: number;
  intervalMs: number;
  active: number;
  queue: Array<() => void>;
  lastStart: number;
  _timer: NodeJS.Timeout | null;

  constructor(maxConcurrent: number, intervalMs: number) {
    this.maxConcurrent = maxConcurrent; // max parallel requests in flight
    this.intervalMs    = intervalMs;    // min ms between starting new requests
    this.active        = 0;            // currently in-flight
    this.queue         = [];           // waiting resolvers
    this.lastStart     = 0;            // timestamp last request was started
    this._timer        = null;
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
    const now  = Date.now();
    const wait = Math.max(0, this.lastStart + this.intervalMs - now);
    const canStart = this.active < this.maxConcurrent;
    if (canStart && wait === 0) {
      this._start();
    } else if (canStart) {
      this._timer = setTimeout(() => { this._timer = null; this._drain(); }, wait);
    }
    // If at concurrency limit, release() will trigger _drain again
  }

  _start() {
    if (!this.queue.length || this.active >= this.maxConcurrent) return;
    this.active++;
    this.lastStart = Date.now();
    const resolve = this.queue.shift();
    // Wie oben: die Länge ist im Wächter am Methodenanfang geprüft.
    if (resolve) resolve();
    // If there are more queued and concurrency allows, schedule next
    if (this.queue.length && this.active < this.maxConcurrent) {
      this._timer = setTimeout(() => { this._timer = null; this._drain(); }, this.intervalMs);
    }
  }
}

// CDN image limiter: 2 concurrent, 1 new per second
const cdnImageLimiter = new ConcurrentRateLimiter(2, 1000);

/**
 * Parse throttle wait time from Rebrickable 429 response body.
 * Response: {"detail": "Request was throttled. Expected available in 2 seconds."}
 */
function parseThrottleWait(body: string) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    const match = data?.detail?.match(/(\d+)\s*second/);
    if (match) return parseInt(match[1]) * 1000 + 500; // add 500ms buffer
  } catch (e) { meldeUndWeiter('kontingent:retry-after-lesen', e); }
  return 5000; // default 5s
}

export { rebrickableLimiter, rebrickableBackgroundLimiter, consumeRebrickableDaily, rebrickableDailyStatus, cdnImageLimiter, RateLimiter, DailyLimiter, ConcurrentRateLimiter, parseThrottleWait, REBRICKABLE_DEFAULT_DAILY };
