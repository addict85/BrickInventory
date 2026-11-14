/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext als ersten Parameter;
 * erzeugeEinstellungen bindet ihn einmal für alle. So greift kein Modul selbst auf
 * den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as settings from './settings';
import { zugang, type EinstellungenAbhaengigkeiten, type EinstellungenKontext } from './kontext';

export type { EinstellungenAbhaengigkeiten, EinstellungenKontext } from './kontext';

export function erzeugeEinstellungen(
  a: Omit<EinstellungenAbhaengigkeiten, 'faecher'>,
  einblick?: Einblick<EinstellungenKontext>,
) {
  const k: EinstellungenKontext = baueKontext({ ...a, faecher: new Faecher() }, zugang);
  einblick?.(k);
  return {
    ...bindeZugang(k, settings, [
      'schreibeNutzerEinstellung',
      'nutzerStandardZustand',
      'globalDefaultCondition',
      'setGlobalSetting',
      'verschluesseleGlobaleAltwerte',
      'deleteGlobalSetting',
      'deleteUserSetting',
      'nutzerEinstellungen',
      'readSettings',
      'globaleWerteOhneGeheimnisse',
      'designFuer',
      'registrierungOffen',
      'zustandFuerPreis',
      'beiGlobalerAenderung',
      'meldeGlobaleAenderung',
    ]),
    // Überladen oder generisch: Gebunden<> sähe nur die letzte Signatur.
    getSetting: (<T>(uid: number, key: string, fallback?: T) => settings.getSetting(k, uid, key, fallback)) as {
      (uid: number, key: string): Promise<string | null | undefined>;
      <T>(uid: number, key: string, fallback: T): Promise<string | T>;
    },
    getGlobalSetting: (<T>(key: string, fallback?: T) => settings.getGlobalSetting(k, key, fallback)) as {
      (key: string): Promise<string | null>;
      <T>(key: string, fallback: T): Promise<string | T>;
    },
  };
}

export type EinstellungenDienste = ReturnType<typeof erzeugeEinstellungen>;
