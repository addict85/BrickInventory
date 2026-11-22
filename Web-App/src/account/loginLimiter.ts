/** The address comes as a value; which one a request has is decided by the HTTP layer. */
import crypto from 'node:crypto';
import { singleValue } from '../infra/validate';
import { reportAndDeliver } from '../infra/error';
import { searchValue } from '../infra/secret';
import { failDomain, type ErrorCode } from '../infra/errorTexts';
import type { AccountContext } from './context';
import { throttleAddress } from '../infra/throttleAddress';

export const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Per account across all addresses, doubling: an attacker guesses about 15 times per quarter hour,
 * the owner waits seconds after a typo instead of a fixed lock. */
export function waitTimeSeconds(failedAttempts: number): number {
  if (failedAttempts < MAX_ATTEMPTS) return 0;
  return Math.min(2 ** (failedAttempts - MAX_ATTEMPTS), WINDOW_MS / 1000);
}
/** Across ALL names: the limit per account would otherwise allow password spraying. */
export const MAX_PER_ADDRESS = 30;
const KNOWN_MIN = 30 * 24 * 60;
const WINDOW_MIN = WINDOW_MS / 60000;
/** A reserved slot whose check was never reported expires after this. */
const RUNNING_EXPIRY_S = 60;

// einzelwert(): if the name arrives twice, Express returns an array.
const _key = (ip: string, name: string) => `login|${throttleAddress(ip)}|${singleValue(name).toLowerCase()}`;
const _addressKey = (ip: string) => `login-adresse|${throttleAddress(ip)}`;
const _nameKey = (name: string) => `login-name|${singleValue(name).toLowerCase()}`;
/** The known row lives 30 days and the reading role reads the table: it only
 * holds the HMAC of the address; it stays the same for the same address and keeps counting. */
function addressDigest(ip: string): string {
  return searchValue('anmeldeadresse', throttleAddress(ip));
}
const _knownKey = (ip: string, name: string) => `login-bekannt|${addressDigest(ip)}|${singleValue(name).toLowerCase()}`;
const _successKey = (ip: string, key: string) => `login-erfolg|${addressDigest(ip)}|${key}`;

/** Name and email of an account count together, otherwise every limit would apply twice.
 * Lower-cased by PostgreSQL as on login: JS turns "İ" into two characters. */
async function accountKey(k: AccountContext, username: string): Promise<string> {
  // Exception: with a disrupted database the throttle keeps counting in memory
  // (inMemory); without an account then by the name, instead of locking the login.
  const z = await k.accounts
    .accountToNames(singleValue(username))
    .catch(reportAndDeliver('anmeldung:konto-kennung', null));
  if (z?.id) return `konto:${z.id}`;
  return `name:${namedDigest(z?.identifier ?? singleValue(username).toLowerCase())}`;
}

/** An unknown name is often a mistyped password, and the reading role reads the
 * table: only the HMAC, which stays the same for the same name and keeps counting. */
function namedDigest(name: string): string {
  return searchValue('anmeldename', name);
}

export type Lock = { code: ErrorCode; vars: { minutes: number } };

