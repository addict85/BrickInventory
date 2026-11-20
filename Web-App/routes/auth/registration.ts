/** Ohne Anmeldung: Registrierung, E-Mail-Bestätigung und Passwort vergessen.
 * Jede Antwort verrät gleich wenig darüber, ob es ein Konto gibt. */
import { ipThrottle } from '../../src/account/http/login';
import { passwordLack } from '../../src/infra/passwordRule';
import { errorText, responseLanguage, fachfehler } from '../../src/infra/errorTexts';
import { basisUrl, hintWithoutBaseUrl } from '../../src/infra/basisUrl';
import { vertragsRouter, type OpenRequest } from '../../src/http/contractRouter';
import { USERNAME_RE, emailValid, nameValid } from '../../src/account';
import { relyingParty } from '../../src/factors';
import type { Dienste } from '../../src/services';

/** Der Grund der ersten Absage, oder null, wenn die Eingabe genügt. */
function registrierungsMangel(e: OpenRequest<'POST /api/v1/auth/register'>['eingabe']) {
  if (!e.username || !e.email || !e.password) return 'registrierung_felder' as const;
  const mangel = passwordLack(e.password, e.username);
  if (mangel) return mangel;
  if (!emailValid(e.email)) return 'email_ungueltig' as const;
  if (!USERNAME_RE.test(e.username)) return 'benutzername_ungueltig' as const;
  if (!nameValid(e.first_name) || !nameValid(e.last_name)) return 'name_ungueltig' as const;
  return null;
}

