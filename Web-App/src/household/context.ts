/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { Db } from '../../db/database';
import { imSystem, withValue, withContract, type Context } from '../infra/area';
import type { HouseholdReadContract } from './readContract';
import type { SettingsServices } from '../settings';
import type { Faecher } from '../infra/cache';
import * as repository from './repository';
import type { Clock } from '../infra/clock';

export interface HouseholdDependencies {
  uhr: Clock;
  db: Db;
  /** The households' memory per access; createHousehold creates it. */
  faecher: Faecher;
  einstellungen: SettingsServices;
  lesevertrag: HouseholdReadContract;
}

// Invitations are only visible to their account (0115); whoever redeems is not part of it, cleanup applies to all.
const FOREIGN_INVITATION = 'Einlösen: Die Einladung gehört dem einladenden Konto';
export const access = (db: Db, l: HouseholdReadContract) => ({
  repository: {
    subAccounts: withValue(db)(repository.subAccounts),
    elternkonten: withValue(db)(repository.parentAccounts),
    isLinked: withValue(db)(repository.isLinked),
    accountNames: withContract(db, l)(repository.accountNames),
    accountName: withContract(db, l)(repository.accountName),
    // Before joining, the invitee does not see the inviting account (0121).
    inviterName: withValue(l)(imSystem(db, FOREIGN_INVITATION, repository.accountName)),
    cleanInvitationsOn: imSystem(db, 'Abgelaufene Einladungen aller Konten', repository.cleanInvitationsOn),
    putInvitationAn: withValue(db)(repository.createInvitation),
    receiptsInvitation: imSystem(db, FOREIGN_INVITATION, repository.receiptsInvitation),
    inviterToCode: imSystem(db, FOREIGN_INVITATION, repository.inviterToCode),
    giveInvitationFree: imSystem(db, FOREIGN_INVITATION, repository.giveInvitationFree),
    link: withValue(db)(repository.link),
    separate: withValue(db)(repository.separate),
    resolveSubAccountAndInvitations: withValue(db)(repository.resolveSubAccountAndInvitations),
    deleteSeparatedHint: withValue(db)(repository.deleteSeparatedHint),
    openInvitations: withValue(db)(repository.openInvitations),
    separateChains: withContract(db, l)(repository.separateChains),
    ownerTheEntry: withContract(db, l)(repository.ownerTheEntry),
    userNames: withContract(db, l)(repository.userNames),
  },
});
export type HouseholdContext = Context<HouseholdDependencies, ReturnType<typeof access>>;