/** Occupies the attempt; loginFailed, loginSucceeded or giveLoginSpaceFree release it. */
export async function loginAllowed(k: AccountContext, ip: string, username: string): Promise<Lock | null> {
  const key = await accountKey(k, username);
  // Known: only the lock per address and account. Total lock and waiting time could otherwise
  // be turned against the owner; behind a proxy everyone shares one address.
  const known = !!(await k.throttle.counterState(_knownKey(ip, key), KNOWN_MIN));
  const total = await k.throttle.reserve(
    _addressKey(ip),
    WINDOW_MIN,
    RUNNING_EXPIRY_S,
    s => known || s.count + s.running < MAX_PER_ADDRESS,
  );
  if (!total.ok) return { code: 'too_many_failed_attempts', vars: { minutes: total.state.waitMin } };
  const address = await k.throttle.reserve(
    _key(ip, key),
    WINDOW_MIN,
    RUNNING_EXPIRY_S,
    s => s.count + s.running < MAX_ATTEMPTS,
  );
  if (!address.ok) {
    await k.throttle.releaseSlot(_addressKey(ip));
    return { code: 'too_many_failed_attempts', vars: { minutes: address.state.waitMin } };
  }
  if (known) return null;
  let rest = 0;
  const account = await k.throttle.reserve(_nameKey(key), WINDOW_MIN, RUNNING_EXPIRY_S, s => {
    rest = waitTimeSeconds(s.count) - s.sinceLast;
    // In the waiting-time phase at most one attempt at a time per account.
    return rest <= 0 && (s.count < MAX_ATTEMPTS || s.running === 0);
  });
  if (!account.ok) {
    await k.throttle.releaseSlot(_key(ip, key));
    await k.throttle.releaseSlot(_addressKey(ip));
    return { code: 'too_many_failed_attempts', vars: { minutes: Math.max(1, Math.ceil(Math.max(rest, 1) / 60)) } };
  }
  return null;
}

export async function giveLoginSpaceFree(k: AccountContext, ip: string, username: string): Promise<void> {
  const key = await accountKey(k, username);
  await k.throttle.releaseSlot(_key(ip, key));
  await k.throttle.releaseSlot(_nameKey(key));
  await k.throttle.releaseSlot(_addressKey(ip));
}

/** @returns the account's failed attempts in the window and whether the daily limit was just reached */
export async function loginFailed(
  k: AccountContext,
  ip: string,
  username: string,
): Promise<{ n: number; dailyLimit: boolean }> {
  const key = await accountKey(k, username);
  await k.throttle.countAttempt(_key(ip, key), WINDOW_MIN);
  const n = await k.throttle.countAttempt(_nameKey(key), WINDOW_MIN);
  await k.throttle.countAttempt(_addressKey(ip), WINDOW_MIN);
  const tag = await k.throttle.countAttempt(await _tagKey(k, ip, key), ACCOUNT_WINDOW_MIN);
  return { n, dailyLimit: tag === MAX_PER_ACCOUNT_DAY };
}

/** A known address bypasses the brake per account; whoever sits there would otherwise guess 480 times a day.
 * Above that the password only applies with a second factor; passkey and "forgot password" stay
 * open, resetting clears the counter. Known addresses count separately: otherwise
 * a stranger with 50 attempts would lock the owner out even on their own devices. */
export const MAX_PER_ACCOUNT_DAY = 50;
async function _tagKey(k: AccountContext, ip: string, key: string): Promise<string> {
  const own =
    !!(await k.throttle.counterState(_knownKey(ip, key), KNOWN_MIN)) ||
    !!(await k.throttle.counterState(_releaseKey(key, addressDigest(ip)), ACCOUNT_WINDOW_MIN));
  return own ? `login-tag|${key}|${addressDigest(ip)}` : `login-tag|${key}`;
}

/** Above the daily limit a stranger would lock the owner out at every new place: a signed, single-use
 * link lets the address of the locked login count like a known one for a day. */
const _releaseKey = (key: string, fingerprint: string) => `login-freigabe|${key}|${fingerprint}`;
const releaseSignature = (uid: number, fingerprint: string, bis: number) =>
  searchValue('anmeldefreigabe', `${uid}|${fingerprint}|${bis}`);
