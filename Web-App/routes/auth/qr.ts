/** Logging in by QR code; the app picks up its token once the web session confirms (src/account/qrPairing.ts). */
import { guardFor } from '../api_v1/middleware';
import { signedInUserId, ipThrottle, confirmWithFactor, perSession } from '../../src/account/http/login';
import { vertragsRouter } from '../../src/http/contractRouter';
import { assertLoginAllowed, devicesNameContentValid, reportLogin, QR_TTL_MS } from '../../src/account';
import type { Dienste } from '../../src/services';
import { fachfehler, notFound } from '../../src/infra/errorTexts';

/** The account must still be allowed to log in at the report and at the pickup. */
async function signInMay(d: Pick<Dienste, 'account'>, uid: number): Promise<boolean> {
  const user = await d.account.accountFullOf(uid);
  return !!user && !assertLoginAllowed(user);
}

/** No session: it would carry the account's full rights past scope `app`. */
async function qrPickedUp(
  d: Pick<Dienste, 'account'>,
  user: { id: number; username: string },
  token: string,
  nonce?: string | null,
) {
  return {
    success: true,
    wartet: false,
    token,
    username: user.username,
    isAdmin: false,
    userId: user.id,
    user: { id: user.id, username: user.username },
    token_info: await d.account.tokenDetails(token),
    ...(nonce ? { schluessel_nonce: nonce } : {}),
  } as const;
}

export function buildQrRouter(d: Pick<Dienste, 'account'>) {
  const { requireLoginOrToken: requireLogin } = guardFor(d.account);
  const router = vertragsRouter('/api/v1/auth');

  // The QR code only carries a one-time nonce (SHA-256 in qr_login_tokens),
  // no secret of the account; the flow is described in src/account/qrPairing.ts.
  // POST, because the route creates a nonce; a GET could be triggered from foreign pages.
  router.endpunkt('POST /api/v1/auth/qr-token', requireLogin, async (req, res) => {
    // Like /token-create: a QR code opens a new, long-lived device
    // access; only from the session, with password and second factor.
    if (!perSession(req)) fachfehler('verboten', 'nur_mit_sitzung');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.password))) return;
    // The lifetime is chosen by the signed-in session, not by the anonymous /qr-login.
    return { ...(await d.account.createQrAccess(signedInUserId(req), req.eingabe.gueltigkeit)) };
  });

  // Throttled, because the endpoint writes to the database without login.
  router.endpunkt('POST /api/v1/auth/qr-login', ipThrottle(d.account, 'qr-login', 30, 60 * 60 * 1000), async req => {
    const { token, label } = req.eingabe;
    if (!token?.startsWith('bim:')) fachfehler('ungueltig', 'token_ungueltig');
    if (!devicesNameContentValid(label)) fachfehler('ungueltig', 'geraetename_ungueltig');
    const m = await d.account.reportDevice(token, label, req.ip);
    if (!m || !(await signInMay(d, m.uid))) fachfehler('nicht_angemeldet', 'token_ungueltig');
    return { wartet: true, abholung: m.abholung, code: m.code, expires_in: QR_TTL_MS / 1000 } as const;
  });

  // The app asks every few seconds until the web session confirms or rejects.
  // With `vorschau` only the account is in the response afterwards; the token comes with the app's yes.
  router.endpunkt(
    'POST /api/v1/auth/qr-login/abholen',
    ipThrottle(d.account, 'qr-abholen', 600, 60 * 60 * 1000),
    async (req, res) => {
      if (!req.eingabe.abholung) fachfehler('ungueltig', 'token_ungueltig');
      const a = await d.account.holeQrTokenAb(
        req.eingabe.abholung,
        req.ip,
        uid => signInMay(d, uid),
        req.eingabe.vorschau === true,
      );
      if (a.stand === 'wartet') return { wartet: true } as const;
      const user = await d.account.accountShortOf(a.uid);
      if (!user) fachfehler('nicht_angemeldet', 'token_ungueltig');
      if (a.stand === 'bereit') return { wartet: false, vorschau: true, username: user.username } as const;
      reportLogin({ ip: req.ip, konto: user.id, zugang: 'qr' });
      // A login like with password or passkey: the QR code was only available with password and factor.
      await d.account.verwalter.cancelTakeovers(user.id);
      res.json(await qrPickedUp(d, user, a.token, a.keyNonce));
    },
  );

  router.endpunkt(
    'POST /api/v1/auth/qr-login/verwerfen',
    ipThrottle(d.account, 'qr-abholen', 600, 60 * 60 * 1000),
    async req => {
      if (!(await d.account.discardPickup(req.eingabe.abholung))) fachfehler('nicht_angemeldet', 'token_ungueltig');
      return {};
    },
  );

  router.endpunkt('GET /api/v1/auth/qr-kopplung/:id', requireLogin, async req => {
    if (!perSession(req)) fachfehler('verboten', 'nur_mit_sitzung');
    const s = await d.account.kopplungsStand(req.pfad.id, signedInUserId(req));
    if (!s) notFound();
    return { ...s };
  });

  router.endpunkt('POST /api/v1/auth/qr-kopplung/:id/bestaetigen', requireLogin, async req => {
    if (!perSession(req)) fachfehler('verboten', 'nur_mit_sitzung');
    const uid = signedInUserId(req);
    await d.account.confirmPairing(req.pfad.id, uid, req.eingabe.code);
    const s = await d.account.kopplungsStand(req.pfad.id, uid);
    d.account.hintInBackground(uid, 'token_neu', s?.geraet ?? 'qr-login');
    return {};
  });

  router.endpunkt('POST /api/v1/auth/qr-kopplung/:id/ablehnen', requireLogin, async req => {
    if (!perSession(req)) fachfehler('verboten', 'nur_mit_sitzung');
    if (!(await d.account.rejectPairingAb(req.pfad.id, signedInUserId(req)))) notFound();
    return {};
  });
  return router;
}
