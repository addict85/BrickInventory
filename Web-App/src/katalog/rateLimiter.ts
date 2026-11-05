/** Rebrickable erlaubt im Mittel einen Aufruf je Sekunde; ein 429 nennt die
 * Wartezeit, und genau so lange wird zurückgehalten. */
export class RateLimiter {
  maxRequests: number;
  windowMs: number;
  lastCall: number;
  queue: Array<() => void>;
  _scheduled: boolean;
  takt: { api: string; abstandMs: number } | null;

  /** @param takt Prozessübergreifender Takt (Tabelle api_takt); ohne ihn
   *             drosselt die Instanz nur sich selbst. */
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
      if (this.queue.length) this._schedule();
    }, wait);
  }

  throttle(waitMs: number) {
    this.lastCall = Date.now() + waitMs - this.windowMs;
    if (this.takt) taktAussetzen(this.takt.api, waitMs);
    if (!this._scheduled && this.queue.length) this._schedule();
  }

  get status() {
    return { limit: this.maxRequests, window: this.windowMs, queued: this.queue.length };
  }
}

import { meldeUndWeiter, meldeUndLiefere } from '../infra/fehler';
import { checkAndIncrementRateLimit, getRateLimitStatus, REBRICKABLE_DEFAULT_DAILY } from './apiKontingent';
import * as repo from './repository/apiTakt';

// Nach einem Datenbankfehler eine Minute ohne gemeinsamen Takt: Jeder Aufruf
// liefe sonst erst in den Verbindungs-Timeout. Die eigene Drossel bleibt.
let taktGestoertBis = 0;

/** Ein einziges UPDATE schiebt den Zeitpunkt weiter — zwei Prozesse bekommen
 * nie denselben Platz, ohne dass einer eine Sperre hält, während er wartet. */
export async function warteAufTakt(api: string, abstandMs: number): Promise<void> {
  if (Date.now() < taktGestoertBis) return;
  try {
    const r = await repo.belegeTakt(api, abstandMs);
    const warte = Math.ceil(Number(r?.warte_ms) || 0);
    if (warte > 0) await new Promise(res => setTimeout(res, warte));
  } catch (e) {
    taktGestoertBis = Date.now() + 60_000;
    meldeUndWeiter('drossel:gemeinsamer-takt', e);
  }
}

/** Ein 429 gilt für alle Prozesse. */
function taktAussetzen(api: string, waitMs: number) {
  if (Date.now() < taktGestoertBis) return;
  repo.schiebeTakt(api, waitMs)
    .catch(e => meldeUndWeiter('drossel:takt-aussetzen', e));
}

// Ein Aufruf je Sekunde für ALLE Prozesse zusammen; die Drosseln ordnen nur
// innerhalb des Prozesses, den Abstand hält der gemeinsame Takt.
const REBRICKABLE_TAKT = { api: 'rebrickable', abstandMs: 1000 };
export const rebrickableLimiter = new RateLimiter(1, 1500, REBRICKABLE_TAKT);
export const rebrickableBackgroundLimiter = new RateLimiter(1, 1500, REBRICKABLE_TAKT);

// Ausführlich: docs/begruendungen/src/katalog/rateLimiter.ts.md#consumerebrickabledaily
export async function consumeRebrickableDaily(): Promise<boolean> {
  const rl = await checkAndIncrementRateLimit('rebrickable').catch(meldeUndLiefere('takt:checkAndIncrementRateLimit', null));
  // Im Zweifel durchlassen: Ein überschrittenes Tageskontingent kostet bloss
  // Aufrufe — umgekehrt als beim Login-Zähler, wo der Rückfall sperrt.
  return rl ? rl.allowed : true;
}

export async function rebrickableDailyStatus(): Promise<{ count: number; limit: number; remaining: number }> {
  return getRateLimitStatus('rebrickable')
    .catch(() => ({ count: 0, limit: REBRICKABLE_DEFAULT_DAILY, remaining: 0 }));
}

/** Zwei gleichzeitige Downloads, aber höchstens einer neu je Sekunde: Das CDN
 * verträgt etwas Parallelität, keinen Ansturm. */
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
  }

  _start() {
    if (!this.queue.length || this.active >= this.maxConcurrent) return;
    this.active++;
    this.lastStart = Date.now();
    const resolve = this.queue.shift();
    // Die Länge ist im Wächter am Methodenanfang geprüft.
    if (resolve) resolve();
    if (this.queue.length && this.active < this.maxConcurrent) {
      this._timer = setTimeout(() => { this._timer = null; this._drain(); }, this.intervalMs);
    }
  }
}

export const cdnImageLimiter = new ConcurrentRateLimiter(2, 1000);

export { REBRICKABLE_DEFAULT_DAILY };
