import { BcryptOverload } from './bcryptLimit';
import { passwordFits } from './passwordHash';
import {
  confirmationLocked,
  confirmationFailed,
  confirmationSucceeded,
  reportLoginEvent,
  type Brake,
} from './loginLimiter';
import type { ErrorKind, ErrorCode } from '../infra/errorTexts';
import { accountThrottled } from './targetThrottle';
import { hintInBackground } from './accountNotice';
import type { AccountContext } from './context';

/** Domain, not HTTP: the HTTP layer chooses the status (src/http/errorKind.ts). */
export type ConfirmationRejection = {
  kind: ErrorKind;
  code: ErrorCode;
  vars?: Record<string, string | number>;
  passkey?: boolean;
};
export type Factor = { code?: string | number | null | undefined; passkey?: unknown };

const leer = (w: unknown) => w === undefined || w === null || String(w).trim() === '';

async function braked(
  k: AccountContext,
  kind: Brake,
  uid: number,
  zugang: string,
  check: () => Promise<boolean>,
  refusal: ErrorCode,
): Promise<ConfirmationRejection | null> {
  const locked = await confirmationLocked(k, kind, uid, zugang);
  if (locked) {
    reportLoginEvent('bestaetigung_gesperrt', { konto: uid, kind, zugang });
    return { kind: 'zu_viele', ...locked };
  }
  if (!(await check())) {
    reportLoginEvent('bestaetigung_fehlgeschlagen', { konto: uid, kind, zugang });
    // Whoever guesses in a running session has captured an access: the owner learns about it (1×/day).
    if (await confirmationFailed(k, kind, uid, zugang)) {
      reportLoginEvent('bestaetigung_gebremst', { konto: uid, kind, zugang });
      if (!(await accountThrottled(k, 'bestaetigung-hinweis', uid, 1, 86_400_000)))
        hintInBackground(k, uid, 'bestaetigung_gebremst');
    }
    return { kind: 'ungueltig', code: refusal };
  }
  await confirmationSucceeded(k, kind, uid, zugang);
  return null;
}

/** The only way to confirm a password in a running session: with an
 * active second factor always with code or passkey. If both are missing, the
 * rejection comes before any check, so no success resets a brake.
 * @returns null if everything is right */
export async function checkConfirmation(
  k: AccountContext,
  uid: number,
  zugang: string,
  password: string | null | undefined,
  factor: Factor,
): Promise<ConfirmationRejection | null> {
  const withFactor = await k.factors.isActive(uid);
  if (withFactor && leer(factor.code) && leer(factor.passkey))
    return {
      kind: 'ungueltig',
      code: 'second_factor_required',
      ...((await k.factors.hasPasskeys(uid)) ? { passkey: true } : {}),
    };
  const pw = await braked(
    k,
    'passwort',
    uid,
    zugang,
    async () => {
      const u = await k.accesses.passwordHash(uid);
      return !!u && typeof password === 'string' && password !== '' && passwordFits(password, u.password_hash);
    },
    'current_password_wrong',
  ).catch((e: unknown) => {
    if (e instanceof BcryptOverload) return { kind: 'nicht_verfuegbar', code: 'server_busy' } as ConfirmationRejection;
    throw e;
  });
  if (pw || !withFactor) return pw;
  return leer(factor.passkey)
    ? braked(
        k,
        'faktor',
        uid,
        zugang,
        async () => !!(await k.factors.checkCode(uid, factor.code)),
        'second_factor_wrong',
      )
    : braked(
        k,
        'faktor',
        uid,
        zugang,
        async () => (await k.factors.verifyAuthentication(factor.passkey, 'zweiter_faktor', uid)) === uid,
        'passkey_invalid',
      );
}

/** Only the code, with the brake for codes. */
export function checkCodeConfirmation(
  k: AccountContext,
  uid: number,
  zugang: string,
  code: string | number | null | undefined,
): Promise<ConfirmationRejection | null> {
  return braked(k, 'faktor', uid, zugang, async () => !!(await k.factors.checkCode(uid, code)), 'second_factor_wrong');
}

/** Confirming the setup also checks a code; without a brake
 * it could be guessed any number of times in a taken-over session.
 * @returns the recovery codes or the rejection */
export async function confirmSetupThrottled(
  k: AccountContext,
  uid: number,
  zugang: string,
  code: string | number | null | undefined,
): Promise<string[] | ConfirmationRejection> {
  let codes: string[] | null = null;
  const refusal = await braked(
    k,
    'faktor',
    uid,
    zugang,
    async () => {
      codes = await k.factors.confirmSetup(uid, String(code ?? ''));
      return !!codes;
    },
    'second_factor_wrong',
  );
  return refusal ?? codes ?? { kind: 'ungueltig', code: 'second_factor_wrong' };
}
