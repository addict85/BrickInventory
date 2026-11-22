/** The address comes as a value; which one a request has is decided by the HTTP layer. */
import crypto from 'node:crypto';
import { singleValue } from '../infra/validate';
import { reportAndDeliver } from '../infra/error';
import { searchValue } from '../infra/secret';
import { fachfehler, type ErrorCode } from '../infra/errorTexts';
import type { AccountContext } from './context';
import { drosselAdresse } from '../infra/throttleAddress';

export const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Per account across all addresses, doubling: an attacker guesses about 15 times per quarter hour,
 * the owner waits seconds after a typo instead of a fixed lock. */
export function waitTimeSeconds(failedAttempts: number): number {
  if (failedAttempts < MAX_ATTEMPTS) return 0;
  return Math.min(2 ** (failedAttempts - MAX_ATTEMPTS), WINDOW_MS / 1000);
}
/** Across ALL names: the limit per account would otherwise allow password spraying. */
export const MAX_JE_ADDRESS = 30;
const KNOWN_MIN = 30 * 24 * 60;
const WINDOW_MIN = WINDOW_MS / 60000;
/** A reserved slot whose check was never reported expires after this. */
const RUNNING_EXPIRY_S = 60;

// einzelwert(): if the name arrives twice, Express returns an array.
const _key = (ip: string, name: string) => `login|${drosselAdresse(ip)}|${singleValue(name).toLowerCase()}`;
const _addressKey = (ip: string) => `login-adresse|${drosselAdresse(ip)}`;
const _nameKey = (name: string) => `login-name|${singleValue(name).toLowerCase()}`;
/** The known row lives 30 days and the reading role reads the table: it only
 * holds the HMAC of the address; it stays the same for the same address and keeps counting. */
function addressDigest(ip: string): string {
  return searchValue('anmeldeadresse', drosselAdresse(ip));
}
const _knownKey = (ip: string, name: string) => `login-bekannt|${addressDigest(ip)}|${singleValue(name).toLowerCase()}`;
const _successKey = (ip: string, kennung: string) => `login-erfolg|${addressDigest(ip)}|${kennung}`;

/** Name and email of an account count together, otherwise every limit would apply twice.
 * Lower-cased by PostgreSQL as on login: JS turns "İ" into two characters. */
async function accountKey(k: AccountContext, username: string): Promise<string> {
  // Exception: with a disrupted database the throttle keeps counting in memory
  // (inMemory); without an account then by the name, instead of locking the login.
  const z = await k.konten
    .accountToNames(singleValue(username))
    .catch(reportAndDeliver('anmeldung:konto-kennung', null));
  if (z?.id) return `konto:${z.id}`;
  return `name:${namedDigest(z?.kennung ?? singleValue(username).toLowerCase())}`;
}

/** An unknown name is often a mistyped password, and the reading role reads the
 * table: only the HMAC, which stays the same for the same name and keeps counting. */
function namedDigest(name: string): string {
  return searchValue('anmeldename', name);
}

export type Sperre = { code: ErrorCode; vars: { minuten: number } };

