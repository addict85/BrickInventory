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
  const router = contractRouter('/api/v1/auth');
  const requireLogin = requireLoginOrToken;

  router.endpoint('GET /api/v1/auth/zweiter-faktor', requireLogin, async req => {
    return { ...(await d.factors.status(signedInUserId(req))) };
  });

  router.endpoint('POST /api/v1/auth/zweiter-faktor/einrichten', requireLogin, async (req, res) => {
    const uid = signedInUserId(req);
    // Without password only where the server enforces the factor (administrators right after
    // login); otherwise a captured session would lock out the owner. The rejection does not count towards the brake.
    const withoutPassword = req.eingabe.password === undefined || req.eingabe.password === '';
    if (withoutPassword) {
      if (!((await secondFactorRequired(d.account, req)) && consumeGracePeriod(req)))
        failDomain('ungueltig', 'aktuelles_passwort_erforderlich');
    } else if (!(await confirmWithFactor(d.account, req, res, uid, req.eingabe.password))) return;
    const geheimnis = await d.factors.beginSetup(uid);
    if (!geheimnis) failDomain('konflikt', 'zweiter_faktor_schon_aktiv');
    const u = await d.account.accountShortOf(uid);
    return { geheimnis, otpauth: d.factors.otpauthFor(geheimnis, u?.username ?? String(uid)) };
  });

  // Also with an app token (the Android app sets it up that way): whoever has token and password
  // could just as well change the password; requiring a session would protect nothing.
  router.endpoint('POST /api/v1/auth/zweiter-faktor/bestaetigen', requireLogin, async req => {
    const uid = signedInUserId(req);
    const codes = await d.account.confirmSetupThrottled(uid, accessOf(req), req.eingabe.code);
    if (!Array.isArray(codes)) failDomain(codes.art, codes.code, codes.vars);
    const header = String(req.headers.authorization || '');
    const { version } = await d.account.sitzungen.endOther(uid, {
      sitzung: req.session?.userId ? req.sessionID : null,
      token: header.startsWith('Bearer ') ? header.slice(7) : null,
      zugaenge: true,
    });
    if (req.session?.userId) req.session.sitzungsVersion = version;
    d.account.hintInBackground(uid, 'zweiter_faktor_eingerichtet');
    return { codes };
  });

  router.endpoint('POST /api/v1/auth/zweiter-faktor/abschalten', requireLogin, async (req, res) => {
    const uid = signedInUserId(req);
    if (!(await d.factors.isActive(uid))) failDomain('konflikt', 'zweiter_faktor_nicht_aktiv');
    if (!(await confirmWithFactor(d.account, req, res, uid, req.eingabe.password))) return;
    await d.factors.disable(uid);
    d.account.hintInBackground(uid, 'zweiter_faktor_abgeschaltet');
    return {};
  });

  router.endpoint('POST /api/v1/auth/zweiter-faktor/codes', requireLogin, async (req, res) => {
    const uid = signedInUserId(req);
    if (!(await d.factors.isActive(uid))) failDomain('konflikt', 'zweiter_faktor_nicht_aktiv');
    if (!(await confirmCode(d.account, req, res, uid, req.eingabe.code))) return;
    return { codes: await d.factors.renewCodes(uid) };
  });
  return router;
}
