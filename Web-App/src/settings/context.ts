/** What the services get; kept apart from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { imSystem, bound, type Context } from '../infra/area';
import type { Compartments } from '../infra/cache';
import * as repository from './repository/values';
import type { ThrottleServices } from '../throttle';
import type { Clock } from '../infra/clock';
import type { SettingsReadContract } from './readContract';

export interface SettingsDependencies {
  uhr: Clock;
  db: Db;
  /** Who listens for changes to global values; createSettings sets it up. */
  faecher: Compartments;
  throttle: ThrottleServices;
  lesevertrag: SettingsReadContract;
}

/** Mail server, registration, keys: none of these redirect an injected query (0117). */
const GLOBAL = 'global settings: only the system role writes them';

export const access = (db: Db) => ({
  repository: {
    userValue: bound(db)(repository.userValue),
    globalValue: bound(db)(repository.globalValue),
    writeUserValue: bound(db)(repository.writeUserValue),
    deleteUserValue: bound(db)(repository.deleteUserValue),
    userValues: bound(db)(repository.userValues),
    firstValueIn: bound(db)(repository.firstValueIn),
    foreignUserValue: imSystem(db, 'Verwaltung: reads another account’s value', repository.userValue),
    writeGlobalValue: imSystem(db, GLOBAL, repository.writeGlobalValue),
    deleteGlobalValues: imSystem(db, GLOBAL, repository.deleteGlobalValueRows),
    globalValues: bound(db)(repository.globalValues),
    replaceGlobalValue: imSystem(db, GLOBAL, repository.replaceGlobalValue),
  },
});
export type SettingsContext = Context<SettingsDependencies, ReturnType<typeof access>>;