/** Occupies the attempt; loginFailed, loginSucceeded or giveLoginSpaceFree release it. */
export async function loginAllowed(k: AccountContext, ip: string, username: string): Promise<Sperre | null> {
  const kennung = await accountKey(k, username);
  // Known: only the lock per address and account. Total lock and waiting time could otherwise
  // be turned against the owner; behind a proxy everyone shares one address.
  const known = !!(await k.throttle.counterState(_knownKey(ip, kennung), KNOWN_MIN));
  const total = await k.throttle.reserve(
    _addressKey(ip),
    WINDOW_MIN,
    RUNNING_EXPIRY_S,
    s => known || s.count + s.laufend < MAX_JE_ADDRESS,
  );
  if (!total.ok) return { code: 'zu_viele_fehlversuche', vars: { minuten: total.stand.waitMin } };
  const address = await k.throttle.reserve(
    _key(ip, kennung),
    WINDOW_MIN,
    RUNNING_EXPIRY_S,
    s => s.count + s.laufend < MAX_ATTEMPTS,
  );
  if (!address.ok) {
    await k.throttle.releaseSlot(_addressKey(ip));
    return { code: 'zu_viele_fehlversuche', vars: { minuten: address.stand.waitMin } };
  }
  if (known) return null;
  let rest = 0;
  const konto = await k.throttle.reserve(_nameKey(kennung), WINDOW_MIN, RUNNING_EXPIRY_S, s => {
    rest = waitTimeSeconds(s.count) - s.sinceLast;
    // In the waiting-time phase at most one attempt at a time per account.
    return rest <= 0 && (s.count < MAX_ATTEMPTS || s.laufend === 0);
  });
  if (!konto.ok) {
    await k.throttle.releaseSlot(_key(ip, kennung));
    await k.throttle.releaseSlot(_addressKey(ip));
    return { code: 'zu_viele_fehlversuche', vars: { minuten: Math.max(1, Math.ceil(Math.max(rest, 1) / 60)) } };
  }
  return null;
}

export async function giveLoginSpaceFree(k: AccountContext, ip: string, username: string): Promise<void> {
  const kennung = await accountKey(k, username);
  await k.throttle.releaseSlot(_key(ip, kennung));
  await k.throttle.releaseSlot(_nameKey(kennung));
  await k.throttle.releaseSlot(_addressKey(ip));
}

/** @returns the account's failed attempts in the window and whether the daily limit was just reached */
export async function loginFailed(
  k: AccountContext,
  ip: string,
  username: string,
): Promise<{ n: number; dailyLimit: boolean }> {
  const kennung = await accountKey(k, username);
  await k.throttle.countAttempt(_key(ip, kennung), WINDOW_MIN);
  const n = await k.throttle.countAttempt(_nameKey(kennung), WINDOW_MIN);
  await k.throttle.countAttempt(_addressKey(ip), WINDOW_MIN);
  const tag = await k.throttle.countAttempt(await _tagKey(k, ip, kennung), ACCOUNT_WINDOW_MIN);
  return { n, dailyLimit: tag === MAX_JE_ACCOUNT_TAG };
}

/** A known address bypasses the brake per account; whoever sits there would otherwise guess 480 times a day.
 * Above that the password only applies with a second factor; passkey and "forgot password" stay
 * open, resetting clears the counter. Known addresses count separately: otherwise
 * a stranger with 50 attempts would lock the owner out even on their own devices. */
export const MAX_JE_ACCOUNT_TAG = 50;
async function _tagKey(k: AccountContext, ip: string, kennung: string): Promise<string> {
  const own =
    !!(await k.throttle.counterState(_knownKey(ip, kennung), KNOWN_MIN)) ||
    !!(await k.throttle.counterState(_releaseKey(kennung, addressDigest(ip)), ACCOUNT_WINDOW_MIN));
  return own ? `login-tag|${kennung}|${addressDigest(ip)}` : `login-tag|${kennung}`;
}

/** Above the daily limit a stranger would lock the owner out at every new place: a signed, single-use
 * link lets the address of the locked login count like a known one for a day. */
const _releaseKey = (kennung: string, fingerprint: string) => `login-freigabe|${kennung}|${fingerprint}`;
const releaseSignature = (uid: number, fingerprint: string, bis: number) =>
  searchValue('anmeldefreigabe', `${uid}|${fingerprint}|${bis}`);
