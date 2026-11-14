/** Was der Versand bekommt: nur die Einstellungen (SMTP, Absender, Design).
 * Getrennt von bereich.ts, damit ein Modul seinen Typ ohne Importzyklus kennt. */
import type { Konfig } from '../infra/konfig';
import type { EinstellungenDienste } from '../einstellungen';
import type { Uhr } from '../infra/uhr';

export interface MailAbhaengigkeiten {
  uhr: Uhr;
  konfig: Readonly<Konfig>;
  einstellungen: EinstellungenDienste;
}

export type MailKontext = MailAbhaengigkeiten;
