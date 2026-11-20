/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { imSystem, mit, withContract, type Kontext } from '../infra/bereich';
import type { HouseholdReadContract } from './readContract';
import type { SettingsServices } from '../settings';
import type { Faecher } from '../infra/zwischenspeicher';
import * as repository from './repository';
import type { Uhr } from '../infra/uhr';

export interface HouseholdDependencies {
  uhr: Uhr;
  db: Db;
  /** Das Gedächtnis der Haushalte je Zugang; createHousehold legt es an. */
  faecher: Faecher;
  einstellungen: SettingsServices;
  lesevertrag: HouseholdReadContract;
}

// Einladungen sieht nur ihr Konto (0115); wer einlöst, gehört nicht dazu, Aufräumen gilt allen.
const FOREIGN_INVITATION = 'Einlösen: Die Einladung gehört dem einladenden Konto';
export const zugang = (db: Db, l: HouseholdReadContract) => ({
  repository: {
    subAccounts: mit(db)(repository.subAccounts),
    elternkonten: mit(db)(repository.elternkonten),
    isLinked: mit(db)(repository.isLinked),
    accountNames: withContract(db, l)(repository.accountNames),
    accountName: withContract(db, l)(repository.accountName),
    // Vor dem Beitritt sieht der Eingeladene das einladende Konto nicht (0121).
    inviterName: mit(l)(imSystem(db, FOREIGN_INVITATION, repository.accountName)),
    cleanInvitationsOn: imSystem(db, 'Abgelaufene Einladungen aller Konten', repository.cleanInvitationsOn),
    putInvitationAn: mit(db)(repository.putInvitationAn),
    receiptsInvitation: imSystem(db, FOREIGN_INVITATION, repository.receiptsInvitation),
    inviterToCode: imSystem(db, FOREIGN_INVITATION, repository.inviterToCode),
    giveInvitationFree: imSystem(db, FOREIGN_INVITATION, repository.giveInvitationFree),
    link: mit(db)(repository.link),
    separate: mit(db)(repository.separate),
    resolveSubAccountAndInvitations: mit(db)(repository.resolveSubAccountAndInvitations),
    deleteSeparatedHint: mit(db)(repository.deleteSeparatedHint),
    openInvitations: mit(db)(repository.openInvitations),
    separateChains: withContract(db, l)(repository.separateChains),
    ownerTheEntry: withContract(db, l)(repository.ownerTheEntry),
    userNames: withContract(db, l)(repository.userNames),
  },
});
export type HouseholdContext = Kontext<HouseholdDependencies, ReturnType<typeof zugang>>;
