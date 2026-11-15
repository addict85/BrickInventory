/** Anmelden per QR-Code; die App holt ihren Token, wenn die Web-Sitzung bestätigt (src/konto/qrKopplung.ts). */
import { waechterFuer } from '../api_v1/middleware';
import { angemeldeteNutzerId, ipThrottle, bestaetigeMitFaktor, perSitzung } from '../../src/konto/http/anmeldung';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import { assertLoginAllowed, geraeteNameInhaltGueltig, meldeAnmeldung, QR_TTL_MS } from '../../src/konto';
import type { Dienste } from '../../src/dienste';
import { fachfehler, nichtGefunden } from '../../src/infra/fehlerTexte';

/** Das Konto muss bei der Meldung und bei der Abholung noch anmelden dürfen. */
async function darfAnmelden(d: Pick<Dienste, 'konto'>, uid: number): Promise<boolean> {
  const user = await d.konto.kontoVollVon(uid);
  return !!user && !assertLoginAllowed(user);
}

/** Keine Sitzung: Sie trüge die vollen Rechte des Kontos an Scope `app` vorbei. */
async function qrAbgeholt(
  d: Pick<Dienste, 'konto'>,
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
    token_info: await d.konto.tokenAngaben(token),
    ...(nonce ? { schluessel_nonce: nonce } : {}),
  } as const;
}

export function baueQrRouter(d: Pick<Dienste, 'konto'>) {
  const { requireLoginOrToken: requireLogin } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1/auth');

  // Der QR-Code trägt nur eine einmalige Nonce (SHA-256 in qr_login_tokens),
  // kein Geheimnis des Kontos; den Ablauf beschreibt src/konto/qrKopplung.ts.
  // POST, weil die Route eine Nonce anlegt; ein GET liesse sich von fremden Seiten auslösen.
  router.endpunkt('POST /api/v1/auth/qr-token', requireLogin, async (req, res) => {
    // Wie /token-create: Ein QR-Code eröffnet einen neuen, langlebigen Geräte-
    // zugang; nur aus der Sitzung, mit Passwort und zweitem Faktor.
    if (!perSitzung(req)) fachfehler('verboten', 'nur_mit_sitzung');
    if (!(await bestaetigeMitFaktor(d.konto, req, res, angemeldeteNutzerId(req), req.eingabe.password))) return;
    // Die Laufzeit wählt die angemeldete Sitzung, nicht das unangemeldete /qr-login.
    return { ...(await d.konto.qrZugangErzeugen(angemeldeteNutzerId(req), req.eingabe.gueltigkeit)) };
  });

  // Gedrosselt, weil der Endpunkt ohne Anmeldung in die Datenbank schreibt.
  router.endpunkt('POST /api/v1/auth/qr-login', ipThrottle(d.konto, 'qr-login', 30, 60 * 60 * 1000), async req => {
    const { token, label } = req.eingabe;
    if (!token?.startsWith('bim:')) fachfehler('ungueltig', 'token_ungueltig');
    if (!geraeteNameInhaltGueltig(label)) fachfehler('ungueltig', 'geraetename_ungueltig');
    const m = await d.konto.meldeGeraet(token, label, req.ip);
    if (!m || !(await darfAnmelden(d, m.uid))) fachfehler('nicht_angemeldet', 'token_ungueltig');
    return { wartet: true, abholung: m.abholung, code: m.code, expires_in: QR_TTL_MS / 1000 } as const;
  });

  // Die App fragt alle paar Sekunden, bis die Web-Sitzung bestätigt oder ablehnt.
  // Mit `vorschau` steht danach nur das Konto in der Antwort; den Token holt das Ja der App.
  router.endpunkt(
    'POST /api/v1/auth/qr-login/abholen',
    ipThrottle(d.konto, 'qr-abholen', 600, 60 * 60 * 1000),
    async (req, res) => {
      if (!req.eingabe.abholung) fachfehler('ungueltig', 'token_ungueltig');
      const a = await d.konto.holeQrTokenAb(
        req.eingabe.abholung,
        req.ip,
        uid => darfAnmelden(d, uid),
        req.eingabe.vorschau === true,
      );
      if (a.stand === 'wartet') return { wartet: true } as const;
      const user = await d.konto.kontoKurzVon(a.uid);
      if (!user) fachfehler('nicht_angemeldet', 'token_ungueltig');
      if (a.stand === 'bereit') return { wartet: false, vorschau: true, username: user.username } as const;
      meldeAnmeldung({ ip: req.ip, konto: user.id, zugang: 'qr' });
      res.json(await qrAbgeholt(d, user, a.token, a.schluesselNonce));
    },
  );

  router.endpunkt(
    'POST /api/v1/auth/qr-login/verwerfen',
    ipThrottle(d.konto, 'qr-abholen', 600, 60 * 60 * 1000),
    async req => {
      if (!(await d.konto.verwirfAbholung(req.eingabe.abholung))) fachfehler('nicht_angemeldet', 'token_ungueltig');
      return {};
    },
  );

  router.endpunkt('GET /api/v1/auth/qr-kopplung/:id', requireLogin, async req => {
    if (!perSitzung(req)) fachfehler('verboten', 'nur_mit_sitzung');
    const s = await d.konto.kopplungsStand(req.pfad.id, angemeldeteNutzerId(req));
    if (!s) nichtGefunden();
    return { ...s };
  });

  router.endpunkt('POST /api/v1/auth/qr-kopplung/:id/bestaetigen', requireLogin, async req => {
    if (!perSitzung(req)) fachfehler('verboten', 'nur_mit_sitzung');
    const uid = angemeldeteNutzerId(req);
    await d.konto.bestaetigeKopplung(req.pfad.id, uid, req.eingabe.code);
    const s = await d.konto.kopplungsStand(req.pfad.id, uid);
    d.konto.hinweisNebenher(uid, 'token_neu', s?.geraet ?? 'qr-login');
    return {};
  });

  router.endpunkt('POST /api/v1/auth/qr-kopplung/:id/ablehnen', requireLogin, async req => {
    if (!perSitzung(req)) fachfehler('verboten', 'nur_mit_sitzung');
    if (!(await d.konto.lehneKopplungAb(req.pfad.id, angemeldeteNutzerId(req)))) nichtGefunden();
    return {};
  });
  return router;
}
