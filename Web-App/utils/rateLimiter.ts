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
      resolve();
      // Schedule next if more waiting
      if (this.queue.length) this._schedule();
    }, wait);
  }

  // Call when a 429 is received — pauses queue for the specified duration
  throttle(waitMs) {
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

  setMax(newMax) { this.max = newMax; }

  tryConsume() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.date !== today) { this.date = today; this.count = 0; }
    if (this.count >= this.max) return false;
    this.count++;
    // Persist to DB so UI can display counts
    if (this.dbKey) {
      try {
        const db = require('../db/database');
        db.run('INSERT INTO global_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2',
          [`api_calls_${this.dbKey}`, String(this.count)]).catch(()=>{});
        db.run('INSERT INTO global_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2',
          [`api_calls_date_${this.dbKey}`, new Date().toISOString().slice(0,10)]).catch(()=>{});
      } catch(_) {}
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
const rebrickableLimiter = new RateLimiter(1, 1500);
// Secondary limiter: background enrichment jobs (parts catalog, BL IDs)
const rebrickableBackgroundLimiter = new RateLimiter(1, 1500);
// Tageskontingent Rebrickable. Nur der Rückfallwert, falls global_settings
// nichts sagt — die wirksame Grenze steht in api_limit_rebrickable und wird bei
// JEDEM Aufruf gelesen (getLimitForApi).
const REBRICKABLE_DEFAULT_DAILY = 25000;

/**
 * Einen Rebrickable-Aufruf vom Tageskontingent abziehen.
 *
 * ── Warum das nicht mehr über DailyLimiter läuft ────────────────────────────
 * Der Zähler lag in `this.count` — im Speicher EINES Prozesses. Der Server
 * läuft aber im Cluster: Jeder Worker legte seine eigene Instanz an und zählte
 * für sich bis zum Limit. Bei WORKERS = max(2, CPU-Kerne) waren auf einem
 * Vierkerner 100'000 Aufrufe möglich, wo 25'000 eingestellt sind.
 *
 * Die DB-Schreibvorgänge in tryConsume() täuschten Gemeinsamkeit vor, waren
 * aber `SET value = <lokaler Stand>`: Der letzte Worker überschrieb den Wert
 * des vorigen, statt zu addieren. Die Anzeige im Monitoring zeigte damit den
 * Stand eines beliebigen Workers, nicht die Summe — und nach einem Neustart
 * stand sie wieder auf 0, während der Tag weiterlief.
 *
 * Dasselbe war beim Login-Zähler schon einmal behoben worden
 * (utils/loginLimiter.ts: „bei N Cluster-Workern werden aus 5 Fehlversuchen
 * sonst N×5"), und für BrickLink und Brickset ist es von Anfang an richtig
 * gelöst: checkAndIncrementRateLimit() zählt in einer Transaktion mit
 * SELECT … FOR UPDATE, also einmal für die ganze Installation. Rebrickable war
 * die letzte der drei APIs mit einer eigenen Zählweise; jetzt gibt es nur noch
 * eine.
 *
 * Nebeneffekt: Das gespeicherte Limit muss nicht mehr beim Start in den
 * Speicher geladen (loadDailyLimitsFromDb) und beim Ändern per setMax()
 * nachgezogen werden.
 *
 * Der Kurzstrecken-Limiter (rebrickableLimiter, ein Aufruf je 1,5 s) bleibt
 * bewusst prozesslokal: Drosselung pro Prozess ist etwas anderes als ein
 * Tagesbudget.
 *
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
    resolve();
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
function parseThrottleWait(body) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    const match = data?.detail?.match(/(\d+)\s*second/);
    if (match) return parseInt(match[1]) * 1000 + 500; // add 500ms buffer
  } catch(_) {}
  return 5000; // default 5s
}

export { rebrickableLimiter, rebrickableBackgroundLimiter, consumeRebrickableDaily, rebrickableDailyStatus, cdnImageLimiter, RateLimiter, DailyLimiter, ConcurrentRateLimiter, parseThrottleWait, REBRICKABLE_DEFAULT_DAILY };
