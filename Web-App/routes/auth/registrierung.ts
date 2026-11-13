/** Ohne Anmeldung: Registrierung, E-Mail-Bestätigung und Passwort vergessen.
 * Jede Antwort verrät gleich wenig darüber, ob es ein Konto gibt. */
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { ipThrottle } from '../../src/konto/http/anmeldung';
import { passwortMangel } from '../../src/infra/passwortRegel';
import { fehlerText, antwortSprache } from '../../src/infra/fehlerTexte';
import { basisUrl, hinweisOhneBasisUrl } from '../../src/infra/basisUrl';
import { vertragsRouter, type Antwort, type OffeneAnfrage } from '../../src/http/vertragsRouter';
import { USERNAME_RE, emailGueltig, nameGueltig, vertrauenspartei, hashToken } from '../../src/konto';
import type { Dienste } from '../../startup/verdrahtung';

/** Der Grund der ersten Absage, oder null, wenn die Eingabe genügt. */
function registrierungsMangel(e: OffeneAnfrage<'POST /api/v1/auth/register'>['eingabe']) {
  if (!e.username || !e.email || !e.password) return 'registrierung_felder' as const;
  const mangel = passwortMangel(e.password, e.username);
  if (mangel) return mangel;
  if (!emailGueltig(e.email)) return 'email_ungueltig' as const;
  if (!USERNAME_RE.test(e.username)) return 'benutzername_ungueltig' as const;
  if (!nameGueltig(e.first_name) || !nameGueltig(e.last_name)) return 'name_ungueltig' as const;
  return null;
}

