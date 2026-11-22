/** The mail factory: every mail reads SMTP and theme from the settings carried by the
 * context at send time, so no module needs the process. */
import { bound, type Inspect } from '../infra/area';
import type { Db } from '../../db/database';
import * as mailer from './mailer';
import type { MailDependencies, MailContext } from './context';

export type { MailDependencies, MailContext } from './context';

export function createMail(a: MailDependencies, inspect?: Inspect<MailContext>) {
  const k: MailContext = { einstellungen: a.einstellungen, konfig: a.konfig, uhr: a.uhr };
  inspect?.(k);
  const services = {
    buildAlertMail: bound(k)(mailer.buildAlertMail),
    mailReady: bound(k)(mailer.mailReady),
    mailConfigured: bound(k)(mailer.mailConfigured),
    reportSmtpLegacySetting: bound(k)(mailer.reportSmtpLegacySetting),
    mailUsernameTaken: bound(k)(mailer.sendUsernameTakenMail),
    mailEmailChanged: bound(k)(mailer.sendEmailChangedMail),
    mailHouseholdLinked: bound(k)(mailer.sendHouseholdLinkedMail),
    mailAccountNotice: bound(k)(mailer.sendAccountNoticeMail),
    sendMail: bound(k)(mailer.sendMail),
    mailPasswordReset: bound(k)(mailer.sendPasswordResetMail),
    mailRegistrationAttempt: bound(k)(mailer.sendRegistrationAttemptMail),
    mailVerification: bound(k)(mailer.sendVerificationMail),
    sendSmtpTest: bound(k)(mailer.sendSmtpTest),
  };
  // No access of its own: inside a transaction the sender reads the settings through it.
  return Object.assign(services, {
    over: (db: Db): typeof services => createMail({ ...a, einstellungen: a.einstellungen.over(db) }),
  });
}

export type MailServices = ReturnType<typeof createMail>;
