/** Every service takes the context; rules without a database live in rules.ts. */
import type { Db } from '../../db/database';
import { bound, buildArea, type Inspect } from '../infra/area';
import { Compartments } from '../infra/cache';
import * as household from './household';
import { access, type HouseholdDependencies, type HouseholdContext } from './context';

export type { HouseholdDependencies, HouseholdContext } from './context';

export function createHousehold(a: Omit<HouseholdDependencies, 'faecher'>, inspect?: Inspect<HouseholdContext>) {
  return buildArea(
    { ...a, faecher: new Compartments() },
    (db: Db) => access(db, a.readContract),
    (k: HouseholdContext) => ({
      reportHouseholdChange: bound(k)(household.reportHouseholdChange),
      writeScope: bound(k)(household.writeScope),
      householdMembers: bound(k)(household.householdMembers),
      createInvitation: bound(k)(household.createInvitation),
      checkInvitation: bound(k)(household.checkInvitation),
      redeemInvitation: bound(k)(household.redeemInvitation),
      unlinkAccounts: bound(k)(household.unlinkAccounts),
      unlinkForeignAccess: bound(k)(household.unlinkForeignAccess),
      discardSeparated: bound(k)(household.discardSeparated),
      householdStatus: bound(k)(household.householdStatus),
      scopeIds: bound(k)(household.scopeIds),
      scopeFrom: bound(k)(household.scopeFrom),
      writeAreaFrom: bound(k)(household.writeAreaFrom),
      seesAccount: bound(k)(household.seesAccount),
      writeTarget: bound(k)(household.writeTarget),
      writeTargetOrNull: bound(k)(household.writeTargetOrNull),
      moveSource: bound(k)(household.moveSource),
      attachOwners: bound(k)(household.attachOwners),
      atHouseholdChange: bound(k)(household.atHouseholdChange),
      listenOnChanges: bound(k)(household.listenOnChanges),
    }),
    inspect,
  );
}

export type HouseholdServices = ReturnType<typeof createHousehold>;
