/** Die öffentliche Seite des Bereichs; was die Datenbank braucht, ist ein Dienst. */

export {
  HAUSHALT_KANAL,
  asIds,
  parseScopeMode,
} from './regeln';
export type { Blickfeld, BlickfeldEingabe, ScopeMode, Schreiber, Sicht } from './regeln';
export { erzeugeHaushalt } from './bereich';
export type { HaushaltAbhaengigkeiten, HaushaltDienste, HaushaltKontext } from './bereich';
