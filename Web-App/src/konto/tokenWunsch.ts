/** Wie ein neuer Gerätezugang heisst, gilt und was die Antwort über ihn sagt. */
import { hashToken, type TokenScope } from './geraeteToken';
import type { KontoKontext } from './kontext';

/** Feste Obergrenze ab Anmeldung; der Tausch erbt sie (legeNachfolgerAn), die App meldet dann ab. */
export const APP_HOECHSTDAUER_TAGE = 180;

/** Das Label steht in der Geräteliste; ohne Grenze lägen dort beliebig lange Zeilen. */
const LABEL_MAX = 100;

export function tokenLabel(roh: unknown, vorgabe: string): string {
  const text = typeof roh === 'string' ? roh.trim() : '';
  return text ? Array.from(text).slice(0, LABEL_MAX).join('') : vorgabe;
}

export function tokenScope(roh: unknown): TokenScope {
  return roh === 'voll' ? 'voll' : 'app';
}

/** `expires_at` ist die frühere der beiden Fristen, `null` nur bei „unbegrenzt". */
export async function tokenAngaben(k: KontoKontext, klartext: string) {
  const z = await k.konten.tokenStand(hashToken(klartext));
  return z
    ? {
        scope: z.scope,
        expires_at: z.expires_at,
        hard_expires_at: z.hard_expires_at,
        never_expires: z.never_expires,
        rotiert_am: z.rotiert_am,
      }
    : null;
}
