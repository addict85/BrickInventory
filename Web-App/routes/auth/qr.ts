/** Logging in by QR code; the app picks up its token once the web session confirms (src/account/qrPairing.ts). */
import { guardFor } from '../api/middleware';
import { signedInUserId, ipThrottle, confirmWithFactor, perSession } from '../../src/account/http/login';
import { contractRouter } from '../../src/http/contractRouter';
import { assertLoginAllowed, devicesNameContentValid, reportLogin, QR_TTL_MS } from '../../src/account';
import type { Services } from '../../src/services';
import { failDomain, notFound } from '../../src/infra/errorTexts';

/** The account must still be allowed to log in at the report and at the pickup. */
async function signInMay(d: Pick<Services, 'account'>, uid: number): Promise<boolean> {
  const user = await d.account.accountFullOf(uid);
  return !!user && !assertLoginAllowed(user);
}

/** No session: it would carry the account's full rights past scope `app`. */
async function qrPickedUp(
  d: Pick<Services, 'account'>,
  user: { id: number; username: string },
  token: string,
  nonce?: string | null,
) {
  return {
    success: true,
    waiting: false,
    token,
    username: user.username,
    isAdmin: false,
    userId: user.id,
    user: { id: user.id, username: user.username },
    token_info: await d.account.tokenDetails(token),
    ...(nonce ? { key_nonce: nonce } : {}),
  } as const;
}

export function buildQrRouter(d: Pick<Services, 'account'>) {
  const { requireLoginOrToken: requireLogin } = guardFor(d.account);
  const router = contractRouter('/api/v2/auth');

  // The QR code only carries a one-time nonce (SHA-256 in qr_login_tokens),
  // no secret of the account; the flow is described in src/account/qrPairing.ts.
  // POST, because the route creates a nonce; a GET could be triggered from foreign pages.
  router.endpoint('POST /api/v2/auth/qr-token', requireLogin, async (req, res) => {
    // Like /token-create: a QR code opens a new, long-lived device
    // access; only from the session, with password and second factor.
    if (!perSession(req)) failDomain('verboten', 'session_only');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.input.password))) return;
    // The lifetime is chosen by the signed-in session, not by the anonymous /qr-login.
    return { ...(await d.account.createQrAccess(signedInUserId(req), req.input.validity)) };
  });

  // Throttled, because the endpoint writes to the database without login.
  router.endpoint('POST /api/v2/auth/qr-login', ipThrottle(d.account, 'qr-login', 30, 60 * 60 * 1000), async req => {
    const { token, label } = req.input;
    if (!token?.startsWith('bim:')) failDomain('ungueltig', 'token_invalid');
    if (!devicesNameContentValid(label)) failDomain('ungueltig', 'device_name_invalid');
    const m = await d.account.reportDevice(token, label, req.ip);
    if (!m || !(await signInMay(d, m.uid))) failDomain('not_signed_in', 'token_invalid');
    return { waiting: true, pickup: m.pickup, code: m.code, expires_in: QR_TTL_MS / 1000 } as const;
  });

  // The app asks every few seconds until the web session confirms or rejects.
  // With `vorschau` only the account is in the response afterwards; the token comes with the app's yes.
  router.endpoint(
    'POST /api/v2/auth/qr-login/collect',
    ipThrottle(d.account, 'qr-abholen', 600, 60 * 60 * 1000),
    async (req, res) => {
      if (!req.input.pickup) failDomain('ungueltig', 'token_invalid');
      const a = await d.account.fetchQrToken(
        req.input.pickup,
        req.ip,
        uid => signInMay(d, uid),
        req.input.preview === true,
      );
      if (a.state === 'waiting') return { waiting: true } as const;
      const user = await d.account.accountShortOf(a.uid);
      if (!user) failDomain('not_signed_in', 'token_invalid');
      if (a.state === 'bereit') return { waiting: false, preview: true, username: user.username } as const;
      reportLogin({ ip: req.ip, konto: user.id, zugang: 'qr' });
      // A login like with password or passkey: the QR code was only available with password and factor.
      await d.account.verwalter.cancelTakeovers(user.id);
      res.json(await qrPickedUp(d, user, a.token, a.keyNonce));
    },
  );

  router.endpoint(
    'POST /api/v2/auth/qr-login/discard',
    ipThrottle(d.account, 'qr-abholen', 600, 60 * 60 * 1000),
    async req => {
      if (!req.input.pickup) failDomain('ungueltig', 'token_invalid');
      if (!(await d.account.discardPickup(req.input.pickup))) failDomain('not_signed_in', 'token_invalid');
      return {};
    },
  );

  router.endpoint('GET /api/v2/auth/qr-pairing/:id', requireLogin, async req => {
    if (!perSession(req)) failDomain('verboten', 'session_only');
    const s = await d.account.pairingState(req.pathArgs.id, signedInUserId(req));
    if (!s) notFound();
    return { ...s };
  });

  router.endpoint('POST /api/v2/auth/qr-pairing/:id/confirm', requireLogin, async req => {
    if (!perSession(req)) failDomain('verboten', 'session_only');
    const uid = signedInUserId(req);
    await d.account.confirmPairing(req.pathArgs.id, uid, req.input.code);
    const s = await d.account.pairingState(req.pathArgs.id, uid);
    d.account.hintInBackground(uid, 'token_neu', s?.device ?? 'qr-login');
    return {};
  });

  router.endpoint('POST /api/v2/auth/qr-pairing/:id/reject', requireLogin, async req => {
    if (!perSession(req)) failDomain('verboten', 'session_only');
    if (!(await d.account.rejectPairing(req.pathArgs.id, signedInUserId(req)))) notFound();
    return {};
  });
  return router;
}
