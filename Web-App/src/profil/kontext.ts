/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Konfig } from '../infra/konfig';
import type { Db } from '../../db/database';
import type { Kontext } from '../infra/bereich';
import type { Faecher } from '../infra/zwischenspeicher';
import type { EinstellungenDienste } from '../einstellungen';
import type { KontoDienste } from '../konto';
import type { MailDienste } from '../mail';

export interface ProfilAbhaengigkeiten {
  konfig: Readonly<Konfig>;
  db: Db;
  faecher: Faecher;
  einstellungen: EinstellungenDienste;
  konto: KontoDienste;
  mail: MailDienste;
}

/** Eigene Tabellen hat das Profil nicht: Es liest und schreibt über Konto und Einstellungen. */
export const zugang = (_db: Db) => ({});
export type ProfilKontext = Kontext<ProfilAbhaengigkeiten, ReturnType<typeof zugang>>;
