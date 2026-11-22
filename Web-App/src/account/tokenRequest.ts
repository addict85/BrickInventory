/** What a new device access is called, how long it applies and what the response says about it. */
import { tokenDigest, type TokenScope } from './deviceToken';
import type { AccountContext } from './context';

/** The label appears in the device list; without a limit it could hold arbitrarily long lines. */
const LABEL_MAX = 100;

export function tokenLabel(raw: unknown, defaultValue: string): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text ? Array.from(text).slice(0, LABEL_MAX).join('') : defaultValue;
}

export function tokenScope(raw: unknown): TokenScope {
  return raw === 'voll' ? 'voll' : 'app';
}

/** `expires_at` is the earlier of the two deadlines, `null` only for "unlimited". */
export async function tokenDetails(k: AccountContext, plaintext: string) {
  const z = await k.accounts.tokenStand(tokenDigest(plaintext));
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
