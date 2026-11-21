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
  art: ErrorKind;
  code: ErrorCode;
  vars?: Record<string, string | number>;
  passkey?: boolean;
};
export type Faktor = { code?: string | number | null | undefined; passkey?: unknown };

const leer = (w: unknown) => w === undefined || w === null || String(w).trim() === '';

async function gebremst(
  k: AccountContext,
  art: Brake,
  uid: number,
  zugang: string,
  check: () => Promise<boolean>,
  absage: ErrorCode,
): Promise<ConfirmationRejection | null> {
  const gesperrt = await confirmationLocked(k, art, uid, zugang);
  if (gesperrt) {
    reportLoginEvent('bestaetigung_gesperrt', { konto: uid, art, zugang });
    return { art: 'zu_viele', ...gesperrt };
  }
  if (!(await check())) {
    reportLoginEvent('bestaetigung_fehlgeschlagen', { konto: uid, art, zugang });
    // Whoever guesses in a running session has captured an access: the owner learns about it (1×/day).
    if (await confirmationFailed(k, art, uid, zugang)) {
      reportLoginEvent('bestaetigung_gebremst', { konto: uid, art, zugang });
      if (!(await accountThrottled(k, 'bestaetigung-hinweis', uid, 1, 86_400_000)))
        hintInBackground(k, uid, 'bestaetigung_gebremst');
    }
    return { art: 'ungueltig', code: absage };
  }
  await confirmationSucceeded(k, art, uid, zugang);
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
  passwort: string | null | undefined,
  faktor: Faktor,
): Promise<ConfirmationRejection | null> {
  const withFactor = await k.factors.isActive(uid);
  if (withFactor && leer(faktor.code) && leer(faktor.passkey))
    return {
      art: 'ungueltig',
      code: 'zweiter_faktor_noetig',
      ...((await k.factors.hasPasskeys(uid)) ? { passkey: true } : {}),
    };
  const pw = await gebremst(
    k,
    'passwort',
    uid,
    zugang,
    async () => {
      const u = await k.zugaenge.passwortHash(uid);
      return !!u && typeof passwort === 'string' && passwort !== '' && passwordFits(passwort, u.password_hash);
    },
    'aktuelles_passwort_falsch',
  ).catch((e: unknown) => {
    if (e instanceof BcryptOverload)
      return { art: 'nicht_verfuegbar', code: 'server_ausgelastet' } as ConfirmationRejection;
    throw e;
  });
  if (pw || !withFactor) return pw;
  return leer(faktor.passkey)
    ? gebremst(
        k,
        'faktor',
        uid,
        zugang,
        async () => !!(await k.factors.checkCode(uid, faktor.code)),
        'zweiter_faktor_falsch',
      )
    : gebremst(
        k,
        'faktor',
        uid,
        zugang,
        async () => (await k.factors.verifyAuthentication(faktor.passkey, 'zweiter_faktor', uid)) === uid,
        'passkey_ungueltig',
      );
}

/** Only the code, with the brake for codes. */
export function checkCodeConfirmation(
  k: AccountContext,
  uid: number,
  zugang: string,
  code: string | number | null | undefined,
): Promise<ConfirmationRejection | null> {
  return gebremst(
    k,
    'faktor',
    uid,
    zugang,
    async () => !!(await k.factors.checkCode(uid, code)),
    'zweiter_faktor_falsch',
  );
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
  const absage = await gebremst(
    k,
    'faktor',
    uid,
    zugang,
    async () => {
      codes = await k.factors.confirmSetup(uid, String(code ?? ''));
      return !!codes;
    },
    'zweiter_faktor_falsch',
  );
  return absage ?? codes ?? { art: 'ungueltig', code: 'zweiter_faktor_falsch' };
}
