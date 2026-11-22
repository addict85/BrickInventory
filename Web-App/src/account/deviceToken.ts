/** Device tokens: issue, check, swap, revoke, clean up. */
import crypto from 'node:crypto';
import * as V from '../infra/validate';
import * as repo from './repository/accesses';
import type { TokenScope } from './repository/accesses';
import { hintInBackground } from './accountNotice';
import { countFailedAttempt, toManyFailedAttempts } from './tokenFailedAttempts';
import { inSystemContext } from '../infra/accountContext';
import {
  cacheState,
  tokenFromCache,
  rememberEntry,
  forgetEntry,
  tokenForgotten,
  emptyTokenCache,
  type CacheEntry,
  type TokenUser,
} from './tokenCache';
import type { AccountContext } from './context';
import { reportError } from '../infra/error';
import { failDomain } from '../infra/errorTexts';
import { attempts } from '../infra/result';

export type { TokenScope, TokenUser };

/** Whether the id (prefix of the stored hash) belongs to the token of the request. */
export function ownAccess(token: string | null, key: string): boolean {
  return !!token && tokenDigest(token).startsWith(key);
}

export function tokenDigest(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const TAG_MS = 86_400_000;

/** Device accesses have no fixed end; this deadline limits how long a
 * forgotten device stays valid. */

/** From 30 days on every response reports the rotation; an unlimited token only applies
 * to the swap after 60 days — so a stolen copy dies as soon as the
 * real device swaps, and a device that never swaps stands out. */
export const ROTATION_DUE_DAYS = 30;
export const ROTATION_REQUIRED_DAYS = 60;
/** In case the response of the swap gets lost. */
export const OVERLAP_MS = 5 * 60 * 1000;
/** This long after the end of the overlap an old token counts as a straggler, not as a copy. */
export const REUSE_GRACE_PERIOD_S = 60;

/** `null` means "unlimited", not "expired immediately". */
function deadlineReached(moment: string | Date | null | undefined, now: number): boolean {
  return !!moment && new Date(moment).getTime() <= now;
}

const daysSince = (moment: string | Date | null | undefined, now: number): number =>
  moment ? (now - new Date(moment).getTime()) / TAG_MS : 0;

export function rotationDue(u: TokenUser, now = Date.now()): boolean {
  return daysSince(u.rotated_at, now) >= ROTATION_DUE_DAYS;
}

export function rotationRequired(u: TokenUser, now = Date.now()): boolean {
  return u.never_expires === true && daysSince(u.rotated_at, now) >= ROTATION_REQUIRED_DAYS;
}

/** /24 or /48: enough to recognize a foreign network; the exact address
 * is not stored. */
export function ipArea(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (!ip.includes(':')) return null;
  const [header = '', rest] = ip.split('::');
  const parts = header ? header.split(':') : [];
  // "a::b" has fewer than three groups on the left: the missing ones are zeros.
  while (parts.length < 3 && rest !== undefined) parts.push('0');
  if (parts.length < 3 || parts.slice(0, 3).some(g => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return `${parts
    .slice(0, 3)
    .map(g => g.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/48`;
}

export interface TokenCheck {
  user: TokenUser | null;
  reason?: 'token_rotation_required' | 'too_many_requests';
}

/** `zweck: 'rotation'` lets an unlimited token through even after the
 * mandatory deadline — only for the swap itself. */
/** For the stream: is the access still alive? Asked with the plaintext; the hash stays in the account. */
export async function tokenValid(k: AccountContext, plaintext: string): Promise<boolean> {
  return !!(await k.accesses.validToken(tokenDigest(plaintext)));
}

export async function checkToken(
  k: AccountContext,
  token: string | null | undefined,
  o: { ip?: string | null | undefined; purpose?: 'nutzung' | 'rotation' } = {},
): Promise<TokenCheck> {
  if (!token) return { user: null };
  const now = k.clock.now();
  const result = (u: TokenUser): TokenCheck =>
    o.purpose !== 'rotation' && rotationRequired(u, now)
      ? { user: null, reason: 'token_rotation_required' }
      : { user: u };

  const state = cacheState(k);
  const hit = tokenFromCache(k, token, state, now);
  if (hit) {
    // Both deadlines here too: this branch does not query the database.
    if (deadlineReached(hit.user.expires_at, now) || deadlineReached(hit.user.hard_expires_at, now)) {
      forgetEntry(k, token);
      return { user: null };
    }
    _touchLastUsed(k, hit, o.ip);
    return result(hit.user);
  }

  // Only after the cache: whoever has a valid token in the cache is never slowed down.
  if (toManyFailedAttempts(o.ip)) return { user: null, reason: 'too_many_requests' };
  const hashed = tokenDigest(token);
  const row: TokenUser | undefined = await k.accesses.validToken(hashed);
  if (!row) {
    forgetEntry(k, token);
    if (!(await reportReuse(k, hashed))) await countFailedAttempt(k, o.ip);
    return { user: null };
  }
  // Administrator rights only with scope `voll`, decided at this one place,
  // so all guards see it the same way.
  row.is_admin = row.account_is_admin === true && row.scope === 'voll';
  if (row.previous_token) {
    await k.accesses.endOverlap(row.previous_token, hashed);
    row.previous_token = null;
    emptyTokenCache(k);
  }

  const entry: CacheEntry = { user: row, cachedAt: now, dbKey: hashed };
  rememberEntry(k, token, entry, state);
  _touchLastUsed(k, entry, o.ip);
  return result(row);
}

/** A replaced token came back after the grace period: lock the family, notify the owner. */
async function reportReuse(k: AccountContext, hash: string): Promise<boolean> {
  const z = await k.accesses.lockFamily(hash, REUSE_GRACE_PERIOD_S);
  if (!z) return false;
  emptyTokenCache(k);
  console.warn(`[tokens] ersetzter Token erneut benutzt — Familie von Konto ${z.user_id} gesperrt`);
  hintInBackground(k, z.user_id, 'token_reused', z.label ?? undefined);
  return true;
}

export async function userForToken(
  k: AccountContext,
  token: string | null | undefined,
  o: { ip?: string | null | undefined; purpose?: 'nutzung' | 'rotation' } = {},
): Promise<TokenUser | null> {
  return (await checkToken(k, token, o)).user;
}

/** At most once per day and token, without holding up the request path. The
 * decision is made on the record read, so it holds across several workers;
 * the WHERE clause catches the race. */
function _touchLastUsed(k: AccountContext, entry: CacheEntry, ip?: string | null): void {
  const now = k.clock.now();
  const u = entry.user;
  const lastUsed = u.last_used ? new Date(u.last_used).getTime() : 0;
  const target = now + k.config.tokenIdleDays * TAG_MS;
  const deadlineLags = u.sliding === true && !!u.expires_at && new Date(u.expires_at).getTime() < target - TAG_MS;
  if ((now - lastUsed < TAG_MS && !deadlineLags) || entry.writing) return;
  entry.writing = true;
  void k.accesses
    .touchToken(entry.dbKey, k.config.tokenIdleDays, ipArea(ip))
    .then(() => {
      // Update the cache too, otherwise the hit branch would once reject a just
      // renewed token at the old end of its deadline.
      u.last_used = new Date(now);
      if (deadlineLags || (u.sliding === true && u.expires_at)) u.expires_at = new Date(target);
    })
    .catch((e: unknown) => reportError('token:last_used schreiben', e))
    .finally(() => {
      entry.writing = false;
    });
}

/** Without this a "%" as tokenId deletes all tokens of the user at once. */
export function escapeLike(s: unknown): string {
  return String(s ?? '').replace(/([%_\\])/g, '\\$1');
}

/** Choices of the QR dialog; above TOKEN_MAX_DAYS they are cut to it (tokenDays). There is no
 * "unlimited" any more, it removed the only automatic rip cord for a lost device: the old
 * choice is still accepted from older pages and means the bound. */
const TOKEN_RUNTIMES: Record<string, number> = {
  '1m': 30,
  '2m': 60,
  '6m': 180,
  '12m': 365,
  unlimited: 0,
};

/** The choices the QR dialog may offer; 6m, 12m and "unlimited" exceed the default bound and are
 * only still accepted from older pages. */
export const RUNTIME_CHOICES: readonly string[] = Object.freeze(['1m', '2m']);

/** fromTable instead of direct access: 'constructor' would otherwise return an inherited function.
 * @returns days, or null for "no fixed deadline" */
export function runtimeDays(choice: unknown): number | null {
  if (choice === undefined || choice === null || choice === '') return null;
  return V.fromTable(TOKEN_RUNTIMES, String(choice)) ?? null;
}

export interface TokenOptions {
  /** Default `app`: administrator rights only on explicit request. */
  scope?: TokenScope;
  ip?: string | null | undefined;
}

/** Per account and kind (session, token): logging in must not fill the tables arbitrarily.
 * The access unused for the longest time falls. */
export const ACCESSES_AT_MOST = 50;

/** The fixed end, in days from now: never beyond TOKEN_MAX_DAYS; nothing chosen (null, 0 from an
 * old QR code) is that bound. Every access thus ends, whatever a client asks for. */
export function tokenDays(k: Pick<AccountContext, 'config'>, fixedDays: number | null): number {
  const max = k.config.tokenMaxDays;
  return fixedDays && fixedDays > 0 ? Math.min(fixedDays, max) : max;
}

/** @param permanent  true = device access with sliding deadline; false = seven fixed
 *                   days — use by an attacker should not extend it.
 * @param fixedDays  the wished end in days (tokenDays() bounds it). */
export async function createToken(
  k: AccountContext,
  userId: number,
  label = 'Android App',
  permanent = false,
  fixedDays: number | null = null,
  o: TokenOptions = {},
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = tokenDigest(token);
  await k.accesses.createToken({
    hash,
    userId,
    label,
    scope: o.scope === 'voll' ? 'voll' : 'app',
    area: ipArea(o.ip),
    kind: permanent ? 'gleitend' : 'kurz',
    idleDays: k.config.tokenIdleDays,
    fixedDays: tokenDays(k, fixedDays),
  });
  if (await k.accesses.capTokens(userId, hash, ACCESSES_AT_MOST - 1)) emptyTokenCache(k);
  return token;
}

export interface Swap {
  token: string;
  scope: TokenScope;
  expires_at: Date | null;
  hard_expires_at: Date | null;
  never_expires: boolean;
  rotated_at: Date;
  old_valid_until: Date;
}

/** A second swap so shortly after is concurrent (409), not a lost response. */
export const SWAP_LOCK_S = 30;

/** The old one then applies at most OVERLAP_MS. A second swap replaces the unused
 * successor only from the same network (otherwise a copy: the family ends) and only after SWAP_LOCK_S. */
export async function rotateToken(kx: AccountContext, alt: string, ip?: string | null): Promise<Swap | null> {
  const altHash = tokenDigest(alt);
  const fresh = crypto.randomBytes(32).toString('hex');
  const newHash = tokenDigest(fresh);
  let copy: { user_id: number; label: string | null } | null = null;
  // The swap comes without a session: the old token is the only credential.
  const result = await inSystemContext('tokentausch', () =>
    kx.transact(async t => {
      const z = await repo.lockSwapSource(t.db, altHash);
      if (!z) return null;
      const open = z.replaced_by ? await repo.unusedSuccessor(t.db, z.replaced_by, altHash) : undefined;
      const area = ipArea(ip);
      if (open?.ip_range && area && open.ip_range !== area) {
        await repo.deleteFamily(t.db, z.user_id, z.created_at);
        copy = { user_id: z.user_id, label: z.label };
        return null;
      }
      if (open && open.alter_s < SWAP_LOCK_S) return 'laeuft' as const;
      if (z.replaced_by) await repo.deleteUnusedSuccessor(t.db, z.replaced_by, altHash);
      const row = await repo.createSuccessor(t.db, newHash, altHash, z, t.config.tokenIdleDays, ipArea(ip));
      const before = await repo.limitTimePredecessor(t.db, altHash, newHash, OVERLAP_MS / 1000);
      return {
        token: fresh,
        scope: z.scope,
        expires_at: row!.expires_at,
        hard_expires_at: row!.hard_expires_at,
        never_expires: z.never_expires,
        rotated_at: row!.rotated_at,
        old_valid_until: before!.expires_at,
      };
    }),
  );
  if (result || copy) emptyTokenCache(kx);
  if (copy) {
    const k: { user_id: number; label: string | null } = copy;
    console.warn(`[tokens] zweiter Tausch aus einem anderen Netz — Familie von Konto ${k.user_id} gesperrt`);
    hintInBackground(kx, k.user_id, 'token_reused', k.label ?? undefined);
  }
  if (result === 'laeuft') failDomain('conflict', 'token_swap_running');
  return result;
}

export async function deleteToken(k: AccountContext, token: string): Promise<void> {
  if (!token) return;
  await k.accesses.deleteToken(tokenDigest(token));
  tokenForgotten(k, token);
}

/** No catch: a security step. If it failed silently, the caller would report
 * success while the old tokens stay valid. */
export async function revokeAllTokens(k: AccountContext, userId: number): Promise<void> {
  await k.accesses.deleteTokensOfAccount(userId);
  emptyTokenCache(k);
}

/** Legacy rows first get their sliding deadline, so they fall like new ones. Every step
 * runs; if one fails, the run throws afterwards, and the cleanup repeats it. */
export async function tokensCleanup(k: AccountContext) {
  const without: string[] = [];
  const step = async (was: string, work: () => Promise<number>) => {
    const r = await attempts(`tokens:${was}`, work);
    if (!r.ok) without.push(was);
    return r.ok ? r.value : 0;
  };
  // Safety net beside migration 0126: a row without a fixed end gets one.
  const g = await step('ohne Ende', () => k.accesses.boundUnlimited(k.config.tokenMaxDays));
  if (g) console.log(`[tokens] ${g} Token ohne festes Ende auf ${k.config.tokenMaxDays} Tage begrenzt`);
  const m = await step('Altzeilen nachziehen', () => k.accesses.pullOldRowsAfter(k.config.tokenIdleDays));
  if (m)
    console.log(`[tokens] ${m} Token ohne Ablaufdatum auf die Gleitfrist von ${k.config.tokenIdleDays} Tagen gesetzt`);
  const expired = await step('abgelaufene', () => k.accesses.deleteExpired());
  const n = await step('ungenutzte', () => k.accesses.deleteUnused(k.config.tokenIdleDays));
  await step('verbrauchte', () => k.accesses.deleteOrphanedConsumed());
  if (n) console.log(`[tokens] ${n} Token seit über ${k.config.tokenIdleDays} Tagen ungenutzt — entfernt`);
  if (without.length) throw new Error(`Token-Aufräumen ohne: ${without.join(', ')}`);
  return expired + n;
}
