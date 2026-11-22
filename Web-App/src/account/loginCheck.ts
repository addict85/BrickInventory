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
  const id = leer ? undefined : await k.accounts.accountToEmailToken(hash);
  if (id === undefined) failDomain('invalid', 'confirmation_link_invalid');
  const ok = await accessTransaction(k, t => t.accounts.adoptEmailNew(id, hash)).catch(duplicateAs(false));
  if (!ok) {
    await k.accounts.discardEmailNew(id, hash);
    failDomain('invalid', 'email_taken');
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
  if (!user.is_active) return { kind: 'forbidden', code: 'account_deactivated' };
  if (user.registration_pending === true && !user.is_admin)
    return { kind: 'forbidden', code: 'email_not_confirmed', unverified: true };
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
  secondFactor?: boolean;
  /** Instead of the code a passkey response works too. */
  passkey?: boolean;
}

export type LoginResult = { ok: true; user: Record<string, unknown> } | { ok: false; refusal: LoginRejection };

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
    refusal: {
      kind,
      code,
      ...(vars ? { vars } : {}),
      ...(unverified ? { unverified: true } : {}),
      ...(secondFactor ? { secondFactor: true } : {}),
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
  if (!username || !password) return refusal('invalid', 'username_password');
  if (!loginNameValid(username)) return refusal('invalid', 'enter_name_or_email');

  const ip = origin.ip || '?';
  const name = String(username);
  const locked = await loginAllowed(k, ip, name);
  if (locked) {
    reportLoginEvent('anmeldung_gesperrt', {
      ip,
      account: (await k.accesses.accountToLogin(name))?.id ?? null,
    });
    return refusal('too_many', locked.code, locked.vars);
  }

  const user = await k.accesses.accountToLogin(name);
  const withFactor = (passkeyResponse !== undefined && passkeyResponse !== null) || !!String(code ?? '').trim();
  if (await onlyStillWithFactor(k, ip, name, user?.id, withFactor))
    return refusal('too_many', 'account_daily_limit', undefined, false, true);
  const passwordRefusal = await checkPassword(k, ip, name, user, password);
  if (passwordRefusal || !user) return passwordRefusal ?? refusal('not_signed_in', 'credentials_invalid');
  const factor = await checkSecondFactor(k, { ip, name, uid: user.id }, code, passkeyResponse);
  if ('refused' in factor) return factor.refused;
  const method = factor.method;
  // Only now, after password and second factor: the plaintext only exists on a login.
  if (needsNewHash(user.password_hash))
    await k.accesses.replacePasswordHash(user.id, user.password_hash, await hashPassword(password));
  await loginSucceeded(k, ip, name);
  reportLogin({ ip, account: Number(user.id), method });
  return { ok: true, user };
}

type LoginUser = Awaited<ReturnType<AccountContext['accesses']['accountToLogin']>>;

/** Even without a hit, against DUMMY_HASH: the same time for unknown names. Whoever last logged in
 * from here waits at the front under load: a flood of foreign addresses does not lock them out.
 * @returns the refusal, or null when the password fits an account that may log in */
async function checkPassword(
  k: AccountContext,
  ip: string,
  name: string,
  user: LoginUser,
  password: string,
): Promise<LoginResult | null> {
  const priority = await knownLogin(k, ip, name);
  let passwordMatches: boolean;
  try {
    passwordMatches = await passwordFits(password, user?.password_hash || DUMMY_HASH, priority);
  } catch (e) {
    if (!(e instanceof BcryptOverload)) throw e;
    await giveLoginSpaceFree(k, ip, name);
    return refusal('unavailable', 'server_busy');
  }
  // Locked or unconfirmed like a wrong password: a rejection of its own would reveal that it was right.
  if (!user || !passwordMatches || assertLoginAllowed(user)) {
    await failedAttempt(k, 'anmeldung_fehlgeschlagen', ip, name, user?.id);
    return refusal('not_signed_in', 'credentials_invalid');
  }
  return null;
}

/** The second factor, once the password was right. A passkey replaces the code — bound to THIS
 * account, whose password was right. */
