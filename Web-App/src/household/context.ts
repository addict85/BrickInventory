/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { Db } from '../../db/database';
import { imSystem, bound, withContract, type Context } from '../infra/area';
import type { HouseholdReadContract } from './readContract';
import type { SettingsServices } from '../settings';
import type { Compartments } from '../infra/cache';
import * as repository from './repository';
import type { Clock } from '../infra/clock';

export interface HouseholdDependencies {
  clock: Clock;
  db: Db;
  /** The households' memory per access; createHousehold creates it. */
  compartments: Compartments;
  settings: SettingsServices;
  readContract: HouseholdReadContract;
}

// Invitations are only visible to their account (0115); whoever redeems is not part of it, cleanup applies to all.
const FOREIGN_INVITATION = 'Einlösen: Die Einladung gehört dem einladenden Konto';
export const access = (db: Db, l: HouseholdReadContract) => ({
  repository: {
    subAccounts: bound(db)(repository.subAccounts),
    parentAccounts: bound(db)(repository.parentAccounts),
    isLinked: bound(db)(repository.isLinked),
    accountNames: withContract(db, l)(repository.accountNames),
    accountName: withContract(db, l)(repository.accountName),
    // Before joining, the invitee does not see the inviting account (0121).
    inviterName: bound(l)(imSystem(db, FOREIGN_INVITATION, repository.accountName)),
    cleanInvitationsOn: imSystem(db, 'Abgelaufene Einladungen aller Konten', repository.cleanInvitationsOn),
    createInvitation: bound(db)(repository.insertInvitation),
    receiptsInvitation: imSystem(db, FOREIGN_INVITATION, repository.receiptsInvitation),
    inviterToCode: imSystem(db, FOREIGN_INVITATION, repository.inviterToCode),
    giveInvitationFree: imSystem(db, FOREIGN_INVITATION, repository.giveInvitationFree),
    link: bound(db)(repository.link),
    separate: bound(db)(repository.separate),
    resolveSubAccountAndInvitations: bound(db)(repository.resolveSubAccountAndInvitations),
    deleteSeparatedHint: bound(db)(repository.deleteSeparatedHint),
    openInvitations: bound(db)(repository.openInvitations),
    separateChains: withContract(db, l)(repository.separateChains),
    ownerTheEntry: withContract(db, l)(repository.ownerTheEntry),
    userNames: withContract(db, l)(repository.userNames),
  },
});
export type HouseholdContext = Context<HouseholdDependencies, ReturnType<typeof access>>;
