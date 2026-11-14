/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
export type { KontoHinweis } from './mailer';
export { erzeugeMail } from './bereich';
export type { MailAbhaengigkeiten, MailDienste, MailKontext } from './bereich';