export function buildRegistrationRouter(d: Pick<Dienste, 'settings' | 'mail' | 'account'>) {
  const router = vertragsRouter('/api/v1/auth');

  // Die Anmeldemaske zeigt nur Wege, die dieser Server auch kann; ohne Mail endete die Registrierung in einem Konto, das niemand bestätigen kann.
  router.endpunkt('GET /api/v1/auth/registration-status', async (_req, res) => {
    const mail = await d.mail.mailReady();
    res.json({
      enabled: mail && (await d.settings.registrationOpen()),
      passkey: !!relyingParty(),
      passwort_vergessen: mail,
      mail_versand: mail,
    });
  });

  router.endpunkt('POST /api/v1/auth/register', ipThrottle(d.account, 'register', 5, 60 * 60 * 1000), async req => {
    const { username, email, first_name, last_name, password, language } = req.eingabe;
    if (!(await d.settings.registrationOpen()) || !(await d.mail.mailReady()))
      fachfehler('verboten', 'registrierung_deaktiviert');
    const mangel = registrierungsMangel(req.eingabe);
    if (mangel || !username || !email || !password) fachfehler('ungueltig', mangel ?? 'registrierung_felder');
    // Zählt jeden Versuch, ob es die Adresse gibt oder nicht: Die Absage verrät nichts.
    const ziel = await d.account.targetThrottled('register-ziel', email, 3, 60 * 60 * 1000);
    if (ziel) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: ziel.waitMin });
    const gesendet = await d.account.tryRegistration({
      username,
      email,
      first_name,
      last_name,
      passwort: password,
      lang: language === 'en' ? 'en' : 'de',
    });
    return {
      message: gesendet
        ? 'Konto erstellt. Bitte bestätige deine E-Mail-Adresse.'
        : 'Konto erstellt, aber die Bestätigungsmail ging nicht hinaus. Der Verwalter kann das Konto freischalten.',
      email_sent: gesendet,
      // Die Registrierung verlangt einen Mailserver (oben): Den Link gibt nie die Konsole aus.
      console_mode: false,
    };
  });

  // Wie /forgot-password: gleiche Antwort und Dauer, ob es ein unbestätigtes Konto gibt oder nicht.
  router.endpunkt(
    'POST /api/v1/auth/bestaetigung-erneut',
    ipThrottle(d.account, 'bestaetigung-erneut', 5, 60 * 60 * 1000),
    async req => {
      const { email } = req.eingabe;
      if (!emailValid(email)) fachfehler('ungueltig', email ? 'email_ungueltig' : 'email_erforderlich');
      if (!basisUrl()) {
        hintWithoutBaseUrl('bestaetigung-erneut', 'Bestätigungs-Mails werden nicht versendet.');
        fachfehler('nicht_verfuegbar', 'bestaetigung_nicht_eingerichtet');
      }
      await d.account.confirmationAgainRequest(String(email));
      return { message: errorText('bestaetigung_gesendet', responseLanguage(req)) };
    },
  );

  router.endpunkt(
    'POST /api/v1/auth/email-bestaetigen/vorschau',
    ipThrottle(d.account, 'email-vorschau', 30, 60 * 60 * 1000),
    async req => {
      const token = req.eingabe.token;
      const username = token ? await d.account.nameToConfirmation(String(token)) : null;
      if (!username) fachfehler('ungueltig', 'bestaetigungslink_ungueltig');
      return { username };
    },
  );

  router.endpunkt(
    'POST /api/v1/auth/email-bestaetigen',
    ipThrottle(d.account, 'email-bestaetigen', 30, 60 * 60 * 1000),
    async req => {
      await d.account.verifyEmailToken(req.eingabe.token);
      return {};
    },
  );

  router.endpunkt(
    'POST /api/v1/auth/forgot-password',
    ipThrottle(d.account, 'forgot-password', 5, 60 * 60 * 1000),
    async req => {
      const { email } = req.eingabe;
      if (!emailValid(email)) fachfehler('ungueltig', email ? 'email_ungueltig' : 'email_erforderlich');
      // Vor der Nutzersuche, damit die Absage nichts über die Adresse verrät.
      if (!basisUrl()) {
        hintWithoutBaseUrl('passwort-reset', 'Passwort-vergessen-Mails werden nicht versendet.');
        fachfehler('nicht_verfuegbar', 'passwort_reset_nicht_eingerichtet');
      }
      // Immer dieselbe Antwort nach derselben Mindestdauer, ob es die Adresse gibt oder nicht.
      await d.account.ruecksetzLinkRequest(String(email));
      return { message: 'Falls die E-Mail existiert, wurde ein Link gesendet.' };
    },
  );

  router.endpunkt(
    'POST /api/v1/auth/reset-password',
    ipThrottle(d.account, 'reset-password', 10, 60 * 60 * 1000),
    async req => {
      const { token, password } = req.eingabe;
      if (!token || !password) fachfehler('ungueltig', 'token_passwort_erforderlich');
      const mangel = passwordLack(password);
      if (mangel) fachfehler('ungueltig', mangel);
      const user = await d.account.accountToRuecksetzLink(token);
      if (!user) fachfehler('ungueltig', 'token_ungueltig');
      // Den Namen kennt erst das Konto hinter dem Token; die Regel gilt wie auf allen anderen Wegen.
      const nameMangel = passwordLack(password, user.username);
      if (nameMangel) fachfehler('ungueltig', nameMangel);
      // Nur die Anfrage, die den Link verbraucht, setzt ihr Passwort.
      const uid = await d.account.setPasswordPerLink(token, password);
      if (!uid) fachfehler('ungueltig', 'token_ungueltig');
      return { message: 'Passwort erfolgreich geändert.' };
    },
  );
  // Links aus Mails, ohne Anmeldung: Der Token ist das Recht, die Drossel hält Raten auf.
  router.endpunkt(
    'POST /api/v1/auth/uebernahme-abbrechen',
    ipThrottle(d.account, 'uebernahme-abbrechen', 20, 60 * 60 * 1000),
    async req => {
      await d.account.redeemMailLink('abbrechen', req.eingabe.token ?? '');
      return {};
    },
  );
  router.endpunkt(
    'POST /api/v1/auth/anmeldung-freigeben',
    ipThrottle(d.account, 'anmeldung-freigeben', 20, 60 * 60 * 1000),
    async req => {
      await d.account.redeemMailLink('freigeben', req.eingabe.token ?? '');
      return {};
    },
  );
  return router;
}