export function releaseToken(k: AccountContext, ip: string, uid: number): string {
  const fingerprint = addressDigest(ip);
  const bis = Math.floor(k.uhr.jetzt() / 1000) + ACCOUNT_WINDOW_MIN * 60;
  return `${uid}.${fingerprint}.${bis}.${releaseSignature(uid, fingerprint, bis)}`;
}
export async function approveLogin(k: AccountContext, token: string): Promise<void> {
  const [u, fingerprint = '', b, sig = ''] = String(token).split('.');
  const uid = Number(u),
    bis = Number(b);
  const expected = Number.isInteger(uid) && Number.isInteger(bis) ? releaseSignature(uid, fingerprint, bis) : '';
  const echt = expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  if (!echt || bis * 1000 <= k.uhr.jetzt()) fachfehler('konflikt', 'freigabe_link_ungueltig');
  if ((await k.throttle.countAttempt(`login-freigabe-benutzt|${sig}`, ACCOUNT_WINDOW_MIN)) > 1)
    fachfehler('konflikt', 'freigabe_link_ungueltig');
  await k.throttle.countAttempt(_releaseKey(`konto:${uid}`, fingerprint), ACCOUNT_WINDOW_MIN);
}
export async function dailyLimitReached(k: AccountContext, ip: string, username: string): Promise<boolean> {
  const key = await _tagKey(k, ip, await accountKey(k, username));
  return ((await k.throttle.counterState(key, ACCOUNT_WINDOW_MIN))?.count ?? 0) >= MAX_JE_ACCOUNT_TAG;
}
export async function deleteDailyLimit(k: AccountContext, uid: number): Promise<void> {
  await k.throttle.forgetCounter(`login-tag|konto:${uid}`, { alsoBelow: true });
}

export type LoginEvent =
  | 'anmeldung_fehlgeschlagen'
  | 'anmeldung_gesperrt'
  | 'anmeldung_tagesgrenze'
  | 'zweiter_faktor_falsch'
  | 'bestaetigung_fehlgeschlagen'
  | 'bestaetigung_gesperrt'
  | 'bestaetigung_gebremst';
/** One warning line per event for log, app_logs and fail2ban; never password, code
 * or entered name, because a password sometimes lands in the name field. */
export function reportLoginEvent(
  ereignis: LoginEvent,
  details: { ip?: string; konto?: number | null; art?: Brake; zugang?: string },
): void {
  const { ip, konto, ...rest } = details;
  console.warn(`[anmeldung] ${ereignis}`, {
    ereignis,
    ...(ip ? { adresse: drosselAdresse(ip) } : {}),
    konto: konto ?? 'unbekannt',
    ...rest,
  });
}

/** Only the success shows whether someone got in after failed attempts, and from where; never the name. */
export type LoginMethod = 'passwort' | 'passwort+code' | 'passwort+passkey' | 'passkey' | 'qr';
export function reportLogin(details: { ip?: string | undefined; konto: number; zugang: LoginMethod }): void {
  const { ip, konto, zugang } = details;
  console.info('[anmeldung] anmeldung_erfolgreich', {
    ereignis: 'anmeldung_erfolgreich',
    ...(ip ? { adresse: drosselAdresse(ip) } : {}),
    konto,
    zugang,
  });
}

export async function loginSucceeded(k: AccountContext, ip: string, username: string): Promise<void> {
  const kennung = await accountKey(k, username);
  await k.throttle.forgetCounter(_key(ip, kennung));
  await k.throttle.forgetCounter(_nameKey(kennung));
  // Only release: a success does not reset the address counter after failed attempts against other accounts.
  await k.throttle.releaseSlot(_addressKey(ip));
  await k.throttle.countAttempt(_knownKey(ip, kennung), KNOWN_MIN);
  await k.throttle.countAttempt(_successKey(ip, kennung), WINDOW_MIN);
}

/** Soft limit: whoever logs in more often only loses the priority. A hard one would hit
 * the owner, and against the load the locks and the limit already work. */
export const SUCCESSES_WITH_PRIORITY = 30;

/** This address last logged in with this name, and not too often. */
export async function knownLogin(k: AccountContext, ip: string, username: string): Promise<boolean> {
  const kennung = await accountKey(k, username);
  if (!(await k.throttle.counterState(_knownKey(ip, kennung), KNOWN_MIN))) return false;
  return ((await k.throttle.counterState(_successKey(ip, kennung), WINDOW_MIN))?.count ?? 0) < SUCCESSES_WITH_PRIORITY;
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
  return k.throttle.countInWindow(`${bucket}|${drosselAdresse(ip)}`, windowMs / 60000);
}

