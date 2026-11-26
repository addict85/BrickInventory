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

async function braked(
  k: AccountContext,
  kind: Brake,
  uid: number,
  method: string,
  check: () => Promise<boolean>,
  refusal: ErrorCode,
): Promise<ConfirmationRejection | null> {
  const locked = await confirmationLocked(k, kind, uid, method);
  if (locked) {
    reportLoginEvent('bestaetigung_gesperrt', { account: uid, kind, method });
    return { kind: 'too_many', ...locked };
  }
  if (!(await check())) {
    reportLoginEvent('bestaetigung_fehlgeschlagen', { account: uid, kind, method });
    // Whoever guesses in a running session has captured an access: the owner learns about it (1×/day).
    if (await confirmationFailed(k, kind, uid, method)) {
      reportLoginEvent('confirmation_throttled', { account: uid, kind, method });
      if (!(await accountThrottled(k, 'bestaetigung-hinweis', uid, 1, 86_400_000)))
        hintInBackground(k, uid, 'confirmation_throttled');
    }
    return { kind: 'invalid', code: refusal };
  }
  await confirmationSucceeded(k, kind, uid, method);
  return null;
}

/** Confirming the setup also checks a code; without a brake
 * it could be guessed any number of times in a taken-over session.
 * @returns the recovery codes or the rejection */
export async function confirmSetupThrottled(
  k: AccountContext,
  uid: number,
  method: string,
  code: string | number | null | undefined,
): Promise<string[] | ConfirmationRejection> {
  let codes: string[] | null = null;
  const refusal = await braked(
    k,
    'faktor',
    uid,
    method,
    async () => {
      codes = await k.factors.confirmSetup(uid, String(code ?? ''));
      return !!codes;
    },
    'second_factor_wrong',
  );
  return refusal ?? codes ?? { kind: 'invalid', code: 'second_factor_wrong' };
}
