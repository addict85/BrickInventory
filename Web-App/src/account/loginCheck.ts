/** Checking credentials: password, account state, second factor, brake. */
import * as passwordRule from '../infra/passwordRule';
import { BcryptOverload } from './bcryptLimit';
import { needsNewHash, hashPassword, hashPasswordImmediately, passwordFits } from './passwordHash';
import {
  loginAllowed,
  knownLogin,
  giveLoginSpaceFree,
  loginFailed,
  loginSucceeded,
  reportLoginEvent,
  reportLogin,
  factorCodeLocked,
  factorCodeWrong,
  dailyLimitReached,
  releaseToken,
  countRequest,
  MAX_ATTEMPTS,
  type LoginEvent,
  type LoginMethod,
} from './loginLimiter';
import { accountThrottled } from './targetThrottle';
import { duplicateAs, failDomain, type ErrorKind, type ErrorCode } from '../infra/errorTexts';
import { hintInBackground } from './accountNotice';
import { tokenDigest } from './deviceToken';
import { accessTransaction } from './accessEnd';
import { loginNameValid } from './nameRules';
import type { AccountContext } from './context';
import { inSystemContext } from '../infra/accountContext';

const TAG_MS = 86_400_000;

export interface AccountState {
  is_active: boolean;
  email_verified: boolean;
  email?: string | null;
  is_admin: boolean;
  registration_pending?: boolean;
  [k: string]: unknown;
}

/** Empty counts like "not there": the hash of an empty string is a valid
 * SHA-256 value. */
export async function verifyEmailToken(
  k: AccountContext,
  token: string | null | undefined,
): Promise<{ userId: number }> {
  const leer = token === undefined || token === null || String(token).trim() === '';
  const hash = tokenDigest(String(token));
  const id = leer ? undefined : await k.konten.accountToEmailToken(hash);
  if (id === undefined) failDomain('ungueltig', 'confirmation_link_invalid');
  const ok = await accessTransaction(k, t => t.konten.adoptEmailNew(id, hash)).catch(duplicateAs(false));
  if (!ok) {
    await k.konten.discardEmailNew(id, hash);
    failDomain('ungueltig', 'email_taken');
  }
  return { userId: id };
}

/** A constant, so all routes that set a password check the same length. */
export const PASSWORD_MIN_CHARS = passwordRule.PASSWORD_MIN_CHARS;
export const passwordToShort = passwordRule.passwordToShort;

/** After a successful password check. The rejection comes as a CODE, because the
 * route knows which language the requester sees.
 * @returns null = login allowed */
export function assertLoginAllowed(
  user: AccountState,
): { kind: ErrorKind; code: ErrorCode; unverified?: boolean } | null {
  if (!user.is_active) return { kind: 'verboten', code: 'account_deactivated' };
  if (user.registration_pending === true && !user.is_admin)
    return { kind: 'verboten', code: 'email_not_confirmed', unverified: true };
  return null;
}

/** For unknown names: the check then takes the same time as for an
 * account with a current hash. */
const DUMMY_HASH = hashPasswordImmediately('nonexistent-account-placeholder');

/** Domain, not HTTP: the HTTP layer chooses the status (src/http/errorKind.ts). */
export interface LoginRejection {
  kind: ErrorKind;
  code: ErrorCode;
  vars?: Record<string, string | number>;
  /** The client then shows "Resend email". */
  unverified?: boolean;
  /** The password is right; the code of the second factor is missing (or failed). */
  zweiterFaktor?: boolean;
  /** Instead of the code a passkey response works too. */
  passkey?: boolean;
}

export type LoginResult = { ok: true; user: Record<string, unknown> } | { ok: false; absage: LoginRejection };

export interface Origin {
  ip?: string | null;
}

function refusal(
  kind: ErrorKind,
  code: ErrorCode,
  vars?: Record<string, string | number>,
  unverified?: boolean,
  secondFactor?: boolean,
): LoginResult {
  return {
    ok: false,
    absage: {
      kind,
      code,
      ...(vars ? { vars } : {}),
      ...(unverified ? { unverified: true } : {}),
      ...(secondFactor ? { zweiterFaktor: true } : {}),
    },
  };
}

/** The only place where credentials are checked: two versions for
 * webapp and app had diverged once already.
 * @param username username OR email address. */
