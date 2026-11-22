/** Without login: registration, email confirmation and forgotten password.
 * Every response reveals equally little about whether an account exists. */
import { ipThrottle } from '../../src/account/http/login';
import { passwordLack } from '../../src/infra/passwordRule';
import { errorText, responseLanguage, failDomain } from '../../src/infra/errorTexts';
import { basisUrl, hintWithoutBaseUrl } from '../../src/infra/baseUrl';
import { contractRouter, type OpenRequest } from '../../src/http/contractRouter';
import { USERNAME_RE, emailValid, nameValid } from '../../src/account';
import { relyingParty } from '../../src/factors';
import type { Services } from '../../src/services';

/** The reason of the first rejection, or null if the input is sufficient. */
function registrationShortfall(e: OpenRequest<'POST /api/v1/auth/register'>['eingabe']) {
  if (!e.username || !e.email || !e.password) return 'registrierung_felder' as const;
  const mangel = passwordLack(e.password, e.username);
  if (mangel) return mangel;
  if (!emailValid(e.email)) return 'email_ungueltig' as const;
  if (!USERNAME_RE.test(e.username)) return 'benutzername_ungueltig' as const;
  if (!nameValid(e.first_name) || !nameValid(e.last_name)) return 'name_ungueltig' as const;
  return null;
}

export function buildRegistrationRouter(d: Pick<Services, 'settings' | 'mail' | 'account'>) {
  const router = contractRouter('/api/v1/auth');

  // The login form only shows paths this server supports; without mail, registration would end in an account nobody can confirm.
  router.endpoint('GET /api/v1/auth/registration-status', async (_req, res) => {
    const mail = await d.mail.mailReady();
    res.json({
      enabled: mail && (await d.settings.registrationOpen()),
      passkey: !!relyingParty(),
      passwort_vergessen: mail,
      mail_versand: mail,
    });
  });

  router.endpoint('POST /api/v1/auth/register', ipThrottle(d.account, 'register', 5, 60 * 60 * 1000), async req => {
    const { username, email, first_name, last_name, password, language } = req.eingabe;
    if (!(await d.settings.registrationOpen()) || !(await d.mail.mailReady()))
      failDomain('verboten', 'registrierung_deaktiviert');
    const mangel = registrationShortfall(req.eingabe);
    if (mangel || !username || !email || !password) failDomain('ungueltig', mangel ?? 'registrierung_felder');
    // Counts every attempt, whether the address exists or not: the rejection reveals nothing.
    const target = await d.account.targetThrottled('register-ziel', email, 3, 60 * 60 * 1000);
    if (target) failDomain('zu_viele', 'zu_viele_anfragen', { minuten: target.waitMin });
    const sent = await d.account.tryRegistration({
      username,
      email,
      first_name,
      last_name,
      passwort: password,
      lang: language === 'en' ? 'en' : 'de',
    });
    return {
      message: sent
        ? 'Konto erstellt. Bitte bestätige deine E-Mail-Adresse.'
        : 'Konto erstellt, aber die Bestätigungsmail ging nicht hinaus. Der Verwalter kann das Konto freischalten.',
      email_sent: sent,
      // Registration requires a mail server (above): the console never prints the link.
      console_mode: false,
    };
  });

  // Like /forgot-password: same answer and duration whether an unconfirmed account exists or not.
  router.endpoint(
    'POST /api/v1/auth/bestaetigung-erneut',
    ipThrottle(d.account, 'bestaetigung-erneut', 5, 60 * 60 * 1000),
    async req => {
      const { email } = req.eingabe;
      if (!emailValid(email)) failDomain('ungueltig', email ? 'email_ungueltig' : 'email_erforderlich');
      if (!basisUrl()) {
        hintWithoutBaseUrl('bestaetigung-erneut', 'Bestätigungs-Mails werden nicht versendet.');
        failDomain('nicht_verfuegbar', 'bestaetigung_nicht_eingerichtet');
      }
      await d.account.confirmationAgainRequest(String(email));
      return { message: errorText('bestaetigung_gesendet', responseLanguage(req)) };
    },
  );

  router.endpoint(
    'POST /api/v1/auth/email-bestaetigen/vorschau',
    ipThrottle(d.account, 'email-vorschau', 30, 60 * 60 * 1000),
    async req => {
      const token = req.eingabe.token;
      const username = token ? await d.account.nameToConfirmation(String(token)) : null;
      if (!username) failDomain('ungueltig', 'bestaetigungslink_ungueltig');
      return { username };
    },
  );

  router.endpoint(
    'POST /api/v1/auth/email-bestaetigen',
    ipThrottle(d.account, 'email-bestaetigen', 30, 60 * 60 * 1000),
    async req => {
      await d.account.verifyEmailToken(req.eingabe.token);
      return {};
    },
  );

  router.endpoint(
    'POST /api/v1/auth/forgot-password',
    ipThrottle(d.account, 'forgot-password', 5, 60 * 60 * 1000),
    async req => {
      const { email } = req.eingabe;
      if (!emailValid(email)) failDomain('ungueltig', email ? 'email_ungueltig' : 'email_erforderlich');
      // Before the user lookup, so the rejection reveals nothing about the address.
      if (!basisUrl()) {
        hintWithoutBaseUrl('passwort-reset', 'Passwort-vergessen-Mails werden nicht versendet.');
        failDomain('nicht_verfuegbar', 'passwort_reset_nicht_eingerichtet');
      }
      // Always the same answer after the same minimum duration, whether the address exists or not.
      await d.account.resetLinkRequest(String(email));
      return { message: 'Falls die E-Mail existiert, wurde ein Link gesendet.' };
    },
  );

  router.endpoint(
    'POST /api/v1/auth/reset-password',
    ipThrottle(d.account, 'reset-password', 10, 60 * 60 * 1000),
    async req => {
      const { token, password } = req.eingabe;
      if (!token || !password) failDomain('ungueltig', 'token_passwort_erforderlich');
      const mangel = passwordLack(password);
      if (mangel) failDomain('ungueltig', mangel);
      const user = await d.account.accountToResetLink(token);
      if (!user) failDomain('ungueltig', 'token_ungueltig');
      // Only the account behind the token knows the name; the rule applies as on all other paths.
      const nameMangel = passwordLack(password, user.username);
      if (nameMangel) failDomain('ungueltig', nameMangel);
      // Only the request that consumes the link sets its password.
      const uid = await d.account.setPasswordPerLink(token, password);
      if (!uid) failDomain('ungueltig', 'token_ungueltig');
      return { message: 'Passwort erfolgreich geändert.' };
    },
  );
  // Links from mails, without login: the token is the right, the throttle stops guessing.
  router.endpoint(
    'POST /api/v1/auth/uebernahme-abbrechen',
    ipThrottle(d.account, 'uebernahme-abbrechen', 20, 60 * 60 * 1000),
    async req => {
      await d.account.redeemMailLink('abbrechen', req.eingabe.token ?? '');
      return {};
    },
  );
  router.endpoint(
    'POST /api/v1/auth/anmeldung-freigeben',
    ipThrottle(d.account, 'anmeldung-freigeben', 20, 60 * 60 * 1000),
    async req => {
      await d.account.redeemMailLink('freigeben', req.eingabe.token ?? '');
      return {};
    },
  );
  return router;
}
