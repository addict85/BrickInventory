/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { withValue, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
import * as settings from './settings';
import * as userSetting from './userSetting';
import { access, type SettingsDependencies, type SettingsContext } from './context';

export type { SettingsDependencies, SettingsContext } from './context';

export function createSettings(a: Omit<SettingsDependencies, 'faecher'>, inspect?: Inspect<SettingsContext>) {
  return buildArea(
    { ...a, faecher: new Faecher() },
    access,
    (k: SettingsContext) => ({
      userDefaultCondition: withValue(k)(settings.userDefaultCondition),
      globalDefaultCondition: withValue(k)(settings.globalDefaultCondition),
      setGlobalValue: withValue(k)(settings.setGlobalSetting),
      reencryptLegacyGlobalValues: withValue(k)(settings.reencryptLegacyGlobalValues),
      deleteGlobalValues: withValue(k)(settings.deleteGlobalValues),
      setUserSetting: withValue(k)(userSetting.setUserSetting),
      deleteUserSetting: withValue(k)(userSetting.deleteUserSetting),
      setOwnTheme: withValue(k)(userSetting.setOwnTheme),
      onCurrencyChange: withValue(k)(userSetting.onCurrencyChange),
      userSettings: withValue(k)(settings.userSettings),
      valueInView: (uids: number[], key: string) => k.repository.firstValueIn(uids, key),
      foreignUserValue: (uid: number, key: string) => k.repository.foreignUserValue(uid, key),
      readSettings: withValue(k)(settings.readSettings),
      globalValuesWithoutSecrets: withValue(k)(settings.globalValuesWithoutSecrets),
      themeFor: withValue(k)(settings.themeFor),
      registrationOpen: withValue(k)(settings.registrationOpen),
      conditionForPrice: withValue(k)(settings.conditionForPrice),
      onGlobalChange: withValue(k)(settings.onGlobalChange),
      notifyGlobalChange: withValue(k)(settings.notifyGlobalChange),
      listenForGlobalChanges: withValue(k)(settings.listenForGlobalChanges),
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
