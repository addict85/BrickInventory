/** The area's factory: services as a closure over k (buildArea, src/infra/bereich.ts). */
import { mit, buildArea, type Inspect } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as settings from './settings';
import * as userSetting from './userSetting';
import { access, type SettingsDependencies, type SettingsContext } from './context';

export type { SettingsDependencies, SettingsContext } from './context';

export function createSettings(a: Omit<SettingsDependencies, 'faecher'>, inspect?: Inspect<SettingsContext>) {
  return buildArea(
    { ...a, faecher: new Faecher() },
    access,
    (k: SettingsContext) => ({
      userDefaultCondition: mit(k)(settings.userDefaultCondition),
      globalDefaultCondition: mit(k)(settings.globalDefaultCondition),
      setGlobalValue: mit(k)(settings.setGlobalSetting),
      reencryptLegacyGlobalValues: mit(k)(settings.reencryptLegacyGlobalValues),
      deleteGlobalValues: mit(k)(settings.deleteGlobalValues),
      setUserSetting: mit(k)(userSetting.setUserSetting),
      deleteUserSetting: mit(k)(userSetting.deleteUserSetting),
      setOwnTheme: mit(k)(userSetting.setOwnTheme),
      onCurrencyChange: mit(k)(userSetting.onCurrencyChange),
      userSettings: mit(k)(settings.userSettings),
      valueInView: (uids: number[], key: string) => k.repository.firstValueIn(uids, key),
      foreignUserValue: (uid: number, key: string) => k.repository.foreignUserValue(uid, key),
      readSettings: mit(k)(settings.readSettings),
      globalValuesWithoutSecrets: mit(k)(settings.globalValuesWithoutSecrets),
      themeFor: mit(k)(settings.themeFor),
      registrationOpen: mit(k)(settings.registrationOpen),
      conditionForPrice: mit(k)(settings.conditionForPrice),
      onGlobalChange: mit(k)(settings.onGlobalChange),
      notifyGlobalChange: mit(k)(settings.notifyGlobalChange),
      listenForGlobalChanges: mit(k)(settings.listenForGlobalChanges),
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
