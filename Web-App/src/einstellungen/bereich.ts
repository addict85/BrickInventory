/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as settings from './settings';
import { zugang, type EinstellungenAbhaengigkeiten, type EinstellungenKontext } from './kontext';

export type { EinstellungenAbhaengigkeiten, EinstellungenKontext } from './kontext';

export function erzeugeEinstellungen(
  a: Omit<EinstellungenAbhaengigkeiten, 'faecher'>,
  einblick?: Einblick<EinstellungenKontext>,
) {
  return baueBereich(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: EinstellungenKontext) => ({
      schreibeNutzerEinstellung: mit(k)(settings.schreibeNutzerEinstellung),
      nutzerStandardZustand: mit(k)(settings.nutzerStandardZustand),
      globalDefaultCondition: mit(k)(settings.globalDefaultCondition),
      setGlobalSetting: mit(k)(settings.setGlobalSetting),
      verschluesseleGlobaleAltwerte: mit(k)(settings.verschluesseleGlobaleAltwerte),
      deleteGlobalSetting: mit(k)(settings.deleteGlobalSetting),
      deleteUserSetting: mit(k)(settings.deleteUserSetting),
      nutzerEinstellungen: mit(k)(settings.nutzerEinstellungen),
      readSettings: mit(k)(settings.readSettings),
      globaleWerteOhneGeheimnisse: mit(k)(settings.globaleWerteOhneGeheimnisse),
      designFuer: mit(k)(settings.designFuer),
      registrierungOffen: mit(k)(settings.registrierungOffen),
      zustandFuerPreis: mit(k)(settings.zustandFuerPreis),
      beiGlobalerAenderung: mit(k)(settings.beiGlobalerAenderung),
      meldeGlobaleAenderung: mit(k)(settings.meldeGlobaleAenderung),
      // Überladen: mit() sähe nur die letzte Signatur.
      getSetting: (<T>(uid: number, key: string, fallback?: T) => settings.getSetting(k, uid, key, fallback)) as {
        (uid: number, key: string): Promise<string | null | undefined>;
        <T>(uid: number, key: string, fallback: T): Promise<string | T>;
      },
      getGlobalSetting: (<T>(key: string, fallback?: T) => settings.getGlobalSetting(k, key, fallback)) as {
        (key: string): Promise<string | null>;
        <T>(key: string, fallback: T): Promise<string | T>;
      },
    }),
    einblick,
  );
}

export type EinstellungenDienste = ReturnType<typeof erzeugeEinstellungen>;