export function baueRegistrierungRouter(d: Dienste) {
  const router = vertragsRouter();

  // Die Anmeldemaske zeigt nur Wege, die dieser Server auch kann; ohne Mail endete die Registrierung in einem Konto, das niemand bestätigen kann.
  router.get('/registration-status', async (_req, res: Antwort<'GET /api/v1/auth/registration-status'>) => {
    const mail = await d.mail.mailBereit();
    res.json({
      enabled: mail && (await d.einstellungen.registrierungOffen()),
      passkey: !!vertrauenspartei(),
      passwort_vergessen: mail,
      mail_versand: mail,
    });
  });

  router.post(
    '/register',
    ipThrottle(d.konto, 'register', 5, 60 * 60 * 1000),
    async (req: OffeneAnfrage<'POST /api/v1/auth/register'>, res: Antwort<'POST /api/v1/auth/register'>) => {
      const { username, email, first_name, last_name, password, language } = req.eingabe;
      if (!(await d.einstellungen.registrierungOffen()) || !(await d.mail.mailBereit()))
        return sendeFehler(req, res, 403, 'registrierung_deaktiviert');
      const mangel = registrierungsMangel(req.eingabe);
      if (mangel || !username || !email || !password)
        return sendeFehler(req, res, 400, mangel ?? 'registrierung_felder');
      // Zählt jeden Versuch, ob es die Adresse gibt oder nicht: Die Absage verrät nichts.
      const ziel = await d.konto.zielGedrosselt('register-ziel', email, 3, 60 * 60 * 1000);
      if (ziel) return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: ziel.waitMin });
      const gesendet = await d.konto.registrierungVersuchen({
        username,
        email,
        first_name,
        last_name,
        passwort: password,
        lang: language === 'en' ? 'en' : 'de',
      });
      res.json({
        success: true,
        message: gesendet
          ? 'Konto erstellt. Bitte bestätige deine E-Mail-Adresse.'
          : 'Konto erstellt, aber die Bestätigungsmail ging nicht hinaus. Der Verwalter kann das Konto freischalten.',
        email_sent: gesendet,
      });
    },
  );

  // Wie /forgot-password: gleiche Antwort und Dauer, ob es ein unbestätigtes Konto gibt oder nicht.
  router.post(
    '/bestaetigung-erneut',
    ipThrottle(d.konto, 'bestaetigung-erneut', 5, 60 * 60 * 1000),
    async (
      req: OffeneAnfrage<'POST /api/v1/auth/bestaetigung-erneut'>,
      res: Antwort<'POST /api/v1/auth/bestaetigung-erneut'>,
    ) => {
      const { email } = req.eingabe;
      if (!emailGueltig(email)) return sendeFehler(req, res, 400, email ? 'email_ungueltig' : 'email_erforderlich');
      if (!basisUrl()) {
        hinweisOhneBasisUrl('bestaetigung-erneut', 'Bestätigungs-Mails werden nicht versendet.');
        return sendeFehler(req, res, 503, 'bestaetigung_nicht_eingerichtet');
      }
      await d.konto.bestaetigungErneutAnfordern(String(email));
      res.json({ success: true, message: fehlerText('bestaetigung_gesendet', antwortSprache(req)) });
    },
  );

  router.post(
    '/email-bestaetigen/vorschau',
    ipThrottle(d.konto, 'email-vorschau', 30, 60 * 60 * 1000),
    async (
      req: OffeneAnfrage<'POST /api/v1/auth/email-bestaetigen/vorschau'>,
      res: Antwort<'POST /api/v1/auth/email-bestaetigen/vorschau'>,
    ) => {
      const token = req.eingabe.token;
      const username = token ? await d.konto.nameZuBestaetigung(String(token)) : null;
      if (!username) return sendeFehler(req, res, 400, 'bestaetigungslink_ungueltig');
      res.json({ success: true, username });
    },
  );

  router.post(
    '/email-bestaetigen',
    ipThrottle(d.konto, 'email-bestaetigen', 30, 60 * 60 * 1000),
    async (
      req: OffeneAnfrage<'POST /api/v1/auth/email-bestaetigen'>,
      res: Antwort<'POST /api/v1/auth/email-bestaetigen'>,
    ) => {
      const e = await d.konto.verifiziereEmailToken(req.eingabe.token);
      if (!e.ok)
        return sendeFehler(req, res, 400, e.grund === 'vergeben' ? 'email_vergeben' : 'bestaetigungslink_ungueltig');
      res.json({ success: true });
    },
  );

  router.post(
    '/forgot-password',
    ipThrottle(d.konto, 'forgot-password', 5, 60 * 60 * 1000),
    async (
      req: OffeneAnfrage<'POST /api/v1/auth/forgot-password'>,
      res: Antwort<'POST /api/v1/auth/forgot-password'>,
    ) => {
      const { email } = req.eingabe;
      if (!emailGueltig(email)) return sendeFehler(req, res, 400, email ? 'email_ungueltig' : 'email_erforderlich');
      // Vor der Nutzersuche, damit die Absage nichts über die Adresse verrät.
      if (!basisUrl()) {
        hinweisOhneBasisUrl('passwort-reset', 'Passwort-vergessen-Mails werden nicht versendet.');
        return sendeFehler(req, res, 503, 'passwort_reset_nicht_eingerichtet');
      }
      // Immer dieselbe Antwort nach derselben Mindestdauer, ob es die Adresse gibt oder nicht.
      await d.konto.ruecksetzLinkAnfordern(String(email));
      res.json({ success: true, message: 'Falls die E-Mail existiert, wurde ein Link gesendet.' });
    },
  );

  router.post(
    '/reset-password',
    ipThrottle(d.konto, 'reset-password', 10, 60 * 60 * 1000),
    async (
      req: OffeneAnfrage<'POST /api/v1/auth/reset-password'>,
      res: Antwort<'POST /api/v1/auth/reset-password'>,
    ) => {
      const { token, password } = req.eingabe;
      if (!token || !password) return sendeFehler(req, res, 400, 'token_passwort_erforderlich');
      const mangel = passwortMangel(password);
      if (mangel) return sendeFehler(req, res, 400, mangel);
      const user = await d.konto.kontoZumRuecksetzLink(token);
      if (!user) return sendeFehler(req, res, 400, 'token_ungueltig');
      // Den Namen kennt erst das Konto hinter dem Token; die Regel gilt wie auf allen anderen Wegen.
      const nameMangel = passwortMangel(password, user.username);
      if (nameMangel) return sendeFehler(req, res, 400, nameMangel);
      // Nur die Anfrage, die den Link verbraucht, setzt ihr Passwort.
      const uid = await d.konto.setzePasswortZurueck(hashToken(token), password);
      if (!uid) return sendeFehler(req, res, 400, 'token_ungueltig');
      d.konto.hinweisNebenher(uid, 'passwort_zurueckgesetzt');
      res.json({ success: true, message: 'Passwort erfolgreich geändert.' });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
