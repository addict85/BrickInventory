/** What the household knows without a database; the services (household.ts) take the context. */
import crypto from 'node:crypto';

/** Long enough for "later tonight", short enough that a code left lying around
 * does not open permanently. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const OPEN_INVITATIONS_MAX = 5;

export interface Household {
  /** Own first, then the direct sub-accounts. */
  memberIds: number[];
  isMain: boolean;
  /** An account can belong to several households. */
  parentIds: number[];
}

export const HOUSEHOLD_CHANNEL = 'haushalt_geaendert';
export const HOUSEHOLD_TTL_MS = 5 * 60 * 1000;
export const HOUSEHOLD_MAX = 500;

/** Without 0/O, 1/I/L: the code is often typed off. 16 characters carry about 79 bits. */
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function newCode(): string {
  const z = Array.from({ length: 16 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  return z.match(/.{4}/g)!.join('-');
}

/** New codes without dashes and case; older ones (base64url) stay valid literally. */
function invitationKey(code: string): string {
  const short = code.trim().replace(/[\s-]/g, '').toUpperCase();
  return new RegExp(`^[${CODE_CHARS}]{16}$`).test(short) ? short : code.trim();
}

/** The code appears nowhere in plaintext. */
export function invitationHash(token: string) {
  return crypto.createHash('sha256').update(invitationKey(token)).digest('hex');
}

// The account filter becomes IDs here, so that list and sums count the same accounts.
export type ScopeMode = 'all' | 'own' | 'subs' | number;

/** Anything unknown yields 'all'. A number is NOT checked here: whether it belongs to the
 * household is only known by scopeIds(). */
export function scopeKind(v: unknown): ScopeMode {
  if (v === 'own' || v === 'subs') return v;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : 'all';
}

/** Before `asIds()` an ID or list, afterwards `Blickfeld` (always a list): two names,
 * so that a signature says at which moment it stands. */
export type ScopeInput = number | number[];

export type Scope = number[];

export function asIds(v: ScopeInput): Scope {
  return Array.isArray(v) ? v.map(x => parseInt(String(x), 10)) : [parseInt(String(v), 10)];
}

/** Who asks and which accounts of their household they want to see (`accounts`). The
 * scope is resolved by the service, not by the route: every caller gets the same rule. */
export interface Viewer {
  readonly user: number;
  readonly accounts?: string | undefined;
}
/** Who writes; their write scope is themselves and their sub-accounts. */
export interface Writer {
  readonly writer: number;
}
