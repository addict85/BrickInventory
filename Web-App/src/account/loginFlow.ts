/** What happens after a successful check: issue token, change password,
 * create QR access. The routes in routes/auth.ts check, call and respond;
 * session and cookie stay there, because they hang on the request. */
import * as K from './accounts';
import { createToken, runtimeDays, tokenDays } from './deviceToken';
import { tokenDetails, tokenLabel, tokenScope } from './tokenRequest';
import { hintInBackground } from './accountNotice';
import * as QR from './qrPairing';
import { baseUrl, hintWithoutBaseUrl, viaTls } from '../infra/baseUrl';
import { tlsStand } from '../infra/tlsRoot';
import { failDomain } from '../infra/errorTexts';
import { passwordLack } from '../infra/passwordRule';
import { attempts, valueOr } from '../infra/result';
import type { AccountContext } from './context';

export type SignedIn = { id: number | string; username: string; is_admin: boolean; must_change_password?: boolean };
/** What the token should be called and how long it applies; the contract checks both login paths. */
export type TokenWish = { label?: unknown; never_expires?: boolean | undefined; scope?: string | undefined };

/** The response after password or passkey. Without `withToken` the session carries it
 * (httpOnly cookie); a token would be readable by script in the browser. */
export async function loginResponse(
  k: AccountContext,
  user: SignedIn,
  wish: TokenWish,
  withToken: boolean,
  ip: string | undefined,
) {
  const uid = Number(user.id);
  let token: string | null = null;
  if (withToken) {
    const permanent = wish.never_expires === true;
    // A token the database never saw would run into a 401 in the SSE channel.
    const fresh = await attempts(
      'login:token',
      createToken(k, uid, tokenLabel(wish.label, 'webapp-session'), permanent, null, {
        scope: tokenScope(wish.scope),
        ip,
      }),
    );
    token = valueOr(fresh, null);
    if (!token) failDomain('internal', 'token_not_issued');
    hintInBackground(k, uid, 'token_added', tokenLabel(wish.label, 'webapp-session'));
  }
  // Administrator rights are carried by the session and a token with scope `voll`, not `app`.
  const admin = user.is_admin && (!withToken || tokenScope(wish.scope) === 'voll');
  return {
    ...(token ? { token, token_info: await tokenDetails(k, token) } : {}),
    // With a sliding deadline nothing is unlimited.
    never_expires: false as const,
    user: {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin,
      mustChangePassword: user.must_change_password,
      secondFactorRequired: await K.openFactorRequired(k, uid, admin),
    },
  };
}

/** A permanent device access; the mail reports it to the owner. */
export async function devicesTokenIssue(
  k: AccountContext,
  uid: number,
  label: unknown,
  scope: unknown,
  ip: string | undefined,
) {
  const name = tokenLabel(label, 'Android App');
  const token = await createToken(k, uid, name, true, null, { scope: tokenScope(scope), ip });
  hintInBackground(k, uid, 'token_added', name);
  return { token, label: name, token_info: await tokenDetails(k, token) };
}

/** Refuse instead of guessing without an address: a wrong address in the QR code would
 * only show up later in another network. */
export async function createQrAccess(k: AccountContext, uid: number, validity: unknown) {
  const basis = baseUrl();
  if (!basis) {
    hintWithoutBaseUrl('auth:qr', 'der QR-Code zur Verknuepfung der App laesst sich nicht erzeugen.');
    failDomain('unavailable', 'qr_without_base_url');
  }
  // The QR code says how long the access will run: the bound applies here already.
  const days = tokenDays(k, runtimeDays(validity));
  const { token, pairing } = await QR.create(k, uid, days);
  hintInBackground(k, uid, 'qr_access_added');
  // `fp` only with TLS: the app pins the root of the internal CA with it.
  const ca = viaTls(basis) ? await tlsStand() : null;
  return {
    token,
    pairing,
    expires_in: QR.QR_TTL_MS / 1000,
    token_days: days,
    url: basis,
    ...(ca ? { fp: ca.fp, cert_sha256: ca.cert_sha256 } : {}),
  };
}

/** The name from the table: with an app token there is no session that carries it. */
export async function changeOwnPasswordChecked(k: AccountContext, uid: number, fresh: string, revokePasskeys: boolean) {
  const account = await k.accounts.accountShort(uid);
  const mangel = passwordLack(fresh, account?.username);
  if (mangel) failDomain('invalid', mangel);
  await K.changeOwnPassword(k, uid, fresh, { revokePasskeys });
  hintInBackground(k, uid, 'password_changed');
  return account;
}
