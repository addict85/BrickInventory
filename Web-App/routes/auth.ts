/** Login, token and profile under /api/v2/auth; the sub-routers from routes/auth/ hang behind it. */
import { guardFor } from './api_v1/middleware';
import { cookieStaysFrom, sessionCookieName, sessionCookieOptions } from '../src/http/sessionCookie';
import { reportError } from '../src/infra/error';
import {
  login,
  establishSession,
  userId,
  signedInUserId,
  ipThrottle,
  confirmWithFactor,
  secondFactorRequired,
} from '../src/account/http/login';
import type { Request, Response } from 'express';
import { reportAccessChange } from '../src/account/http/accessWatch';
import { errorText, responseLanguage, failDomain, notFound, DomainError } from '../src/infra/errorTexts';
import { buildUserRouter } from './auth/users';
import { buildSecondFactorRouter } from './auth/secondFactor';
import { buildRegistrationRouter } from './auth/registration';
import { buildQrRouter } from './auth/qr';
import { buildPasskeyRouter } from './auth/passkey';
import { contractRouter } from '../src/http/contractRouter';
import {
  assertLoginAllowed,
  USERNAME_RE,
  emailValid,
  rotationDue,
  OVERLAP_MS,
  nameValid,
  devicesNameContentValid,
  reportLogin,
  emailBecomesChanged,
  type SignedIn,
  type TokenWish,
} from '../src/account';
import type { Services } from '../src/services';
type Refusal = Extract<Awaited<ReturnType<typeof login>>, { ok: false }>['absage'];
/** The same path after password and passkey. Token OR session: the session would carry the rights past the
 * token's scope. keks_fehlt always, also as false: then the UI does not guess "without HTTPS" on a 401. */
async function signedInResponses(
  d: Pick<Services, 'account'>,
  req: Request,
  res: Response,
  user: SignedIn,
  wish: TokenWish,
  withToken: boolean,
  withPassword = false,
) {
  await d.account.verwalter.cancelTakeovers(Number(user.id));
  if (!withToken)
    await establishSession(d.account, req, {
      userId: Number(user.id),
      username: user.username,
      isAdmin: user.is_admin,
      mussPasswortAendern: user.must_change_password === true,
      // Only after a password, not after a passkey alone: the basis of the grace period.
      ...(withPassword ? { passwordConfirmedAt: Date.now() } : {}),
    });
  res.json({
    success: true,
    ...(await d.account.loginResponse(user, wish, withToken, req.ip)),
    cookie_missing: !withToken && cookieStaysFrom(req),
  });
}

/** `zweiter_faktor` shows the code field (or `passkey`), `unverified` shows "Resend email?". */
function loginRejections(refusal: Refusal): never {
  const { kind, code, vars, unverified, zweiterFaktor, passkey } = refusal;
  const extra = zweiterFaktor
    ? { second_factor: true, ...(passkey ? { passkey: true } : {}) }
    : unverified
      ? { unverified: true }
      : undefined;
  throw new DomainError(kind, code, vars, extra);
}

type CheckedToken = NonNullable<Awaited<ReturnType<Services['account']['checkToken']>>['nutzer']>;

/** is_admin is the right of THIS token: with scope `app` always false. */
async function tokenUser(d: Pick<Services, 'account'>, res: Response, u: CheckedToken) {
  const due = rotationDue(u);
  if (due) res.setHeader('X-Token-Rotation', 'faellig');
  return {
    success: true,
    loggedIn: true,
    user: {
      id: u.user_id,
      username: u.username,
      is_admin: u.is_admin === true,
      mustChangePassword: u.muss_passwort_aendern === true,
      secondFactorRequired: await d.account.openFactorRequired(u.user_id, u.is_admin === true),
    },
    token_expires: u.expires_at,
    token_last_used: u.last_used,
    token_info: {
      scope: u.scope,
      expires_at: u.expires_at,
      hard_expires_at: u.hard_expires_at ?? null,
      never_expires: u.never_expires === true,
      rotated_at: u.rotated_at,
      rotation_due: due,
    },
  } as const;
}

async function sessionUser(d: Pick<Services, 'account'>, req: Request, uid: number) {
  const user = await d.account.accountShortOf(uid);
  if (!user) return null;
  return {
    success: true,
    loggedIn: true,
    user: {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin,
      mustChangePassword: user.must_change_password,
      secondFactorRequired: await secondFactorRequired(d.account, req),
    },
  } as const;
}

