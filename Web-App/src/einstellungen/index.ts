/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
import { einstellungenBereich } from './prozess';
import { dienstePerAufruf } from '../infra/bereich';
export {
  DESIGNS,
  SECRET_KEYS,
  beiGlobalerAenderung,
  globalerWertGueltig,
  isMaskedValue,
  nutzerWertGueltig,
} from './settings';
export { meldeGlobaleAenderung, einstellungMitZugang } from './settings';
export { erzeugeEinstellungen } from './bereich';
export type { EinstellungenDienste, EinstellungenKontext } from './bereich';
export { einstellungenBereich } from './prozess';

/** Für Wege ohne eigenen Kontext (HTTP-Seiten, Tests): die Dienste des Prozesses. */
export const {
  deleteGlobalSetting,
  deleteUserSetting,
  designFuer,
  getGlobalSetting,
  getSetting,
  globalDefaultCondition,
  globaleWerteOhneGeheimnisse,
  nutzerEinstellungen,
  nutzerStandardZustand,
  readSettings,
  registrierungOffen,
  schreibeNutzerEinstellung,
  setGlobalSetting,
  verschluesseleGlobaleAltwerte,
  zustandFuerPreis,
} = dienstePerAufruf(einstellungenBereich, [
  'deleteGlobalSetting',
  'deleteUserSetting',
  'designFuer',
  'getGlobalSetting',
  'getSetting',
  'globalDefaultCondition',
  'globaleWerteOhneGeheimnisse',
  'nutzerEinstellungen',
  'nutzerStandardZustand',
  'readSettings',
  'registrierungOffen',
  'schreibeNutzerEinstellung',
  'setGlobalSetting',
  'verschluesseleGlobaleAltwerte',
  'zustandFuerPreis',
]);
