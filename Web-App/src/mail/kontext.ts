/** Was der Versand bekommt: nur die Einstellungen (SMTP, Absender, Design).
 * Getrennt von bereich.ts, damit ein Modul seinen Typ ohne Importzyklus kennt. */
import type { Konfig } from '../infra/konfig';
import type { EinstellungenDienste } from '../einstellungen';

export interface MailAbhaengigkeiten {
  konfig: Readonly<Konfig>;
  einstellungen: EinstellungenDienste;
}

export type MailKontext = MailAbhaengigkeiten;
