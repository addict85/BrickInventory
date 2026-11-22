/** The public face of the area; whatever needs the database is a service. */

export {
  HOUSEHOLD_CHANNEL,
  asIds,
  scopeKind,
} from './rules';
export type { Scope as Blickfeld, ScopeInput, ScopeMode, Writer as Schreiber, Sicht } from './rules';
export { createHousehold } from './area';
export type { HouseholdDependencies, HouseholdServices, HouseholdContext } from './area';
