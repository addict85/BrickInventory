/** Die Fabrik des Versands: Jede Mail liest SMTP und Design beim Senden aus den
 * Einstellungen, die der Kontext trägt; so braucht kein Modul den Prozess. */
import { mit, type Einblick } from '../infra/bereich';
import type { Db } from '../../db/database';
import * as mailer from './mailer';
import type { MailAbhaengigkeiten, MailKontext } from './kontext';

export type { MailAbhaengigkeiten, MailKontext } from './kontext';

export function erzeugeMail(a: MailAbhaengigkeiten, einblick?: Einblick<MailKontext>) {
  const k: MailKontext = { einstellungen: a.einstellungen, konfig: a.konfig, uhr: a.uhr };
  einblick?.(k);
  const dienste = {
    baueAlarmMail: mit(k)(mailer.baueAlarmMail),
    mailBereit: mit(k)(mailer.mailBereit),
    mailEingerichtet: mit(k)(mailer.mailEingerichtet),
    meldeSmtpAltlast: mit(k)(mailer.meldeSmtpAltlast),
    mailBenutzernameVergeben: mit(k)(mailer.sendBenutzernameVergebenMail),
    mailEmailGeaendert: mit(k)(mailer.sendEmailGeaendertMail),
    mailHaushaltVerknuepft: mit(k)(mailer.sendHaushaltVerknuepftMail),
    mailKontoHinweis: mit(k)(mailer.sendKontoHinweisMail),
    sendeMail: mit(k)(mailer.sendMail),
    mailPasswortZuruecksetzen: mit(k)(mailer.sendPasswordResetMail),
    mailRegistrierungsVersuch: mit(k)(mailer.sendRegistrierungsVersuchMail),
    mailBestaetigung: mit(k)(mailer.sendVerificationMail),
    sendeSmtpTest: mit(k)(mailer.sendeSmtpTest),
    testSmtp: mit(k)(mailer.testSmtp),
  };
  // Ohne eigenen Zugang: In einer Transaktion liest der Versand die Einstellungen über sie.
  return Object.assign(dienste, {
    ueber: (db: Db): typeof dienste => erzeugeMail({ ...a, einstellungen: a.einstellungen.ueber(db) }),
  });
}

export type MailDienste = ReturnType<typeof erzeugeMail>;
