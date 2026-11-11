import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { neuerPool } from './bcryptPool';
import { konfig } from '../infra/konfig';

/** bcrypt mit 12 Runden kostet je Lauf rund 270 ms Rechenzeit. Die Bremsen je
 * Adresse und Konto helfen nicht gegen viele Adressen; diese Schranke hält die
 * Zahl gleichzeitiger Läufe fest, und wer zu lange warten müsste, bekommt 503. */
export class BcryptUeberlast extends Error {
  status = 503;
  code = 'server_ausgelastet' as const;
  constructor() { super('bcrypt: zu viele gleichzeitige Prüfungen'); }
}

export interface Schranke {
  /** vorrang: vorne in die Schlange und nie wegen ihrer Länge abgewiesen. */
  mit<T>(arbeit: () => Promise<T>, vorrang?: boolean): Promise<T>;
  stand(): { laufend: number; wartend: number };
}

export function neueSchranke(gleichzeitig: number, wartendHoechstens: number, wartezeitMs: number): Schranke {
  let laufend = 0;
  const warteschlange: (() => void)[] = [];
  const platz = (vorrang: boolean): Promise<void> => {
    if (laufend < gleichzeitig) { laufend++; return Promise.resolve(); }
    if (!vorrang && warteschlange.length >= wartendHoechstens) return Promise.reject(new BcryptUeberlast());
    return new Promise((weiter, abbrechen) => {
      const los = () => { clearTimeout(frist); weiter(); };
      const frist = setTimeout(() => {
        warteschlange.splice(warteschlange.indexOf(los), 1);
        abbrechen(new BcryptUeberlast());
      }, wartezeitMs);
      if (vorrang) warteschlange.unshift(los); else warteschlange.push(los);
    });
  };
  // Der freie Platz geht direkt an den nächsten Wartenden, `laufend` bleibt dann gleich.
  const frei = () => { const naechster = warteschlange.shift(); if (naechster) naechster(); else laufend--; };
  return {
    async mit(arbeit, vorrang = false) {
      await platz(vorrang);
      try { return await arbeit(); } finally { frei(); }
    },
    stand: () => ({ laufend, wartend: warteschlange.length }),
  };
}

/** Kerne laut cgroup-Kontingent (v2 cpu.max, v1 cfs_quota), null ohne Kontingent. */
export function kontingentKerne(wurzel = '/sys/fs/cgroup'): number | null {
  const lies = (f: string) => { try { return fs.readFileSync(path.join(wurzel, f), 'utf8').trim(); } catch { return ''; } };
  const [v2q, v2p] = lies('cpu.max').split(/\s+/);
  const [quote, periode] = v2q ? [Number(v2q), Number(v2p)] : [Number(lies('cpu/cpu.cfs_quota_us')), Number(lies('cpu/cpu.cfs_period_us'))];
  return quote > 0 && periode > 0 ? Math.max(1, Math.ceil(quote / periode)) : null;
}

/** Jeder Arbeiter belegt gut 12 MB; die Kerne des Hosts sagen nichts über das
 * Speicherlimit des Containers. BCRYPT_ARBEITER hebt die Vorgabe von 4 an. */
export function bcryptArbeiter(gesetzt = konfig().bcryptArbeiter, kerne = os.availableParallelism(),
                               kontingent = kontingentKerne()): number {
  return gesetzt ?? Math.max(2, Math.min(kerne, kontingent ?? kerne, 4));
}

const KERNE = bcryptArbeiter();
export const bcryptSchranke = neueSchranke(KERNE, KERNE * 8, 5000);
export const bcryptPool = neuerPool(KERNE);

export function passwortPasst(passwort: string | null | undefined, hash: string, vorrang = false): Promise<boolean> {
  return bcryptSchranke.mit(() => bcryptPool.vergleiche(String(passwort), hash), vorrang);
}
export function hashePasswort(passwort: string | null | undefined, runden: number): Promise<string> {
  return bcryptSchranke.mit(() => bcryptPool.hash(String(passwort), runden));
}
