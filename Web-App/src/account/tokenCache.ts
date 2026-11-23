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
  writing?: boolean;
}

/** Upper bound for an entry; a revocation clears it immediately (NOTIFY). */
export const TOKEN_TTL_MS = 5 * 1000;

/** Per access: a token only applies in the database it comes from. `stand` counts
 * every clearing: a row read before a revocation does not get in afterwards. */
const store = (k: AccountContext) =>
  k.compartments.slot('tokenCache', () => ({ entries: new Map<string, CacheEntry>(), state: 0, distributed: false }));

function empty(k: AccountContext): void {
  const c = store(k);
  c.entries.clear();
  c.state++;
  reportAccessChange();
}

function _pruneCache(k: AccountContext) {
  const { entries } = store(k);
  if (entries.size <= 200) return;
  const cutoff = k.clock.now() - TOKEN_TTL_MS;
  for (const [t, v] of entries) {
    if (v.cachedAt < cutoff) entries.delete(t);
  }
}

/** The state before reading, or null if the cache may not apply right now. */
export function cacheState(k: AccountContext): number | null {
  return tokenCacheUsable(k) ? store(k).state : null;
}

export function tokenFromCache(
  k: AccountContext,
  token: string,
  state: number | null,
  now: number,
): CacheEntry | undefined {
  if (state === null) return undefined;
  const hit = store(k).entries.get(token);
  return hit && now - hit.cachedAt < TOKEN_TTL_MS ? hit : undefined;
}

/** Only if no revocation came since reading. */
export function rememberEntry(k: AccountContext, token: string, entry: CacheEntry, state: number | null): void {
  const c = store(k);
  if (state !== null && state === c.state) c.entries.set(token, entry);
  _pruneCache(k);
}

export function forgetEntry(k: AccountContext, token: string): void {
  store(k).entries.delete(token);
}

/** So that the token becomes invalid immediately, not only after the cache expires. */
export function tokenForgotten(k: AccountContext, token: string | null | undefined): void {
  if (!token) return;
  const c = store(k);
  c.entries.delete(token);
  c.state++;
  reportAccessChange();
  reportRevocation(k);
}

/** Every web process keeps its own cache; a revocation clears it in all of them.
 * Without a standing listen connection a foreign revocation would not arrive: then
 * only the database counts (fail closed). */
const REVOCATION_CHANNEL = 'token_widerrufen';
const revocation = (k: AccountContext) =>
  k.compartments.slot('tokenWiderruf', () => {
    const e = processEvent('tokenWiderruf', REVOCATION_CHANNEL);
    e.listen(() => empty(k));
    return e;
  });
export function listenOnTokenRevocation(k: AccountContext): void {
  store(k).distributed = true;
  revocation(k).connect(k.db.notification);
}
function tokenCacheUsable(k: AccountContext): boolean {
  if (store(k).distributed && k.db.notification.listensTo(REVOCATION_CHANNEL)) return true;
  empty(k);
  return false;
}
function reportRevocation(k: AccountContext): void {
  if (store(k).distributed) void revocation(k).report(k.db.notification);
}

/** For deletions without plaintext (token management only knows the
 * hash prefix). Only the web process holds the cache. */
export function emptyTokenCache(k: AccountContext): void {
  empty(k);
  reportRevocation(k);
}