async function checkSecondFactor(
  k: AccountContext,
  who: { ip: string; name: string; uid: number },
  code: string | number | null | undefined,
  passkeyResponse: unknown,
): Promise<{ refused: LoginResult } | { method: LoginMethod }> {
  const { ip, name, uid } = who;
  if (!(await k.factors.isActive(uid))) return { method: 'passwort' };
  const withPasskey = passkeyResponse !== undefined && passkeyResponse !== null;
  const hasPasskey = await k.factors.hasPasskeys(uid);
  const refused = (e: LoginResult) => {
    if (!e.ok && hasPasskey) e.refusal.passkey = true;
    return { refused: e };
  };
  if (!withPasskey && !String(code ?? '').trim()) {
    // The password was right; only the code is still missing — not a failed attempt.
    await giveLoginSpaceFree(k, ip, name);
    return refused(refusal('not_signed_in', 'second_factor_required', undefined, false, true));
  }
  const onlyFallbackPath = !withPasskey && (await factorCodeLocked(k, uid));
  const valid = withPasskey
    ? (await k.factors.verifyAuthentication(passkeyResponse, 'second_factor', uid)) === uid
    : await k.factors.checkCode(uid, code, !onlyFallbackPath);
  if (!valid) {
    await failedAttempt(k, 'second_factor_wrong', ip, name, uid);
    // Immediately, not only with the account lock: whoever guesses here knows the password.
    const reached = !withPasskey && (await factorCodeWrong(k, uid));
    if (reached) hintInBackground(k, uid, 'second_factor_locked');
    const reason = onlyFallbackPath || reached ? 'second_factor_locked' : 'second_factor_wrong';
    return refused(refusal('not_signed_in', reason, undefined, false, true));
  }
  if (valid === 'wiederherstellung_alt') await oldCodesReport(k, uid);
  return { method: withPasskey ? 'passwort+passkey' : 'passwort+code' };
}

/** Whoever logs in with an old-style code learns the deadline. Before login the request
 * carries no account for row-level security yet, hence the system frame. */
async function oldCodesReport(k: AccountContext, uid: number): Promise<void> {
  const bis = (await inSystemContext('anmeldung: alte Codes', () => k.factors.status(uid))).old_codes_until;
  if (bis) hintInBackground(k, uid, 'old_codes_expiry', undefined, { bis });
}

/** Above the daily limit only with code or passkey and an active factor. Decided before the password check
 * and without its result: a rejection of its own afterwards would reveal the password. */
async function onlyStillWithFactor(
  k: AccountContext,
  ip: string,
  name: string,
  account: number | undefined,
  withFactor: boolean,
): Promise<boolean> {
  if (!(await dailyLimitReached(k, ip, name))) return false;
  if (withFactor && account !== undefined && (await k.factors.isActive(account))) return false;
  await giveLoginSpaceFree(k, ip, name);
  reportLoginEvent('login_daily_limit', { ip, account: account ?? null });
  if (account !== undefined) await offerRelease(k, ip, account);
  return true;
}

/** Without a second factor the owner would only have "forgot password" at a new place: one link per
 * address and hour, at most ten a day, so a stranger does not flood the mailbox. */
async function offerRelease(k: AccountContext, ip: string, account: number): Promise<void> {
  if (await k.factors.isActive(account)) return;
  if ((await countRequest(k, `freigabe-mail|konto:${account}`, ip, 3_600_000)).count > 1) return;
  if (await accountThrottled(k, 'freigabe-mail', account, 10, TAG_MS)) return;
  hintInBackground(k, account, 'login_release', undefined, { releaseToken: releaseToken(k, ip, account), address: ip });
}

/** When the account lock is reached, the owner learns about it, at most once a day:
 * only they know whether they mistyped. */
async function failedAttempt(
  k: AccountContext,
  event: LoginEvent,
  ip: string,
  name: string,
  account?: number,
): Promise<void> {
  reportLoginEvent(event, { ip, account: account ?? null });
  const { n, dailyLimit } = await loginFailed(k, ip, name);
  if (account === undefined) return;
  if (dailyLimit) hintInBackground(k, account, 'login_daily_limit');
  else if (n === MAX_ATTEMPTS && !(await accountThrottled(k, 'sperr-hinweis', account, 1, TAG_MS)))
    hintInBackground(k, account, 'login_throttled');
}
