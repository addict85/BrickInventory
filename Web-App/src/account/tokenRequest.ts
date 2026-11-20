/** Wie ein neuer Gerätezugang heisst, gilt und was die Antwort über ihn sagt. */
import { tokenDigest, type TokenScope } from './deviceToken';
import type { AccountContext } from './context';

/** Feste Obergrenze ab Anmeldung; der Tausch erbt sie (putSuccessorAn), die App meldet dann ab. */
export const APP_MAX_DURATION_DAYS = 180;

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
export async function tokenDetails(k: AccountContext, klartext: string) {
  const z = await k.konten.tokenStand(tokenDigest(klartext));
  return z
    ? {
        scope: z.scope,
        expires_at: z.expires_at,
        hard_expires_at: z.hard_expires_at,
        never_expires: z.never_expires,
        rotated_at: z.rotated_at,
      }
    : null;
}