/** Per account and access: a captured access does not lock the owner's emergency brakes.
 * Codes count separately and longer; only a correct code resets them. */
export type Brake = 'passwort' | 'faktor';
const FACTOR_WINDOW_MIN = 60;
const _confirmationKey = (art: Brake, uid: number, zugang: string) =>
  `${art === 'faktor' ? 'faktor' : 'passwort'}-bestaetigen|${uid}|${zugang}`;
const window = (art: Brake) => (art === 'faktor' ? FACTOR_WINDOW_MIN : WINDOW_MIN);

/** Across all accesses of an account, so several captured accesses do not guess several times;
 * only accesses that guessed wrong themselves get locked. */
export const MAX_CONFIRMATION_JE_ACCOUNT = 20;
const ACCOUNT_WINDOW_MIN = 24 * 60;
const _accountConfirmationKey = (art: Brake, uid: number) =>
  `${art === 'faktor' ? 'faktor' : 'passwort'}-bestaetigen-konto|${uid}`;

export async function confirmationLocked(
  k: AccountContext,
  art: Brake,
  uid: number,
  zugang: string,
): Promise<Sperre | null> {
  const konto = await k.throttle.counterState(_accountConfirmationKey(art, uid), ACCOUNT_WINDOW_MIN);
  const accountFull = !!konto && konto.count >= MAX_CONFIRMATION_JE_ACCOUNT;
  const r = await k.throttle.reserve(
    _confirmationKey(art, uid, zugang),
    window(art),
    RUNNING_EXPIRY_S,
    s => s.count + s.laufend < MAX_ATTEMPTS && !(accountFull && s.count > 0),
  );
  if (r.ok) return null;
  const minuten = accountFull && r.stand.count < MAX_ATTEMPTS ? konto!.waitMin : r.stand.waitMin;
  return { code: 'zu_viele_fehlversuche', vars: { minuten } };
}
/** @returns true if this failed attempt just reached a brake (access or account) */
export async function confirmationFailed(k: AccountContext, art: Brake, uid: number, zugang: string): Promise<boolean> {
  const jeAccess = await k.throttle.countAttempt(_confirmationKey(art, uid, zugang), window(art));
  const jeAccount = await k.throttle.countAttempt(_accountConfirmationKey(art, uid), ACCOUNT_WINDOW_MIN);
  return jeAccess === MAX_ATTEMPTS || jeAccount === MAX_CONFIRMATION_JE_ACCOUNT;
}
export async function confirmationSucceeded(k: AccountContext, art: Brake, uid: number, zugang: string): Promise<void> {
  await k.throttle.forgetCounter(_confirmationKey(art, uid, zugang));
}

/** Whoever knows the password would otherwise slowly guess the code under every waiting time;
 * above the limit (24 h per account) only recovery code and passkey apply. */
export const MAX_FACTOR_LOGIN_JE_ACCOUNT = 20;
const _factorLoginKey = (uid: number) => `faktor-anmeldung-konto|${uid}`;
export async function factorCodeLocked(k: AccountContext, uid: number): Promise<boolean> {
  return (
    ((await k.throttle.counterState(_factorLoginKey(uid), ACCOUNT_WINDOW_MIN))?.count ?? 0) >=
    MAX_FACTOR_LOGIN_JE_ACCOUNT
  );
}
/** @returns true if this failed attempt just reached the limit */
export async function factorCodeWrong(k: AccountContext, uid: number): Promise<boolean> {
  return (await k.throttle.countAttempt(_factorLoginKey(uid), ACCOUNT_WINDOW_MIN)) === MAX_FACTOR_LOGIN_JE_ACCOUNT;
}
