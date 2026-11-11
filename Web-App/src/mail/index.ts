/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
export {
  baueAlarmMail,
  mailEingerichtet,
  sendEmailGeaendertMail,
  sendKontoHinweisMail,
  sendMail,
  sendRegistrierungsVersuchMail,
  sendVerificationMail,
} from './mailer';
export type { KontoHinweis } from './mailer';
export {
  mailBereit,
  sendBenutzernameVergebenMail,
  sendHaushaltVerknuepftMail,
  sendPasswordResetMail,
  testSmtp,
} from './mailer';
export { meldeSmtpAltlast } from './mailer';
