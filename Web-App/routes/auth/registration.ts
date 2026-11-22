/** Without login: registration, email confirmation and forgotten password.
 * Every response reveals equally little about whether an account exists. */
import { ipThrottle } from '../../src/account/http/login';
import { passwordLack } from '../../src/infra/passwordRule';
import { errorText, responseLanguage, failDomain } from '../../src/infra/errorTexts';
import { baseUrl, hintWithoutBaseUrl } from '../../src/infra/baseUrl';
import { contractRouter, type OpenRequest } from '../../src/http/contractRouter';
import { USERNAME_RE, emailValid, nameValid } from '../../src/account';
import { relyingParty } from '../../src/factors';
import type { Services } from '../../src/services';

/** The reason of the first rejection, or null if the input is sufficient. */
function registrationShortfall(e: OpenRequest<'POST /api/v2/auth/register'>['input']) {
  if (!e.username || !e.email || !e.password) return 'registration_fields' as const;
  const mangel = passwordLack(e.password, e.username);
  if (mangel) return mangel;
  if (!emailValid(e.email)) return 'email_invalid' as const;
  if (!USERNAME_RE.test(e.username)) return 'username_invalid' as const;
  if (!nameValid(e.first_name) || !nameValid(e.last_name)) return 'name_invalid' as const;
  return null;
}

export function buildRegistrationRouter(d: Pick<Services, 'settings' | 'mail' | 'account'>) {
  const router = contractRouter('/api/v2/auth');

  // The login form only shows paths this server supports; without mail, registration would end in an account nobody can confirm.
  router.endpoint('GET /api/v2/auth/registration-status', async (_req, res) => {
    const mail = await d.mail.mailReady();
    res.json({
      enabled: mail && (await d.settings.registrationOpen()),
      passkey: !!relyingParty(),
      forgot_password: mail,
      mail_delivery: mail,
    });
  });

  router.endpoint('POST /api/v2/auth/register', ipThrottle(d.account, 'register', 5, 60 * 60 * 1000), async req => {
    const { username, email, first_name, last_name, password, language } = req.input;
    if (!(await d.settings.registrationOpen()) || !(await d.mail.mailReady()))
      failDomain('verboten', 'registration_disabled');
    const mangel = registrationShortfall(req.input);
    if (mangel || !username || !email || !password) failDomain('ungueltig', mangel ?? 'registration_fields');
    // Counts every attempt, whether the address exists or not: the rejection reveals nothing.
    const target = await d.account.targetThrottled('register-ziel', email, 3, 60 * 60 * 1000);
    if (target) failDomain('zu_viele', 'too_many_requests', { minutes: target.waitMin });
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
    'POST /api/v2/auth/resend-confirmation',
    ipThrottle(d.account, 'bestaetigung-erneut', 5, 60 * 60 * 1000),
    async req => {
      const { email } = req.input;
      if (!emailValid(email)) failDomain('ungueltig', email ? 'email_invalid' : 'email_required');
      if (!baseUrl()) {
        hintWithoutBaseUrl('bestaetigung-erneut', 'Bestätigungs-Mails werden nicht versendet.');
        failDomain('nicht_verfuegbar', 'confirmation_not_configured');
      }
      await d.account.confirmationAgainRequest(String(email));
      return { message: errorText('confirmation_sent', responseLanguage(req)) };
    },
  );

  router.endpoint(
    'POST /api/v2/auth/confirm-email/preview',
    ipThrottle(d.account, 'email-vorschau', 30, 60 * 60 * 1000),
    async req => {
      const token = req.input.token;
      const username = token ? await d.account.nameToConfirmation(String(token)) : null;
      if (!username) failDomain('ungueltig', 'confirmation_link_invalid');
      return { username };
    },
  );

  router.endpoint(
    'POST /api/v2/auth/confirm-email',
    ipThrottle(d.account, 'email-bestaetigen', 30, 60 * 60 * 1000),
    async req => {
      await d.account.verifyEmailToken(req.input.token);
      return {};
    },
  );

  router.endpoint(
    'POST /api/v2/auth/forgot-password',
    ipThrottle(d.account, 'forgot-password', 5, 60 * 60 * 1000),
    async req => {
      const { email } = req.input;
      if (!emailValid(email)) failDomain('ungueltig', email ? 'email_invalid' : 'email_required');
      // Before the user lookup, so the rejection reveals nothing about the address.
      if (!baseUrl()) {
        hintWithoutBaseUrl('passwort-reset', 'Passwort-vergessen-Mails werden nicht versendet.');
        failDomain('nicht_verfuegbar', 'password_reset_not_configured');
      }
      // Always the same answer after the same minimum duration, whether the address exists or not.
      await d.account.resetLinkRequest(String(email));
      return { message: 'Falls die E-Mail existiert, wurde ein Link gesendet.' };
    },
  );

  router.endpoint(
    'POST /api/v2/auth/reset-password',
    ipThrottle(d.account, 'reset-password', 10, 60 * 60 * 1000),
    async req => {
      const { token, password } = req.input;
      if (!token || !password) failDomain('ungueltig', 'token_password_required');
      const mangel = passwordLack(password);
      if (mangel) failDomain('ungueltig', mangel);
      const user = await d.account.accountToResetLink(token);
      if (!user) failDomain('ungueltig', 'token_invalid');
      // Only the account behind the token knows the name; the rule applies as on all other paths.
      const nameMangel = passwordLack(password, user.username);
      if (nameMangel) failDomain('ungueltig', nameMangel);
      // Only the request that consumes the link sets its password.
      const uid = await d.account.setPasswordPerLink(token, password);
      if (!uid) failDomain('ungueltig', 'token_invalid');
      return { message: 'Passwort erfolgreich geändert.' };
    },
  );
  // Links from mails, without login: the token is the right, the throttle stops guessing.
  router.endpoint(
    'POST /api/v2/auth/cancel-takeover',
    ipThrottle(d.account, 'uebernahme-abbrechen', 20, 60 * 60 * 1000),
    async req => {
      await d.account.redeemMailLink('abbrechen', req.input.token ?? '');
      return {};
    },
  );
  router.endpoint(
    'POST /api/v2/auth/approve-login',
    ipThrottle(d.account, 'anmeldung-freigeben', 20, 60 * 60 * 1000),
    async req => {
      await d.account.redeemMailLink('freigeben', req.input.token ?? '');
      return {};
    },
  );
  return router;
}
