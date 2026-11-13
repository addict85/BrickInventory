/** Die Fabrik des Versands: Jede Mail liest SMTP und Design beim Senden aus den
 * Einstellungen, die der Kontext trägt; so braucht kein Modul den Prozess. */
import { bindeZugang, type Einblick } from '../infra/bereich';
import * as mailer from './mailer';
import type { MailAbhaengigkeiten, MailKontext } from './kontext';

export type { MailAbhaengigkeiten, MailKontext } from './kontext';

export function erzeugeMail(a: MailAbhaengigkeiten, einblick?: Einblick<MailKontext>) {
  const k: MailKontext = { einstellungen: a.einstellungen };
  einblick?.(k);
  return bindeZugang(k, mailer, [
    'baueAlarmMail',
    'mailBereit',
    'mailEingerichtet',
    'meldeSmtpAltlast',
    'sendBenutzernameVergebenMail',
    'sendEmailGeaendertMail',
    'sendHaushaltVerknuepftMail',
    'sendKontoHinweisMail',
    'sendMail',
    'sendPasswordResetMail',
    'sendRegistrierungsVersuchMail',
    'sendVerificationMail',
    'testSmtp',
  ]);
}

export type MailDienste = ReturnType<typeof erzeugeMail>;
