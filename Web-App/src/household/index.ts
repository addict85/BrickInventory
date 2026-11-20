/** Die öffentliche Seite des Bereichs; was die Datenbank braucht, ist ein Dienst. */

export {
  HOUSEHOLD_CHANNEL,
  asIds,
  scopeKind,
} from './rules';
export type { Blickfeld, ScopeInput, ScopeMode, Schreiber, Sicht } from './rules';
export { createHousehold } from './area';
export type { HouseholdDependencies, HouseholdServices, HouseholdContext } from './area';
