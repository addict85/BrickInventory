/** The cache of verified device tokens. It saves two database round trips
 * per request because the app fires many requests in parallel when opening;
 * it may only apply as long as a revocation reliably reaches it. */
import type { TokenScope } from './repository/accesses';
import { reportAccessChange } from './accessChange';
import { processEvent } from '../infra/event';
import type { AccountContext } from './context';

/** Typed, because a mistyped field name yields `undefined` and that silently passes
 * as "no" in a security check. */
export interface TokenUser {
  user_id: number;
  username: string;
  is_admin?: boolean;
  /** The SLIDING deadline: "unused for this long". */
  expires_at?: string | Date | null;
  /** The FIXED deadline, if one was chosen with the QR code. `null` = none. */
  hard_expires_at?: string | Date | null;
  last_used?: string | Date | null;
  sliding?: boolean;
  never_expires?: boolean;
  scope: TokenScope;
  rotated_at?: string | Date | null;
  previous_token?: string | null;
  [k: string]: unknown;
}

export interface CacheEntry {
  user: TokenUser;
  cachedAt: number;
  dbKey: string;
  /** A write is already running; a second one would be the same. */
  schreibt?: boolean;
}

/** Upper bound for an entry; a revocation clears it immediately (NOTIFY). */
export const TOKEN_TTL_MS = 5 * 1000;

/** Per access: a token only applies in the database it comes from. `stand` counts
 * every clearing: a row read before a revocation does not get in afterwards. */
const store = (k: AccountContext) =>
  k.faecher.fach('tokenCache', () => ({ eintraege: new Map<string, CacheEntry>(), stand: 0, verteilt: false }));

function empty(k: AccountContext): void {
  const c = store(k);
  c.eintraege.clear();
  c.stand++;
  reportAccessChange();
}

function _pruneCache(k: AccountContext) {
  const { eintraege } = store(k);
  if (eintraege.size <= 200) return;
  const cutoff = k.uhr.jetzt() - TOKEN_TTL_MS;
  for (const [t, v] of eintraege) {
    if (v.cachedAt < cutoff) eintraege.delete(t);
  }
}

/** The state before reading, or null if the cache may not apply right now. */
export function cacheStand(k: AccountContext): number | null {
  return tokenCacheUsable(k) ? store(k).stand : null;
}

export function tokenFromCache(
  k: AccountContext,
  token: string,
  stand: number | null,
  now: number,
): CacheEntry | undefined {
  if (stand === null) return undefined;
  const hit = store(k).eintraege.get(token);
  return hit && now - hit.cachedAt < TOKEN_TTL_MS ? hit : undefined;
}

/** Only if no revocation came since reading. */
export function rememberEntry(k: AccountContext, token: string, entry: CacheEntry, stand: number | null): void {
  const c = store(k);
  if (stand !== null && stand === c.stand) c.eintraege.set(token, entry);
  _pruneCache(k);
}

export function forgetEntry(k: AccountContext, token: string): void {
  store(k).eintraege.delete(token);
}

/** So that the token becomes invalid immediately, not only after the cache expires. */
export function tokenForgotten(k: AccountContext, token: string | null | undefined): void {
  if (!token) return;
  const c = store(k);
  c.eintraege.delete(token);
  c.stand++;
  reportAccessChange();
  reportRevocation(k);
}

/** Every web process keeps its own cache; a revocation clears it in all of them.
 * Without a standing listen connection a foreign revocation would not arrive: then
 * only the database counts (fail closed). */
const REVOCATION_CHANNEL = 'token_widerrufen';
const revocation = (k: AccountContext) =>
  k.faecher.fach('tokenWiderruf', () => {
    const e = processEvent('tokenWiderruf', REVOCATION_CHANNEL);
    e.horche(() => empty(k));
    return e;
  });
export function listenOnTokenRevocation(k: AccountContext): void {
  store(k).verteilt = true;
  revocation(k).connect(k.db.notification);
}
function tokenCacheUsable(k: AccountContext): boolean {
  if (store(k).verteilt && k.db.notification.listensTo(REVOCATION_CHANNEL)) return true;
  empty(k);
  return false;
}
function reportRevocation(k: AccountContext): void {
  if (store(k).verteilt) void revocation(k).melde(k.db.notification);
}

/** For deletions without plaintext (token management only knows the
 * hash prefix). Only the web process holds the cache. */
export function emptyTokenCache(k: AccountContext): void {
  empty(k);
  reportRevocation(k);
}
