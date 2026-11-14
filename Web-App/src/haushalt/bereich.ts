/** Die Fabrik des Bereichs. Die Blickfeld-Helfer nehmen nur den Zugang, weil andere
 * Bereiche sie auch mit dem Griff ihrer Transaktion rufen; wer Einstellungen braucht,
 * nimmt den Kontext. */
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
import * as haushalt from './haushalt';
import { zugang, type HaushaltAbhaengigkeiten, type HaushaltKontext } from './kontext';

export type { HaushaltAbhaengigkeiten, HaushaltKontext } from './kontext';

export function erzeugeHaushalt(a: HaushaltAbhaengigkeiten, einblick?: Einblick<HaushaltKontext>) {
  const k: HaushaltKontext = baueKontext(a, zugang);
  einblick?.(k);
  return {
    ...bindeZugang(k.db, haushalt, [
      'umzugsQuelle',
      'blickfeldAus',
      'darfSchreibenFuer',
      'einladungAnlegen',
      'haushaltsMitglieder',
      'pruefeEinladung',
      'haushaltVon',
      'schreibzielOderNull',
      'schreibbereichAus',
      'schreibziel',
      'blickfeldIds',
      'siehtKonto',
      'kontenTrennen',
      'verwerfeGetrennt',
      'besitzerAnhaengen',
      'schreibbereich',
    ]),
    ...bindeZugang(k, haushalt, ['einladungEinloesen', 'haushaltsStand']),
    /** Nur ein getrennter Job-Prozess: Er hält eigene Caches, die der Web-Prozess ändert. */
    horcheAufAenderungen: () => k.db.benachrichtigung.listen(haushalt.HAUSHALT_KANAL, haushalt.leereHaushaltCache),
  };
}

export type HaushaltDienste = ReturnType<typeof erzeugeHaushalt>;
