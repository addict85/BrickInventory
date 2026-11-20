/** The mail factory: every mail reads SMTP and theme from the settings carried by the
 * context at send time, so no module needs the process. */
import { mit, type Einblick } from '../infra/bereich';
import type { Db } from '../../db/database';
import * as mailer from './mailer';
import type { MailDependencies, MailContext } from './context';

export type { MailDependencies, MailContext } from './context';

export function createMail(a: MailDependencies, inspect?: Einblick<MailContext>) {
  const k: MailContext = { einstellungen: a.einstellungen, konfig: a.konfig, uhr: a.uhr };
  inspect?.(k);
  const services = {
    buildAlertMail: mit(k)(mailer.buildAlertMail),
    mailReady: mit(k)(mailer.mailReady),
    mailConfigured: mit(k)(mailer.mailConfigured),
    reportSmtpLegacySetting: mit(k)(mailer.reportSmtpLegacySetting),
    mailUsernameTaken: mit(k)(mailer.sendUsernameTakenMail),
    mailEmailChanged: mit(k)(mailer.sendEmailChangedMail),
    mailHouseholdLinked: mit(k)(mailer.sendHouseholdLinkedMail),
    mailAccountNotice: mit(k)(mailer.sendAccountNoticeMail),
    sendMail: mit(k)(mailer.sendMail),
    mailPasswordReset: mit(k)(mailer.sendPasswordResetMail),
    mailRegistrationAttempt: mit(k)(mailer.sendRegistrationAttemptMail),
    mailVerification: mit(k)(mailer.sendVerificationMail),
    sendSmtpTest: mit(k)(mailer.sendSmtpTest),
  };
  // No access of its own: inside a transaction the sender reads the settings through it.
  return Object.assign(services, {
    ueber: (db: Db): typeof services => createMail({ ...a, einstellungen: a.einstellungen.ueber(db) }),
  });
}

export type MailServices = ReturnType<typeof createMail>;
