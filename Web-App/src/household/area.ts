/** Every service takes the context; rules without a database live in rules.ts. */
import type { Db } from '../../db/database';
import { withValue, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
import * as household from './household';
import { access, type HouseholdDependencies, type HouseholdContext } from './context';

export type { HouseholdDependencies, HouseholdContext } from './context';

export function createHousehold(a: Omit<HouseholdDependencies, 'faecher'>, inspect?: Inspect<HouseholdContext>) {
  return buildArea(
    { ...a, faecher: new Faecher() },
    (db: Db) => access(db, a.lesevertrag),
    (k: HouseholdContext) => ({
      reportHouseholdChange: withValue(k)(household.reportHouseholdChange),
      schreibbereich: withValue(k)(household.writeScope),
      householdMembers: withValue(k)(household.householdMembers),
      createInvitation: withValue(k)(household.createInvitation),
      checkInvitation: withValue(k)(household.checkInvitation),
      redeemInvitation: withValue(k)(household.redeemInvitation),
      unlinkAccounts: withValue(k)(household.unlinkAccounts),
      unlinkForeignAccess: withValue(k)(household.unlinkForeignAccess),
      discardSeparated: withValue(k)(household.discardSeparated),
      householdStatus: withValue(k)(household.householdStatus),
      scopeIds: withValue(k)(household.scopeIds),
      scopeFrom: withValue(k)(household.scopeFrom),
      writeAreaFrom: withValue(k)(household.writeAreaFrom),
      seesAccount: withValue(k)(household.seesAccount),
      schreibziel: withValue(k)(household.writeTarget),
      writeTargetOrNull: withValue(k)(household.writeTargetOrNull),
      moveSource: withValue(k)(household.moveSource),
      besitzerAnhaengen: withValue(k)(household.attachOwners),
      atHouseholdChange: withValue(k)(household.atHouseholdChange),
      listenOnChanges: withValue(k)(household.listenOnChanges),
    }),
    inspect,
  );
}

export type HouseholdServices = ReturnType<typeof createHousehold>;
