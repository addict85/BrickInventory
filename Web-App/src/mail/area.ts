/** The mail factory: every mail reads SMTP and theme from the settings carried by the
 * context at send time, so no module needs the process. */
import { withValue, type Inspect } from '../infra/area';
import type { Db } from '../../db/database';
import * as mailer from './mailer';
import type { MailDependencies, MailContext } from './context';

export type { MailDependencies, MailContext } from './context';

export function createMail(a: MailDependencies, inspect?: Inspect<MailContext>) {
  const k: MailContext = { einstellungen: a.einstellungen, konfig: a.konfig, uhr: a.uhr };
  inspect?.(k);
  const services = {
    buildAlertMail: withValue(k)(mailer.buildAlertMail),
    mailReady: withValue(k)(mailer.mailReady),
    mailConfigured: withValue(k)(mailer.mailConfigured),
    reportSmtpLegacySetting: withValue(k)(mailer.reportSmtpLegacySetting),
    mailUsernameTaken: withValue(k)(mailer.sendUsernameTakenMail),
    mailEmailChanged: withValue(k)(mailer.sendEmailChangedMail),
    mailHouseholdLinked: withValue(k)(mailer.sendHouseholdLinkedMail),
    mailAccountNotice: withValue(k)(mailer.sendAccountNoticeMail),
    sendMail: withValue(k)(mailer.sendMail),
    mailPasswordReset: withValue(k)(mailer.sendPasswordResetMail),
    mailRegistrationAttempt: withValue(k)(mailer.sendRegistrationAttemptMail),
    mailVerification: withValue(k)(mailer.sendVerificationMail),
    sendSmtpTest: withValue(k)(mailer.sendSmtpTest),
  };
  // No access of its own: inside a transaction the sender reads the settings through it.
  return Object.assign(services, {
    ueber: (db: Db): typeof services => createMail({ ...a, einstellungen: a.einstellungen.ueber(db) }),
  });
}

export type MailServices = ReturnType<typeof createMail>;
