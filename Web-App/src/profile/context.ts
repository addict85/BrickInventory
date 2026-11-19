/** What the services get; separate from area.ts so no import cycle forms. */
import type { Konfig } from '../infra/konfig';
import type { Db } from '../../db/database';
import type { Kontext } from '../infra/bereich';
import type { Faecher } from '../infra/zwischenspeicher';
import type { SettingsServices } from '../settings';
import type { KontoDienste } from '../konto';
import type { MailDienste } from '../mail';
import type { Uhr } from '../infra/uhr';

export interface ProfileDependencies {
  konfig: Readonly<Konfig>;
  db: Db;
  uhr: Uhr;
  faecher: Faecher;
  einstellungen: SettingsServices;
  konto: KontoDienste;
  mail: MailDienste;
}

/** The profile has no tables of its own: it reads and writes through account and settings. */
export const access = (_db: Db) => ({});
export type ProfileContext = Kontext<ProfileDependencies, ReturnType<typeof access>>;
