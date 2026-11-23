/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { bound, buildArea, type Inspect } from '../infra/area';
import { Compartments } from '../infra/cache';
import * as settings from './settings';
import * as userSetting from './userSetting';
import { access, type SettingsDependencies, type SettingsContext } from './context';

export type { SettingsDependencies, SettingsContext } from './context';

export function createSettings(a: Omit<SettingsDependencies, 'compartments'>, inspect?: Inspect<SettingsContext>) {
  return buildArea(
    { ...a, compartments: new Compartments() },
    access,
    (k: SettingsContext) => ({
      userDefaultCondition: bound(k)(settings.userDefaultCondition),
      globalDefaultCondition: bound(k)(settings.globalDefaultCondition),
      setGlobalValue: bound(k)(settings.setGlobalSetting),
      reencryptLegacyGlobalValues: bound(k)(settings.reencryptLegacyGlobalValues),
      deleteGlobalValues: bound(k)(settings.deleteGlobalValues),
      setUserSetting: bound(k)(userSetting.setUserSetting),
      deleteUserSetting: bound(k)(userSetting.deleteUserSetting),
      setOwnTheme: bound(k)(userSetting.setOwnTheme),
      onCurrencyChange: bound(k)(userSetting.onCurrencyChange),
      userSettings: bound(k)(settings.userSettings),
      valueInView: (uids: number[], key: string) => k.repository.firstValueIn(uids, key),
      foreignUserValue: (uid: number, key: string) => k.repository.foreignUserValue(uid, key),
      readSettings: bound(k)(settings.readSettings),
      globalValuesWithoutSecrets: bound(k)(settings.globalValuesWithoutSecrets),
      themeFor: bound(k)(settings.themeFor),
      registrationOpen: bound(k)(settings.registrationOpen),
      conditionForPrice: bound(k)(settings.conditionForPrice),
      onGlobalChange: bound(k)(settings.onGlobalChange),
      notifyGlobalChange: bound(k)(settings.notifyGlobalChange),
      listenForGlobalChanges: bound(k)(settings.listenForGlobalChanges),
      // Overload: mit() would only see the last signature.
      userValue: (<T>(uid: number, key: string, fallback?: T) => settings.getSetting(k, uid, key, fallback)) as {
        (uid: number, key: string): Promise<string | null | undefined>;
        <T>(uid: number, key: string, fallback: T): Promise<string | T>;
      },
      globalValue: (<T>(key: string, fallback?: T) => settings.getGlobalSetting(k, key, fallback)) as {
        (key: string): Promise<string | null>;
        <T>(key: string, fallback: T): Promise<string | T>;
      },
    }),
    inspect,
  );
}

export type SettingsServices = ReturnType<typeof createSettings>;
