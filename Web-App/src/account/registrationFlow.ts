/** Registration, new confirmation link and forgotten password. Every path
 * answers the same whether the account exists or not; the feedback goes by
 * mail to the address, not to the requester. */
import crypto from 'node:crypto';
import { logAndContinue, reportAndDeliver } from '../infra/error';
import { mailBasisUrl } from '../infra/baseUrl';
import { inSystemContext } from '../infra/accountContext';
import { tokenDigest } from './deviceToken';
import { computeHowRegistration, register } from './accounts';
import { targetThrottled } from './targetThrottle';
import { asDuplicate } from '../infra/errorTexts';
import type { AccountContext } from './context';

const HOUR_MS = 60 * 60 * 1000;
const RESET_VALID_MIN = 60,
  RESET_PAUSE_MIN = 15,
  MIN_DURATION_MS = 400;

/** Exception: the mail goes out even without a readable setting, then in German.
 * The owner's account is not the request's (row-level security). */
async function mailLanguage(k: AccountContext, uid: number): Promise<string> {
  const wert = inSystemContext('registrierung', () => k.settings.userValue(uid, 'language', 'de'));
  return String(await wert.catch(reportAndDeliver('registrierung:sprache', 'de')));
}

/** Without a base address no link, so no mail. */
async function sendOut(mail: (basis: string) => Promise<{ success: boolean }>): Promise<boolean> {
  const basis = mailBasisUrl();
  return basis ? (await mail(basis)).success : false;
}

/** The same minimum duration for every exit: the time does not reveal an address either. */
async function withMinDuration(work: () => Promise<void>): Promise<void> {
  const start = Date.now();
  await work();
  await new Promise(r => setTimeout(r, Math.max(0, MIN_DURATION_MS - (Date.now() - start))));
}

export interface Registration {
  username: string;
  email: string;
  first_name?: string | null | undefined;
  last_name?: string | null | undefined;
  password: string;
  lang: 'de' | 'en';
}

/** A taken address or a taken name computes as long as a new account.
 * @returns whether the mail went out */
export async function tryRegistration(k: AccountContext, r: Registration): Promise<boolean> {
  const holder = await k.accounts.accountWithEmail(r.email);
  if (holder) {
    await computeHowRegistration(r.password);
    const language = await mailLanguage(k, holder.id);
    return sendOut(() => k.mail.mailRegistrationAttempt(holder.email, language));
  }
  if (await k.accounts.nameTaken(r.username, 0)) {
    await computeHowRegistration(r.password);
    return sendOut(basis => k.mail.mailUsernameTaken(r.email, r.lang, basis));
  }
  return newAccount(k, r);
}

async function newAccount(k: AccountContext, r: Registration): Promise<boolean> {
  const token = crypto.randomBytes(32).toString('hex');
  // Only as SHA-256: with a database leak a pending link would otherwise be redeemable.
  const newId = await register(k, {
    username: r.username,
    email: r.email,
    first_name: r.first_name,
    last_name: r.last_name,
    password: r.password,
    tokenHash: tokenDigest(token),
    bis: new Date(k.clock.now() + 24 * HOUR_MS),
  }).catch(asDuplicate('username_or_email_taken'));
  if (newId)
    await inSystemContext('registrierung', () => k.settings.setUserSetting(newId, 'language', r.lang)).catch(
      logAndContinue(`registrierung:sprache ${newId}`),
    );
  const several = (await k.accounts.openRegistrations(r.email)) > 1;
  return sendOut(basis => k.mail.mailVerification(r.email, token, basis, r.lang, 'registrierung', several));
}

/** Above the limit silently no mail: a rejection would reveal that someone is harassing the address. */
export function confirmationAgainRequest(k: AccountContext, email: string): Promise<void> {
  return withMinDuration(async () => {
    const throttled = await targetThrottled(k, 'bestaetigung-ziel', email, 3, HOUR_MS);
    const token = crypto.randomBytes(32).toString('hex');
    const account = throttled
      ? null
      : await k.accounts.renewEmailTokenIfFree(email, tokenDigest(token), 24, RESET_PAUSE_MIN);
    // Do not await, otherwise the duration of the SMTP send would reveal the address.
    if (account)
      mailLanguage(k, account.id)
        .then(lang => k.mail.mailVerification(account.email, token, mailBasisUrl()!, lang))
        .catch(logAndContinue('bestaetigung-erneut:mailversand'));
  });
}

/** At most one link per account and RUECKSETZ_PAUSE_MIN: otherwise a stranger floods the mailbox. */
export function resetLinkRequest(kx: AccountContext, email: string): Promise<void> {
  return withMinDuration(async () => {
    const throttled = await targetThrottled(kx, 'forgot-ziel', email, 3, HOUR_MS);
    const user = throttled ? null : await kx.accounts.activeAccountAfterEmail(email);
    const token = crypto.randomBytes(32).toString('hex');
    const k = kx.accounts;
    if (!user || !(await k.setResetTokenIfFree(user.id, tokenDigest(token), RESET_VALID_MIN, RESET_PAUSE_MIN))) return;
    mailLanguage(kx, user.id)
      // To the STORED address: the entered one also matches via LOWER() as a Unicode variant.
      .then(lang => kx.mail.mailPasswordReset(user.email ?? '', token, mailBasisUrl()!, lang))
      .catch(logAndContinue('forgot-password:mailversand'));
  });
}

export function nameToConfirmation(k: AccountContext, token: string): Promise<string | null> {
  return k.accounts.nameForEmailToken(tokenDigest(token));
}

export function accountToResetLink(k: AccountContext, token: string) {
  return k.accounts.accountAfterResetToken(tokenDigest(token));
}
