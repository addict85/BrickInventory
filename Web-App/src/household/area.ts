/** Jeder Dienst nimmt den Kontext; Regeln ohne Datenbank stehen in regeln.ts. */
import type { Db } from '../../db/database';
import { mit, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
import * as haushalt from './household';
import { zugang, type HouseholdDependencies, type HouseholdContext } from './context';

export type { HouseholdDependencies, HouseholdContext } from './context';

export function createHousehold(a: Omit<HouseholdDependencies, 'faecher'>, inspect?: Inspect<HouseholdContext>) {
  return buildArea(
    { ...a, faecher: new Faecher() },
    (db: Db) => zugang(db, a.lesevertrag),
    (k: HouseholdContext) => ({
      reportHouseholdChange: mit(k)(haushalt.reportHouseholdChange),
      schreibbereich: mit(k)(haushalt.schreibbereich),
      householdMembers: mit(k)(haushalt.householdMembers),
      createInvitation: mit(k)(haushalt.createInvitation),
      checkInvitation: mit(k)(haushalt.checkInvitation),
      redeemInvitation: mit(k)(haushalt.redeemInvitation),
      unlinkAccounts: mit(k)(haushalt.unlinkAccounts),
      unlinkForeignAccess: mit(k)(haushalt.unlinkForeignAccess),
      discardSeparated: mit(k)(haushalt.discardSeparated),
      householdStatus: mit(k)(haushalt.householdStatus),
      scopeIds: mit(k)(haushalt.scopeIds),
      scopeFrom: mit(k)(haushalt.scopeFrom),
      writeAreaFrom: mit(k)(haushalt.writeAreaFrom),
      seesAccount: mit(k)(haushalt.seesAccount),
      schreibziel: mit(k)(haushalt.schreibziel),
      writeTargetOrNull: mit(k)(haushalt.writeTargetOrNull),
      moveSource: mit(k)(haushalt.moveSource),
      besitzerAnhaengen: mit(k)(haushalt.besitzerAnhaengen),
      atHouseholdChange: mit(k)(haushalt.atHouseholdChange),
      listenOnChanges: mit(k)(haushalt.listenOnChanges),
    }),
    inspect,
  );
}

export type HouseholdServices = ReturnType<typeof createHousehold>;