export function releaseToken(k: AccountContext, ip: string, uid: number): string {
  const fingerprint = addressDigest(ip);
  const bis = Math.floor(k.clock.now() / 1000) + ACCOUNT_WINDOW_MIN * 60;
  return `${uid}.${fingerprint}.${bis}.${releaseSignature(uid, fingerprint, bis)}`;
}
export async function approveLogin(k: AccountContext, token: string): Promise<void> {
  const [u, fingerprint = '', b, sig = ''] = String(token).split('.');
  const uid = Number(u),
    bis = Number(b);
  const expected = Number.isInteger(uid) && Number.isInteger(bis) ? releaseSignature(uid, fingerprint, bis) : '';
  const real = expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  if (!real || bis * 1000 <= k.clock.now()) failDomain('conflict', 'approval_link_invalid');
  if ((await k.throttle.countAttempt(`login-freigabe-benutzt|${sig}`, ACCOUNT_WINDOW_MIN)) > 1)
    failDomain('conflict', 'approval_link_invalid');
  await k.throttle.countAttempt(_releaseKey(`konto:${uid}`, fingerprint), ACCOUNT_WINDOW_MIN);
}
export async function dailyLimitReached(k: AccountContext, ip: string, username: string): Promise<boolean> {
  const key = await _tagKey(k, ip, await accountKey(k, username));
  return ((await k.throttle.counterState(key, ACCOUNT_WINDOW_MIN))?.count ?? 0) >= MAX_PER_ACCOUNT_DAY;
}
export async function deleteDailyLimit(k: AccountContext, uid: number): Promise<void> {
  await k.throttle.forgetCounter(`login-tag|konto:${uid}`, { alsoBelow: true });
}

export type LoginEvent =
  | 'anmeldung_fehlgeschlagen'
  | 'anmeldung_gesperrt'
  | 'login_daily_limit'
  | 'second_factor_wrong'
  | 'bestaetigung_fehlgeschlagen'
  | 'bestaetigung_gesperrt'
  | 'confirmation_throttled';
/** One warning line per event for log, app_logs and fail2ban; never password, code
 * or entered name, because a password sometimes lands in the name field. */
export function reportLoginEvent(
  event: LoginEvent,
  details: { ip?: string; account?: number | null; kind?: Brake; method?: string },
): void {
  const { ip, account, kind, method } = details;
  // The keys are the fields of the security events that monitoring reads; they stay as they are.
  console.warn(`[anmeldung] ${event}`, {
    ereignis: event,
    ...(ip ? { address: throttleAddress(ip) } : {}),
    konto: account ?? 'unbekannt',
    ...(kind ? { kind } : {}),
    ...(method ? { zugang: method } : {}),
  });
}

/** Only the success shows whether someone got in after failed attempts, and from where; never the name. */
export type LoginMethod = 'passwort' | 'passwort+code' | 'passwort+passkey' | 'passkey' | 'qr';
export function reportLogin(details: { ip?: string | undefined; account: number; method: LoginMethod }): void {
  const { ip, account, method } = details;
  console.info('[anmeldung] anmeldung_erfolgreich', {
    ereignis: 'anmeldung_erfolgreich',
    ...(ip ? { address: throttleAddress(ip) } : {}),
    konto: account,
    zugang: method,
  });
}

export async function loginSucceeded(k: AccountContext, ip: string, username: string): Promise<void> {
  const key = await accountKey(k, username);
  await k.throttle.forgetCounter(_key(ip, key));
  await k.throttle.forgetCounter(_nameKey(key));
  // Only release: a success does not reset the address counter after failed attempts against other accounts.
  await k.throttle.releaseSlot(_addressKey(ip));
  await k.throttle.countAttempt(_knownKey(ip, key), KNOWN_MIN);
  await k.throttle.countAttempt(_successKey(ip, key), WINDOW_MIN);
}

/** Soft limit: whoever logs in more often only loses the priority. A hard one would hit
 * the owner, and against the load the locks and the limit already work. */
export const SUCCESSES_WITH_PRIORITY = 30;

/** This address last logged in with this name, and not too often. */
export async function knownLogin(k: AccountContext, ip: string, username: string): Promise<boolean> {
  const key = await accountKey(k, username);
  if (!(await k.throttle.counterState(_knownKey(ip, key), KNOWN_MIN))) return false;
  return ((await k.throttle.counterState(_successKey(ip, key), WINDOW_MIN))?.count ?? 0) < SUCCESSES_WITH_PRIORITY;
}

/** Every unknown name creates a row; without cleanup the table would grow with every guess. */
export async function cleanLoginCounterOn(k: AccountContext): Promise<number> {
  return k.throttle.cleanUp(KNOWN_MIN);
}

