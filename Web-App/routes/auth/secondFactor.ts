/** The own second factor (src/factors/secondFactor.ts). It protects the login;
 * inside a signed-in session setting up, turning off and new recovery codes need
 * no password or code again, as the owner decided. */
import { guardFor } from '../api/middleware';
import { signedInUserId, accessOf } from '../../src/account/http/login';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { failDomain } from '../../src/infra/errorTexts';

export function buildSecondFactorRouter(d: Pick<Services, 'account' | 'factors'>) {
  const { requireLoginOrToken } = guardFor(d.account);
  const router = contractRouter('/api/v2/auth');
  const requireLogin = requireLoginOrToken;

  router.endpoint('GET /api/v2/auth/second-factor', requireLogin, async req => {
    return { ...(await d.factors.status(signedInUserId(req))) };
  });

  router.endpoint('POST /api/v2/auth/second-factor/setup', requireLogin, async req => {
    const uid = signedInUserId(req);
    const secret = await d.factors.beginSetup(uid);
    if (!secret) failDomain('conflict', 'second_factor_already_active');
    const u = await d.account.accountShortOf(uid);
    return { secret, otpauth: d.factors.otpauthFor(secret, u?.username ?? String(uid)) };
  });

  // Also with an app token (the Android app sets it up that way): whoever has the token
  // could just as well change the password; requiring a session would protect nothing.
  router.endpoint('POST /api/v2/auth/second-factor/confirm', requireLogin, async req => {
    const uid = signedInUserId(req);
    const codes = await d.account.confirmSetupThrottled(uid, accessOf(req), req.input.code);
    if (!Array.isArray(codes)) failDomain(codes.kind, codes.code, codes.vars);
    const header = String(req.headers.authorization || '');
    const { version } = await d.account.sessions.endOther(uid, {
      session: req.session?.userId ? req.sessionID : null,
      token: header.startsWith('Bearer ') ? header.slice(7) : null,
      accesses: true,
    });
    if (req.session?.userId) req.session.sitzungsVersion = version;
    d.account.hintInBackground(uid, 'second_factor_enabled');
    return { codes };
  });

  router.endpoint('POST /api/v2/auth/second-factor/disable', requireLogin, async req => {
    const uid = signedInUserId(req);
    if (!(await d.factors.isActive(uid))) failDomain('conflict', 'second_factor_not_active');
    await d.factors.disable(uid);
    d.account.hintInBackground(uid, 'second_factor_disabled');
    return {};
  });

  // `code` is still accepted from older clients but no longer checked.
  router.endpoint('POST /api/v2/auth/second-factor/codes', requireLogin, async req => {
    const uid = signedInUserId(req);
    if (!(await d.factors.isActive(uid))) failDomain('conflict', 'second_factor_not_active');
    return { codes: await d.factors.renewCodes(uid) };
  });
  return router;
}
