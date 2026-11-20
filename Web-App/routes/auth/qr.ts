/** Anmelden per QR-Code; die App holt ihren Token, wenn die Web-Sitzung bestätigt (src/account/qrPairing.ts). */
import { guardFor } from '../api_v1/middleware';
import { signedInUserId, ipThrottle, confirmWithFactor, perSession } from '../../src/account/http/login';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import { assertLoginAllowed, devicesNameContentValid, reportLogin, QR_TTL_MS } from '../../src/account';
import type { Dienste } from '../../src/dienste';
import { fachfehler, notFound } from '../../src/infra/fehlerTexte';

/** Das Konto muss bei der Meldung und bei der Abholung noch anmelden dürfen. */
async function signInMay(d: Pick<Dienste, 'account'>, uid: number): Promise<boolean> {
  const user = await d.account.accountFullOf(uid);
  return !!user && !assertLoginAllowed(user);
}

/** Keine Sitzung: Sie trüge die vollen Rechte des Kontos an Scope `app` vorbei. */
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

  // Der QR-Code trägt nur eine einmalige Nonce (SHA-256 in qr_login_tokens),
  // kein Geheimnis des Kontos; den Ablauf beschreibt src/account/qrPairing.ts.
  // POST, weil die Route eine Nonce anlegt; ein GET liesse sich von fremden Seiten auslösen.
  router.endpunkt('POST /api/v1/auth/qr-token', requireLogin, async (req, res) => {
    // Wie /token-create: Ein QR-Code eröffnet einen neuen, langlebigen Geräte-
    // zugang; nur aus der Sitzung, mit Passwort und zweitem Faktor.
    if (!perSession(req)) fachfehler('verboten', 'nur_mit_sitzung');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.password))) return;
    // Die Laufzeit wählt die angemeldete Sitzung, nicht das unangemeldete /qr-login.
    return { ...(await d.account.createQrAccess(signedInUserId(req), req.eingabe.gueltigkeit)) };
  });

  // Gedrosselt, weil der Endpunkt ohne Anmeldung in die Datenbank schreibt.
  router.endpunkt('POST /api/v1/auth/qr-login', ipThrottle(d.account, 'qr-login', 30, 60 * 60 * 1000), async req => {
    const { token, label } = req.eingabe;
    if (!token?.startsWith('bim:')) fachfehler('ungueltig', 'token_ungueltig');
    if (!devicesNameContentValid(label)) fachfehler('ungueltig', 'geraetename_ungueltig');
    const m = await d.account.reportDevice(token, label, req.ip);
    if (!m || !(await signInMay(d, m.uid))) fachfehler('nicht_angemeldet', 'token_ungueltig');
    return { wartet: true, abholung: m.abholung, code: m.code, expires_in: QR_TTL_MS / 1000 } as const;
  });

  // Die App fragt alle paar Sekunden, bis die Web-Sitzung bestätigt oder ablehnt.
  // Mit `vorschau` steht danach nur das Konto in der Antwort; den Token holt das Ja der App.
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
      // Eine Anmeldung wie mit Passwort oder Passkey: Den QR-Code gab es nur mit Passwort und Faktor.
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