export async function checkCredentials(
  k: AccountContext,
  origin: Origin,
  username: string | null | undefined,
  password: string | null | undefined,
  code?: string | number | null | undefined,
  passkeyResponse?: unknown,
): Promise<LoginResult> {
  if (!username || !password) return refusal('ungueltig', 'username_password');
  if (!loginNameValid(username)) return refusal('ungueltig', 'enter_name_or_email');

  const ip = origin.ip || '?';
  const name = String(username);
  const locked = await loginAllowed(k, ip, name);
  if (locked) {
    reportLoginEvent('anmeldung_gesperrt', {
      ip,
      konto: (await k.accesses.accountToLogin(name))?.id ?? null,
    });
    return refusal('zu_viele', locked.code, locked.vars);
  }

  const user = await k.accesses.accountToLogin(name);
  const withFactor = (passkeyResponse !== undefined && passkeyResponse !== null) || !!String(code ?? '').trim();
  if (await onlyStillWithFactor(k, ip, name, user?.id, withFactor))
    return refusal('zu_viele', 'account_daily_limit', undefined, false, true);
  // Even without a hit, against DUMMY_HASH: the same time for unknown names. Whoever last logged in
  // from here waits at the front under load: a flood of foreign addresses does not lock them out.
  const priority = await knownLogin(k, ip, name);
  let passwordMatches: boolean;
  try {
    passwordMatches = await passwordFits(password, user?.password_hash || DUMMY_HASH, priority);
  } catch (e) {
    if (!(e instanceof BcryptOverload)) throw e;
    await giveLoginSpaceFree(k, ip, name);
    return refusal('nicht_verfuegbar', 'server_busy');
  }
  // Locked or unconfirmed like a wrong password: a rejection of its own would reveal that it was right.
  if (!user || !passwordMatches || assertLoginAllowed(user)) {
    await failedAttempt(k, 'anmeldung_fehlgeschlagen', ip, name, user?.id);
    return refusal('not_signed_in', 'credentials_invalid');
  }

  let zugang: LoginMethod = 'passwort';
  if (await k.factors.isActive(user.id)) {
    // A passkey replaces the code — bound to THIS account, whose password was right.
    const withPasskey = passkeyResponse !== undefined && passkeyResponse !== null;
    zugang = withPasskey ? 'passwort+passkey' : 'passwort+code';
    const hatPasskey = await k.factors.hasPasskeys(user.id);
    const supplemented = (e: LoginResult) => {
      if (!e.ok && hatPasskey) e.absage.passkey = true;
      return e;
    };
    if (!withPasskey && !String(code ?? '').trim()) {
      // The password was right; only the code is still missing — not a failed attempt.
      await giveLoginSpaceFree(k, ip, name);
      return supplemented(refusal('not_signed_in', 'second_factor_required', undefined, false, true));
    }
    const onlyFallbackPath = !withPasskey && (await factorCodeLocked(k, user.id));
    const gilt = withPasskey
      ? (await k.factors.verifyAuthentication(passkeyResponse, 'second_factor', user.id)) === user.id
      : await k.factors.checkCode(user.id, code, !onlyFallbackPath);
    if (!gilt) {
      await failedAttempt(k, 'second_factor_wrong', ip, name, user.id);
      // Immediately, not only with the account lock: whoever guesses here knows the password.
      const reached = !withPasskey && (await factorCodeWrong(k, user.id));
      if (reached) hintInBackground(k, user.id, 'second_factor_locked');
      const reason = onlyFallbackPath || reached ? 'second_factor_locked' : 'second_factor_wrong';
      return supplemented(refusal('not_signed_in', reason, undefined, false, true));
    }
    if (gilt === 'wiederherstellung_alt') await oldCodesReport(k, user.id);
  }
  // Only now, after password and second factor: the plaintext only exists on a login.
  if (needsNewHash(user.password_hash))
    await k.accesses.replacePasswordHash(user.id, user.password_hash, await hashPassword(password));
  await loginSucceeded(k, ip, name);
  reportLogin({ ip, konto: Number(user.id), zugang });
  return { ok: true, user };
}

/** Whoever logs in with an old-style code learns the deadline. Before login the request
 * carries no account for row-level security yet, hence the system frame. */
async function oldCodesReport(k: AccountContext, uid: number): Promise<void> {
  const bis = (await inSystemContext('anmeldung: alte Codes', () => k.factors.status(uid))).old_codes_until;
  if (bis) hintInBackground(k, uid, 'alte_codes_ablauf', undefined, { bis });
}

/** Above the daily limit only with code or passkey and an active factor. Decided before the password check
 * and without its result: a rejection of its own afterwards would reveal the password. */
async function onlyStillWithFactor(
  k: AccountContext,
  ip: string,
  name: string,
  konto: number | undefined,
  withFactor: boolean,
): Promise<boolean> {
  if (!(await dailyLimitReached(k, ip, name))) return false;
  if (withFactor && konto !== undefined && (await k.factors.isActive(konto))) return false;
  await giveLoginSpaceFree(k, ip, name);
  reportLoginEvent('anmeldung_tagesgrenze', { ip, konto: konto ?? null });
  if (konto !== undefined) await offerRelease(k, ip, konto);
  return true;
}

/** Without a second factor the owner would only have "forgot password" at a new place: one link per
 * address and hour, at most ten a day, so a stranger does not flood the mailbox. */
async function offerRelease(k: AccountContext, ip: string, konto: number): Promise<void> {
  if (await k.factors.isActive(konto)) return;
  if ((await countRequest(k, `freigabe-mail|konto:${konto}`, ip, 3_600_000)).count > 1) return;
  if (await accountThrottled(k, 'freigabe-mail', konto, 10, TAG_MS)) return;
  hintInBackground(k, konto, 'anmeldung_freigeben', undefined, { freigabe: releaseToken(k, ip, konto), address: ip });
}

/** When the account lock is reached, the owner learns about it, at most once a day:
 * only they know whether they mistyped. */
async function failedAttempt(
  k: AccountContext,
  event: LoginEvent,
  ip: string,
  name: string,
  konto?: number,
): Promise<void> {
  reportLoginEvent(event, { ip, konto: konto ?? null });
  const { n, dailyLimit } = await loginFailed(k, ip, name);
  if (konto === undefined) return;
  if (dailyLimit) hintInBackground(k, konto, 'anmeldung_tagesgrenze');
  else if (n === MAX_ATTEMPTS && !(await accountThrottled(k, 'sperr-hinweis', konto, 1, TAG_MS)))
    hintInBackground(k, konto, 'anmeldung_gebremst');
}
