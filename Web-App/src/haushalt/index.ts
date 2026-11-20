/** Die öffentliche Seite des Bereichs; was die Datenbank braucht, ist ein Dienst. */

export {
  HOUSEHOLD_CHANNEL,
  asIds,
  scopeKind,
} from './regeln';
export type { Blickfeld, ScopeInput, ScopeMode, Schreiber, Sicht } from './regeln';
export { createHousehold } from './bereich';
export type { HouseholdDependencies, HouseholdServices, HouseholdContext } from './bereich';
