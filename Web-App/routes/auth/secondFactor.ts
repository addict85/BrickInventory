/** The own second factor (src/factors/secondFactor.ts). Setting up and
 * turning off require the password: whoever only captures an open session
 * must neither lock out the account nor dismantle the protection. */
import { guardFor } from '../api_v1/middleware';
import {
  signedInUserId,
  confirmCode,
  confirmWithFactor,
  accessOf,
  secondFactorRequired,
  consumeGracePeriod,
} from '../../src/account/http/login';
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

  router.endpoint('POST /api/v2/auth/second-factor/setup', requireLogin, async (req, res) => {
    const uid = signedInUserId(req);
    // Without password only where the server enforces the factor (administrators right after
    // login); otherwise a captured session would lock out the owner. The rejection does not count towards the brake.
    const withoutPassword = req.input.password === undefined || req.input.password === '';
    if (withoutPassword) {
      if (!((await secondFactorRequired(d.account, req)) && consumeGracePeriod(req)))
        failDomain('ungueltig', 'current_password_required');
    } else if (!(await confirmWithFactor(d.account, req, res, uid, req.input.password))) return;
    const secret = await d.factors.beginSetup(uid);
    if (!secret) failDomain('konflikt', 'second_factor_already_active');
    const u = await d.account.accountShortOf(uid);
    return { secret, otpauth: d.factors.otpauthFor(secret, u?.username ?? String(uid)) };
  });

  // Also with an app token (the Android app sets it up that way): whoever has token and password
  // could just as well change the password; requiring a session would protect nothing.
  router.endpoint('POST /api/v2/auth/second-factor/confirm', requireLogin, async req => {
    const uid = signedInUserId(req);
    const codes = await d.account.confirmSetupThrottled(uid, accessOf(req), req.input.code);
    if (!Array.isArray(codes)) failDomain(codes.kind, codes.code, codes.vars);
    const header = String(req.headers.authorization || '');
    const { version } = await d.account.sitzungen.endOther(uid, {
      sitzung: req.session?.userId ? req.sessionID : null,
      token: header.startsWith('Bearer ') ? header.slice(7) : null,
      accesses: true,
    });
    if (req.session?.userId) req.session.sitzungsVersion = version;
    d.account.hintInBackground(uid, 'zweiter_faktor_eingerichtet');
    return { codes };
  });

  router.endpoint('POST /api/v2/auth/second-factor/disable', requireLogin, async (req, res) => {
    const uid = signedInUserId(req);
    if (!(await d.factors.isActive(uid))) failDomain('konflikt', 'second_factor_not_active');
    if (!(await confirmWithFactor(d.account, req, res, uid, req.input.password))) return;
    await d.factors.disable(uid);
    d.account.hintInBackground(uid, 'zweiter_faktor_abgeschaltet');
    return {};
  });

  router.endpoint('POST /api/v2/auth/second-factor/codes', requireLogin, async (req, res) => {
    const uid = signedInUserId(req);
    if (!(await d.factors.isActive(uid))) failDomain('konflikt', 'second_factor_not_active');
    if (!(await confirmCode(d.account, req, res, uid, req.input.code))) return;
    return { codes: await d.factors.renewCodes(uid) };
  });
  return router;
}
