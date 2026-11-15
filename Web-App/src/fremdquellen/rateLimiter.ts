import { systemUhr, type Uhr } from '../infra/uhr';

/** Rebrickable erlaubt im Mittel einen Aufruf je Sekunde; ein 429 nennt die
 * Wartezeit, und genau so lange wird zurückgehalten. */
export class RateLimiter {
  maxRequests: number;
  windowMs: number;
  lastCall: number;
  queue: Array<() => void>;
  _scheduled: boolean;
  takt: Takt | null;
  uhr: Uhr;

  /** @param takt Prozessübergreifender Takt (Tabelle api_takt); ohne ihn
   *             drosselt die Instanz nur sich selbst. */
  constructor(maxRequests: number, windowMs: number, takt: Takt | null = null, uhr: Uhr = systemUhr) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.lastCall = 0; // timestamp of last allowed call
    this.queue = []; // pending {resolve} entries
    this._scheduled = false;
    this.takt = takt;
    this.uhr = uhr;
  }

  async waitForSlot() {
    await new Promise<void>(resolve => {
      this.queue.push(resolve);
      this._schedule();
    });
    if (this.takt) await warteAufTakt(this.takt);
  }

  _schedule() {
    if (this._scheduled || !this.queue.length) return;
    this._scheduled = true;
    const now = this.uhr.jetzt();
    const next = this.lastCall + this.windowMs;
    const wait = Math.max(0, next - now);
    setTimeout(() => {
      this._scheduled = false;
      if (!this.queue.length) return;
      this.lastCall = this.uhr.jetzt();
      const resolve = this.queue.shift();
      // this.queue.length ist zwei Zeilen vorher geprüft; shift() weiss das nicht.
      if (resolve) resolve();
      if (this.queue.length) this._schedule();
    }, wait);
  }

  throttle(waitMs: number) {
    this.lastCall = this.uhr.jetzt() + waitMs - this.windowMs;
    if (this.takt) taktAussetzen(this.takt, waitMs);
    if (!this._scheduled && this.queue.length) this._schedule();
  }

  get status() {
    return { limit: this.maxRequests, window: this.windowMs, queued: this.queue.length };
  }
}

import { meldeFehler } from '../infra/fehler';
import { kontingentPruefenUndZaehlen, REBRICKABLE_DEFAULT_DAILY } from './apiKontingent';
import { versuche } from '../infra/ergebnis';
import type { FremdquellenKontext } from './kontext';

/** Ein einziges UPDATE schiebt den Zeitpunkt weiter — zwei Prozesse bekommen
 * nie denselben Platz, ohne dass einer eine Sperre hält, während er wartet. */
export async function warteAufTakt(takt: Takt): Promise<void> {
  const { api, abstandMs, apiTakt, uhr = systemUhr } = takt;
  if (uhr.jetzt() < takt.gestoertBis) return;
  try {
    const r = await apiTakt.belegeTakt(api, abstandMs);
    const warte = Math.ceil(Number(r?.warte_ms) || 0);
    if (warte > 0) await new Promise(res => setTimeout(res, warte));
  } catch (e) {
    takt.gestoertBis = uhr.jetzt() + 60_000;
    meldeFehler('drossel:gemeinsamer-takt', e);
  }
}

/** Ein 429 gilt für alle Prozesse. */
function taktAussetzen({ api, apiTakt, gestoertBis, uhr = systemUhr }: Takt, waitMs: number) {
  if (uhr.jetzt() < gestoertBis) return;
  apiTakt.schiebeTakt(api, waitMs).catch(e => meldeFehler('drossel:takt-aussetzen', e));
}

/** Ein Aufruf je Sekunde für alle Prozesse zusammen: Die Drosseln ordnen nur im Prozess, den Abstand
 * hält der gemeinsame Takt (Tabelle api_takt). */
export interface Takt {
  api: string;
  abstandMs: number;
  apiTakt: FremdquellenKontext['apiTakt'];
  /** Nach einem Datenbankfehler eine Minute ohne gemeinsamen Takt: Jeder Aufruf liefe
   * sonst erst in den Verbindungs-Timeout. Die eigene Drossel bleibt. */
  gestoertBis: number;
  uhr?: Uhr;
}

/** Je Satz Dienste einmal (erzeugeFremdquellen): Vordergrund und Hintergrund teilen den Takt. */
export function rebrickableDrosseln(apiTakt: Takt['apiTakt'], uhr: Uhr) {
  const takt: Takt = { api: 'rebrickable', abstandMs: 1000, apiTakt, gestoertBis: 0, uhr };
  return { vordergrund: new RateLimiter(1, 1500, takt, uhr), hintergrund: new RateLimiter(1, 1500, takt, uhr) };
}

// Gezählt in der Datenbank: Je Prozess gezählt vervielfachte sich das Limit.
export async function consumeRebrickableDaily(k: FremdquellenKontext): Promise<boolean> {
  const rl = await versuche('takt:kontingentPruefenUndZaehlen', kontingentPruefenUndZaehlen(k, 'rebrickable'));
  // Im Zweifel durchlassen: Ein überschrittenes Tageskontingent kostet bloss
  // Aufrufe — umgekehrt als beim Login-Zähler, wo der Rückfall sperrt.
  return rl.ok ? rl.wert.allowed : true;
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
  uhr: Uhr;

  constructor(maxConcurrent: number, intervalMs: number, uhr: Uhr = systemUhr) {
    this.maxConcurrent = maxConcurrent; // max parallel requests in flight
    this.intervalMs = intervalMs; // min ms between starting new requests
    this.active = 0; // currently in-flight
    this.queue = []; // waiting resolvers
    this.lastStart = 0; // timestamp last request was started
    this._timer = null;
    this.uhr = uhr;
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
    const now = this.uhr.jetzt();
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
    this.lastStart = this.uhr.jetzt();
    const resolve = this.queue.shift();
    // Die Länge ist im Wächter am Methodenanfang geprüft.
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
