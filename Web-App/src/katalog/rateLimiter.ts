/**
 * Rebrickable API Rate Limiter
 * Rules from https://rebrickable.com/api/v3/docs/:
 * - Average 1 request/second, with small burst allowance
 * - 429 response: {"detail": "Request was throttled. Expected available in X seconds."}
 * - On 429: parse wait time from response and back off
 */
export class RateLimiter {
  maxRequests: number;
  windowMs: number;
  lastCall: number;
  queue: Array<() => void>;
  _scheduled: boolean;
  takt: { api: string; abstandMs: number } | null;

  /**
   * @param takt Name und Mindestabstand eines prozessübergreifenden Takts
   *             (Tabelle api_takt). Ohne ihn drosselt die Instanz nur sich selbst.
   */
  constructor(maxRequests: number, windowMs: number, takt: { api: string; abstandMs: number } | null = null) {
    this.maxRequests = maxRequests;
    this.windowMs    = windowMs;
    this.lastCall    = 0;  // timestamp of last allowed call
    this.queue       = []; // pending {resolve} entries
    this._scheduled  = false;
    this.takt        = takt;
  }

  async waitForSlot() {
    await new Promise<void>(resolve => {
      this.queue.push(resolve);
      this._schedule();
    });
    if (this.takt) await warteAufTakt(this.takt.api, this.takt.abstandMs);
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
    if (this.takt) taktAussetzen(this.takt.api, waitMs);
    // Re-schedule in case queue is waiting
    if (!this._scheduled && this.queue.length) this._schedule();
  }

  get status() {
    return { limit: this.maxRequests, window: this.windowMs, queued: this.queue.length };
  }
}

// Primary limiter: CSV import, set info, image downloads (foreground)
import { meldeUndWeiter, meldeUndLiefere } from '../infra/httpError';
import { checkAndIncrementRateLimit, getRateLimitStatus, REBRICKABLE_DEFAULT_DAILY } from './apiKontingent';
import * as db from '../../db/database';

// Nach einem Datenbankfehler eine Minute lang ohne gemeinsamen Takt: Jeder
// Aufruf liefe sonst erst in den Verbindungs-Timeout. Die eigene Drossel
// bleibt in dieser Zeit wirksam.
let taktGestoertBis = 0;

/**
 * Den nächsten freien Zeitpunkt der Schnittstelle reservieren und abwarten.
 * Ein einziges UPDATE schiebt den Zeitpunkt weiter — zwei Prozesse bekommen so
 * nie denselben Platz, ohne dass einer eine Sperre hält, während er wartet.
 */
export async function warteAufTakt(api: string, abstandMs: number): Promise<void> {
  if (Date.now() < taktGestoertBis) return;
  try {
    const r = await db.get(
      `INSERT INTO api_takt (api, naechster) VALUES ($1, clock_timestamp() + make_interval(secs => $2 / 1000.0))
       ON CONFLICT (api) DO UPDATE
         SET naechster = GREATEST(api_takt.naechster, clock_timestamp()) + make_interval(secs => $2 / 1000.0)
       RETURNING GREATEST(0, EXTRACT(EPOCH FROM (naechster - clock_timestamp())) * 1000 - $2) AS warte_ms`,
      [api, abstandMs]);
    const warte = Math.ceil(Number(r?.warte_ms) || 0);
    if (warte > 0) await new Promise(res => setTimeout(res, warte));
  } catch (e) {
    taktGestoertBis = Date.now() + 60_000;
    meldeUndWeiter('drossel:gemeinsamer-takt', e);
  }
}

/** Ein 429 gilt für alle Prozesse: den gemeinsamen Zeitpunkt hinausschieben. */
function taktAussetzen(api: string, waitMs: number) {
  if (Date.now() < taktGestoertBis) return;
  db.run(`UPDATE api_takt SET naechster = GREATEST(naechster, clock_timestamp() + make_interval(secs => $2 / 1000.0))
           WHERE api = $1`, [api, waitMs])
    .catch(e => meldeUndWeiter('drossel:takt-aussetzen', e));
}

// Rebrickable erlaubt im Mittel einen Aufruf je Sekunde — für ALLE Prozesse
// zusammen. Die beiden Drosseln ordnen nur innerhalb des Prozesses; den
// Abstand untereinander und zu den anderen Prozessen hält der gemeinsame Takt.
const REBRICKABLE_TAKT = { api: 'rebrickable', abstandMs: 1000 };
export const rebrickableLimiter = new RateLimiter(1, 1500, REBRICKABLE_TAKT);
// Secondary limiter: background enrichment jobs (parts catalog, BL IDs)
export const rebrickableBackgroundLimiter = new RateLimiter(1, 1500, REBRICKABLE_TAKT);

/**
 * Einen Rebrickable-Aufruf vom Tageskontingent abziehen.
 * Ausführlich: docs/begruendungen/src/katalog/rateLimiter.ts.md#consumerebrickabledaily
 * @returns true, wenn der Aufruf erlaubt ist (und gezählt wurde)
 */
export async function consumeRebrickableDaily(): Promise<boolean> {
  const rl = await checkAndIncrementRateLimit('rebrickable').catch(meldeUndLiefere('takt:checkAndIncrementRateLimit', null));
  // Im Zweifel durchlassen: Ein Datenbankproblem darf nicht dazu führen, dass
  // gar nichts mehr geladen wird. Umgekehrte Abwägung als beim Login-Zähler —
  // dort sperrt der Rückfall, hier öffnet er, weil ein überschrittenes
  // Tageskontingent bloss Aufrufe kostet.
  return rl ? rl.allowed : true;
}

/** Stand des Rebrickable-Tageskontingents — für Meldungen und Anzeige. */
export async function rebrickableDailyStatus(): Promise<{ count: number; limit: number; remaining: number }> {
  return getRateLimitStatus('rebrickable')
    .catch(() => ({ count: 0, limit: REBRICKABLE_DEFAULT_DAILY, remaining: 0 }));
}

/**
 * CDN image download limiter: max 1 new request per second, up to 2 running concurrently.
 * Unlike RateLimiter (strict sequential), this allows 2 simultaneous downloads while
 * still throttling throughput to 1 new download per 1000ms.
 */
export class ConcurrentRateLimiter {
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
export const cdnImageLimiter = new ConcurrentRateLimiter(2, 1000);

/**
 * Parse throttle wait time from Rebrickable 429 response body.
 * Response: {"detail": "Request was throttled. Expected available in 2 seconds."}
 */
export function parseThrottleWait(body: string) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    const match = data?.detail?.match(/(\d+)\s*second/);
    if (match) return parseInt(match[1]) * 1000 + 500; // add 500ms buffer
  } catch (e) { meldeUndWeiter('kontingent:retry-after-lesen', e); }
  return 5000; // default 5s
}

export { REBRICKABLE_DEFAULT_DAILY };
