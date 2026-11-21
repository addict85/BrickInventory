/** What a new device access is called, how long it applies and what the response says about it. */
import { tokenDigest, type TokenScope } from './deviceToken';
import type { AccountContext } from './context';

/** Fixed upper bound from login; the swap inherits it (putSuccessorAn), the app then logs out. */
export const APP_MAX_DURATION_DAYS = 180;

/** The label appears in the device list; without a limit it could hold arbitrarily long lines. */
const LABEL_MAX = 100;

export function tokenLabel(roh: unknown, vorgabe: string): string {
  const text = typeof roh === 'string' ? roh.trim() : '';
  return text ? Array.from(text).slice(0, LABEL_MAX).join('') : vorgabe;
}

export function tokenScope(roh: unknown): TokenScope {
  return roh === 'voll' ? 'voll' : 'app';
}

/** `expires_at` is the earlier of the two deadlines, `null` only for "unlimited". */
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