export function countRequest(
  k: AccountContext,
  bucket: string,
  ip: string,
  windowMs: number,
): Promise<{ count: number; waitMin: number }> {
  return k.throttle.countInWindow(`${bucket}|${throttleAddress(ip)}`, windowMs / 60000);
}

/** Per account and access: a captured access does not lock the owner's emergency brakes.
 * Codes count separately and longer; only a correct code resets them. */
export type Brake = 'passwort' | 'faktor';
const FACTOR_WINDOW_MIN = 60;
const _confirmationKey = (kind: Brake, uid: number, method: string) =>
  `${kind === 'faktor' ? 'faktor' : 'passwort'}-bestaetigen|${uid}|${method}`;
const window = (kind: Brake) => (kind === 'faktor' ? FACTOR_WINDOW_MIN : WINDOW_MIN);

/** Across all accesses of an account, so several captured accesses do not guess several times;
 * only accesses that guessed wrong themselves get locked. */
export const MAX_CONFIRMATION_PER_ACCOUNT = 20;
const ACCOUNT_WINDOW_MIN = 24 * 60;
const _accountConfirmationKey = (kind: Brake, uid: number) =>
  `${kind === 'faktor' ? 'faktor' : 'passwort'}-bestaetigen-konto|${uid}`;

export async function confirmationLocked(
  k: AccountContext,
  kind: Brake,
  uid: number,
  method: string,
): Promise<Lock | null> {
  const account = await k.throttle.counterState(_accountConfirmationKey(kind, uid), ACCOUNT_WINDOW_MIN);
  const accountFull = !!account && account.count >= MAX_CONFIRMATION_PER_ACCOUNT;
  const r = await k.throttle.reserve(
    _confirmationKey(kind, uid, method),
    window(kind),
    RUNNING_EXPIRY_S,
    s => s.count + s.running < MAX_ATTEMPTS && !(accountFull && s.count > 0),
  );
  if (r.ok) return null;
  const minutes = accountFull && r.state.count < MAX_ATTEMPTS ? account!.waitMin : r.state.waitMin;
  return { code: 'too_many_failed_attempts', vars: { minutes } };
}
/** @returns true if this failed attempt just reached a brake (access or account) */
export async function confirmationFailed(
  k: AccountContext,
  kind: Brake,
  uid: number,
  method: string,
): Promise<boolean> {
  const perAccess = await k.throttle.countAttempt(_confirmationKey(kind, uid, method), window(kind));
  const perAccount = await k.throttle.countAttempt(_accountConfirmationKey(kind, uid), ACCOUNT_WINDOW_MIN);
  return perAccess === MAX_ATTEMPTS || perAccount === MAX_CONFIRMATION_PER_ACCOUNT;
}
export async function confirmationSucceeded(
  k: AccountContext,
  kind: Brake,
  uid: number,
  method: string,
): Promise<void> {
  await k.throttle.forgetCounter(_confirmationKey(kind, uid, method));
}

/** Whoever knows the password would otherwise slowly guess the code under every waiting time;
 * above the limit (24 h per account) only recovery code and passkey apply. */
export const MAX_FACTOR_LOGIN_PER_ACCOUNT = 20;
const _factorLoginKey = (uid: number) => `faktor-anmeldung-konto|${uid}`;
export async function factorCodeLocked(k: AccountContext, uid: number): Promise<boolean> {
  return (
    ((await k.throttle.counterState(_factorLoginKey(uid), ACCOUNT_WINDOW_MIN))?.count ?? 0) >=
    MAX_FACTOR_LOGIN_PER_ACCOUNT
  );
}
/** @returns true if this failed attempt just reached the limit */
export async function factorCodeWrong(k: AccountContext, uid: number): Promise<boolean> {
  return (await k.throttle.countAttempt(_factorLoginKey(uid), ACCOUNT_WINDOW_MIN)) === MAX_FACTOR_LOGIN_PER_ACCOUNT;
}
