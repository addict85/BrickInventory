/** What the services get; kept apart from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { imSystem, mit, type Kontext } from '../infra/bereich';
import type { Faecher } from '../infra/zwischenspeicher';
import * as repository from './repository/values';
import type { ThrottleServices } from '../throttle';
import type { Uhr } from '../infra/uhr';
import type { SettingsReadContract } from './readContract';

export interface SettingsDependencies {
  uhr: Uhr;
  db: Db;
  /** Who listens for changes to global values; createSettings sets it up. */
  faecher: Faecher;
  throttle: ThrottleServices;
  lesevertrag: SettingsReadContract;
}

/** Mail server, registration, keys: none of these redirect an injected query (0117). */
const GLOBAL = 'global settings: only the system role writes them';

export const access = (db: Db) => ({
  repository: {
    userValue: mit(db)(repository.userValue),
    globalValue: mit(db)(repository.globalValue),
    writeUserValue: mit(db)(repository.writeUserValue),
    deleteUserValue: mit(db)(repository.deleteUserValue),
    userValues: mit(db)(repository.userValues),
    firstValueIn: mit(db)(repository.firstValueIn),
    foreignUserValue: imSystem(db, 'Verwaltung: reads another account’s value', repository.userValue),
    writeGlobalValue: imSystem(db, GLOBAL, repository.writeGlobalValue),
    deleteGlobalValues: imSystem(db, GLOBAL, repository.deleteGlobalValueRows),
    globalValues: mit(db)(repository.globalValues),
    replaceGlobalValue: imSystem(db, GLOBAL, repository.replaceGlobalValue),
  },
});
export type SettingsContext = Kontext<SettingsDependencies, ReturnType<typeof access>>;
