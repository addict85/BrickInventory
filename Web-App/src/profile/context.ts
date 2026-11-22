/** What the services get; separate from area.ts so no import cycle forms. */
import type { AppConfig } from '../infra/config';
import type { Db } from '../../db/database';
import type { Context } from '../infra/area';
import type { Compartments } from '../infra/cache';
import type { SettingsServices } from '../settings';
import type { AccountServices } from '../account';
import type { MailServices } from '../mail';
import type { Clock } from '../infra/clock';

export interface ProfileDependencies {
  config: Readonly<AppConfig>;
  db: Db;
  clock: Clock;
  faecher: Compartments;
  settings: SettingsServices;
  account: AccountServices;
  mail: MailServices;
}

/** The profile has no tables of its own: it reads and writes through account and settings. */
export const access = (_db: Db) => ({});
export type ProfileContext = Context<ProfileDependencies, ReturnType<typeof access>>;