export function buildAuthRouter(d: Pick<Services, 'settings' | 'mail' | 'account' | 'factors' | 'profile'>) {
  const { requireLoginOrToken } = guardFor(d.account);
  const router = contractRouter('/api/v2/auth');

  // One guard for session AND token: the app has no session.
  const requireLogin = requireLoginOrToken;

  /** The ONE login for webapp and app, so both meet the same rules. */
  router.endpoint('POST /api/v2/auth/login', async (req, res) => {
    const { username, password, code: secondCode, without_token, passkey } = req.input;
    if (!devicesNameContentValid(req.input.label)) failDomain('ungueltig', 'device_name_invalid');
    const check = await login(d.account, req, username, password, secondCode, passkey);
    if (!check.ok) loginRejections(check.absage);
    await signedInResponses(d, req, res, check.user as SignedIn, req.input, without_token !== true, true);
  });

  /** End the session AND invalidate the token, so one call clears both. */
  router.endpoint('POST /api/v2/auth/logout', async (req, res) => {
    const auth = String(req.headers.authorization || '');
    // An error goes to the client: if the logout were reported as successful, the token would stay valid.
    if (auth.startsWith('Bearer ')) await d.account.deleteToken(auth.slice(7));
    // destroy only exists with session middleware; the app calls without a cookie.
    if (req.session?.destroy) {
      req.session.destroy(() => {
        // Open streams of this session check immediately, not only at the next tick.
        reportAccessChange();
        res.clearCookie(sessionCookieName(), sessionCookieOptions()).json({ success: true });
      });
      return;
    }
    return {};
  });

  /** Session OR token; without login 200 for the browser, 401 for a token. */
  router.endpoint('GET /api/v2/auth/me', async (req, res) => {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const respond = async () => {
      const session = req.session?.userId ? await sessionUser(d, req, req.session.userId) : null;
      if (session) return res.json(session);
      const p = token ? await d.account.checkToken(token, { ip: req.ip }) : { nutzer: null };
      if (p.nutzer) return res.json(await tokenUser(d, res, p.nutzer));
      if (!token) return res.json({ success: true, loggedIn: false, user: null });
      const code = 'reason' in p && p.reason ? p.reason : 'token_invalid';
      res.status(code === 'too_many_requests' ? 429 : 401).json({
        success: false,
        loggedIn: false,
        user: null,
        code,
        error: errorText(code, responseLanguage(req), code === 'too_many_requests' ? { minutes: 1 } : undefined),
      });
    };
    await respond().catch((e: unknown) => {
      // A read error is not a logout: with 401 the app would discard its token.
      reportError('auth:me', e);
      failDomain('nicht_verfuegbar', 'server_busy');
    });
  });

  /** Public: an unlimited token only applies here after the mandatory deadline. */
  router.endpoint(
    'POST /api/v2/auth/rotate-token',
    ipThrottle(d.account, 'token-rotieren', 120, 60 * 60 * 1000),
    async req => {
      const auth = String(req.headers.authorization || '');
      const alt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!alt || !(await d.account.checkToken(alt, { ip: req.ip, purpose: 'rotation' })).nutzer)
        failDomain('not_signed_in', 'token_invalid');
      const t = await d.account.rotateToken(alt, req.ip);
      if (!t) failDomain('not_signed_in', 'token_invalid');
      return {
        token: t.token,
        token_info: {
          scope: t.scope,
          expires_at: t.expires_at,
          hard_expires_at: t.hard_expires_at,
          never_expires: t.never_expires,
          rotated_at: t.rotated_at,
          rotation_due: false,
        },
        old_valid_until: t.old_valid_until,
        overlap_seconds: OVERLAP_MS / 1000,
      };
    },
  );

  /** Only from a session, with password and second factor: otherwise a
   * captured access would mint a permanent one. The mail reports it to the owner. */
  router.endpoint('POST /api/v2/auth/token-create', requireLogin, async (req, res) => {
    if (!req.session?.userId) failDomain('verboten', 'session_only');
    if (!devicesNameContentValid(req.input.label)) failDomain('ungueltig', 'device_name_invalid');
    const userId = signedInUserId(req);
    if (!(await confirmWithFactor(d.account, req, res, userId, req.input.password))) return;
    const t = await d.account.devicesTokenIssue(userId, req.input.label, req.input.scope, req.ip);
    return { token: t.token, label: t.label, never_expires: false, token_info: t.token_info };
  });

  router.endpoint('GET /api/v2/auth/profile', requireLogin, async req => {
    const user = await d.account.profile(userId(req)!);
    if (!user) notFound('user_not_found');
    return { user };
  });

  router.endpoint('PUT /api/v2/auth/profile', requireLogin, async (req, res) => {
    const { username, email, first_name, last_name, password, password_current } = req.input;
    const user = await d.account.accountFullOf(userId(req)!);
    if (!user) notFound('user_not_found');

    // The password only via /change-password: only there do all other accesses end afterwards.
    if (password) failDomain('ungueltig', 'password_via_change_password');

    // The same regex as login/register: otherwise a foreign email could be entered as
    // username, and the login searches "username OR email".
    if (username !== undefined && !USERNAME_RE.test(String(username || '')))
      failDomain('ungueltig', 'username_invalid');
    if (!nameValid(first_name) || !nameValid(last_name)) failDomain('ungueltig', 'name_invalid');

    if (emailBecomesChanged(user, email) && !emailValid(email)) failDomain('ungueltig', 'email_invalid');
    // With password (and second factor): a new address could be used to reset the
    // password; only after that does the availability check reveal whether a name or address exists.
    if (!password_current) failDomain('ungueltig', 'current_password_required');
    if (!(await confirmWithFactor(d.account, req, res, user.id, String(password_current)))) return;
    const r = await d.account.changeProfile(user, { username, email, first_name, last_name });
    if (r.emailChanged) return { emailChanged: true, emailSent: r.emailSent ?? false };
    return {};
  });

  // The own account, permanently: password and, if set up, second factor.
  router.endpoint('DELETE /api/v2/auth/account', requireLogin, async (req, res) => {
    const uid = signedInUserId(req);
    if (!(await confirmWithFactor(d.account, req, res, uid, req.input.password))) return;
    await d.account.removeAccount(uid, null);
    console.log(`[konto] Konto ${uid} hat sich selbst gelöscht`);
    req.session.destroy(() => res.clearCookie(sessionCookieName(), sessionCookieOptions()).json({ success: true }));
  });

  router.endpoint('POST /api/v2/auth/change-password', requireLogin, async (req, res) => {
    const { current, newPassword } = req.input;
    if (!current || !newPassword) failDomain('ungueltig', 'all_fields_required');
    const uid = userId(req);
    if (uid == null) failDomain('not_signed_in', 'not_signed_in');
    if (!(await confirmWithFactor(d.account, req, res, uid, String(current)))) return;
    // AFTER checking the old password: a stranger learns nothing through the new one.
    // Ends all accesses, including the own; the session is rebuilt afterwards.
    const konto = await d.account.changeOwnPassword(uid, newPassword, req.input.passkeys_revoked === true);
    if (req.session?.userId && konto) {
      await establishSession(d.account, req, {
        userId: uid,
        username: konto.username,
        isAdmin: req.session.isAdmin === true,
        mussPasswortAendern: false,
        passwordConfirmedAt: Date.now(),
      });
    }
    return {};
  });

  // Public; the throttle limits how many challenges an address creates.
  router.endpoint(
    'POST /api/v2/auth/passkey/login/options',
    ipThrottle(d.account, 'passkey-optionen', 60, 60 * 60 * 1000),
    async req => {
      const purpose = req.input.purpose === 'zweiter_faktor' ? 'zweiter_faktor' : 'anmelden';
      const options = await d.factors.authenticationOptions(purpose);
      if (!options) failDomain('nicht_verfuegbar', 'passkey_without_domain');
      return { options };
    },
  );

  /** The session for the browser; a token only on `mit_token`, as the app needs it. */
  router.endpoint(
    'POST /api/v2/auth/passkey/login',
    ipThrottle(d.account, 'passkey-anmelden', 30, 60 * 60 * 1000),
    async (req, res) => {
      if (!devicesNameContentValid(req.input.label)) failDomain('ungueltig', 'device_name_invalid');
      const uid = await d.factors.verifyAuthentication(req.input.response, 'anmelden');
      if (!uid) failDomain('not_signed_in', 'passkey_invalid');
      const user = await d.account.accountFullOf(uid);
      if (!user) failDomain('not_signed_in', 'passkey_invalid');
      const locked = assertLoginAllowed(user);
      if (locked) failDomain(locked.kind, locked.code);
      reportLogin({ ip: req.ip, konto: user.id, zugang: 'passkey' });
      await signedInResponses(d, req, res, user, req.input, req.input.with_token === true);
    },
  );

  router.attachOne(buildQrRouter(d));
  router.attachOne(buildPasskeyRouter(d));
  router.attachOne(buildUserRouter(d));
  router.attachOne(buildSecondFactorRouter(d));
  router.attachOne(buildRegistrationRouter(d));
  return router;
}
