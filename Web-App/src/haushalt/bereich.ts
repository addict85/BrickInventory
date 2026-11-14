/** Jeder Dienst nimmt den Kontext; Regeln ohne Datenbank stehen in regeln.ts. */
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as haushalt from './haushalt';
import { HAUSHALT_KANAL, leereHaushaltCache } from './regeln';
import { zugang, type HaushaltAbhaengigkeiten, type HaushaltKontext } from './kontext';

export type { HaushaltAbhaengigkeiten, HaushaltKontext } from './kontext';

export function erzeugeHaushalt(a: Omit<HaushaltAbhaengigkeiten, 'faecher'>, einblick?: Einblick<HaushaltKontext>) {
  const k: HaushaltKontext = baueKontext({ ...a, faecher: new Faecher() }, zugang);
  einblick?.(k);
  return {
    ...bindeZugang(k, haushalt),
    /** Nur ein getrennter Job-Prozess: Er hält eigene Caches, die der Web-Prozess ändert. */
    horcheAufAenderungen: () => k.db.benachrichtigung.listen(HAUSHALT_KANAL, leereHaushaltCache),
  };
}

export type HaushaltDienste = ReturnType<typeof erzeugeHaushalt>;
