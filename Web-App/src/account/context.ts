/** What the services get; separate from area.ts so no import cycle arises. */
import type { Konfig } from '../infra/config';
import type { Db } from '../../db/database';
import type { Faecher } from '../infra/cache';
import { imSystem, withValue, type Context } from '../infra/area';
import * as setup from './repository/setup';
import * as konten from './repository/accounts';
import * as protokoll from './repository/log';
import * as qrPairing from './repository/qrPairing';
import * as startAdmin from './repository/startAdmin';
import * as takeovers from './repository/takeovers';
import * as accesses from './repository/accesses';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../household';
import type { JobsServices } from '../jobQueue';
import type { MailServices } from '../mail';
import type { ThrottleServices } from '../throttle';
import type { DevicesServices } from '../devices';
import type { FactorsServices } from '../factors';
import type { Clock } from '../infra/clock';

export interface AccountDependencies {
  uhr: Clock;
  konfig: Readonly<Konfig>;
  db: Db;
  /** State per access (token cache, session versions); createAccount creates them. */
  faecher: Faecher;
  einstellungen: SettingsServices;
  jobQueue: JobsServices;
  household: HouseholdServices;
  mail: MailServices;
  throttle: ThrottleServices;
  devices: DevicesServices;
  factors: FactorsServices;
}

/** Credentials are under row-level security (0112): only whoever works without an account
 * or across all accounts gets the system frame; what an account reads about itself runs without it. */
const WITHOUT_ACCOUNT = 'Anmeldung oder Token-Prüfung: Es gibt noch kein Konto, für das der Zeilenschutz gälte';
const ALL_ACCOUNTS = 'Aufräumen über alle Konten';
const FOREIGN_ACCOUNT = 'Verwaltung oder Passwort vergessen: ändert ein Konto, das die Anfrage nicht trägt';
const SYSTEM_ROLE_ONLY = 'Passwort-Hash oder Sitzungsspeicher: nur die Systemrolle darf sie lesen';
const TAKEOVER = 'Verwalterübernahme: Verwalter und Ziel sind verschiedene Konten';
const ACCESS = 'Passwort, Rechte, Adresse und Sitzungsversion schreibt nur die Systemrolle (0117)';
const ADDRESS = 'Adressen und Links liest nur die Systemrolle (0121)';
const ALL_NAMES = 'Fremde Konten: Die Laufzeitrolle sieht nur das eigene und den Haushalt (0121)';

/** The setup state of the start page: accounts at all, and whether the start password still applies. */
const setupAccess = (db: Db) => ({
  einrichtung: { accountsStatus: imSystem(db, ALL_NAMES, setup.accountsStatus) },
});

/** Accounts and log. */
const accountAccess = (db: Db) => ({
  konten: {
    accountShort: imSystem(db, ALL_NAMES, konten.accountShort),
    accountToNames: imSystem(db, WITHOUT_ACCOUNT, konten.accountToNames),
    accountFull: imSystem(db, ADDRESS, konten.accountFull),
    profileRow: imSystem(db, ADDRESS, konten.profileRow),
    nameTaken: imSystem(db, ADDRESS, konten.nameTaken),
    changeNames: withValue(db)(konten.changeNames),
    changeUsernames: imSystem(db, ACCESS, konten.changeUsernames),
    discardPendingAddress: imSystem(db, ACCESS, konten.discardPendingAddress),
    rememberEmailNew: imSystem(db, ACCESS, konten.rememberEmailNew),
    accountToEmailToken: imSystem(db, ADDRESS, konten.accountToEmailToken),
    adoptEmailNew: imSystem(db, ACCESS, konten.adoptEmailNew),
    discardEmailNew: imSystem(db, ACCESS, konten.discardEmailNew),
    nameZuEmailToken: imSystem(db, ADDRESS, konten.nameForEmailToken),
    openRegistrations: imSystem(db, ADDRESS, konten.openRegistrations),
    switchRegistrationFree: imSystem(db, ACCESS, konten.switchRegistrationFree),
    pendingWithoutLink: imSystem(db, ADDRESS, konten.pendingWithoutLink),
    allAccounts: imSystem(db, 'Verwaltung: liest alle Konten', konten.allAccounts),
    allAddresses: imSystem(db, ADDRESS, konten.allAddresses),
    activeAdmin: imSystem(db, ADDRESS, konten.activeAdmin),
    addAccountOne: imSystem(db, ACCESS, konten.addAccountOne),
    setAdmin: imSystem(db, ACCESS, konten.setAdmin),
    writeActive: imSystem(db, ACCESS, konten.writeActive),
    setPasswordHash: imSystem(db, ACCESS, konten.setPasswordHash),
    setOwnPassword: imSystem(db, ACCESS, konten.setOwnPassword),
    accountExists: imSystem(db, ALL_NAMES, konten.accountExists),
    deleteAccount: imSystem(db, ACCESS, konten.deleteAccount),
    deleteOwnAccount: imSystem(db, ACCESS, konten.deleteOwnAccount),
    deleteOpenRegistrations: imSystem(db, ACCESS, konten.deleteOpenRegistrations),
    accountWithEmail: imSystem(db, ADDRESS, konten.accountWithEmail),
    registerAccount: imSystem(db, ACCESS, konten.registerAccount),
    activeAccountAfterEmail: imSystem(db, ADDRESS, konten.activeAccountAfterEmail),
    setRuecksetzTokenIfFree: imSystem(db, ACCESS, konten.setResetTokenIfFree),
    renewEmailTokenIfFree: imSystem(db, ACCESS, konten.renewEmailTokenIfFree),
    accountAfterRuecksetzToken: imSystem(db, ADDRESS, konten.accountAfterResetToken),
    resetSetPasswordAfter: imSystem(db, ACCESS, konten.resetSetPasswordAfter),
    accessesOfAccount: withValue(db)(konten.accessesOfAccount),
    tokenStand: imSystem(db, 'Token-Prüfung: sucht über den Hash, ohne Konto', konten.tokenStand),
    deleteAccess: withValue(db)(konten.deleteAccess),
    deleteOtherAccesses: withValue(db)(konten.deleteOtherAccesses),
    deleteOtherSessions: imSystem(db, SYSTEM_ROLE_ONLY, konten.deleteOtherSessions),
    mussPasswortAendern: withValue(db)(konten.mustChangePassword),
  },
  protokoll: {
    protokolliere: imSystem(db, ALL_NAMES, protokoll.protokolliere),
    lastEntries: imSystem(db, ALL_NAMES, protokoll.lastEntries),
    cleanLogOn: imSystem(db, ALL_ACCOUNTS, protokoll.cleanLogOn),
  },
});

/** Pairing, start administrator and tokens. */
const sessionAccess = (db: Db) => ({
  qrKopplung: {
    cleanQrPairingsOn: imSystem(db, ALL_ACCOUNTS, qrPairing.cleanQrPairingsOn),
    putQrPairingAn: imSystem(db, 'Das Gerät ohne Konto legt die Kopplung an', qrPairing.createQrPairing),
    melde: imSystem(db, WITHOUT_ACCOUNT, qrPairing.report),
    afterPickup: imSystem(db, WITHOUT_ACCOUNT, qrPairing.afterPickup),
    qrPairingOfAccount: withValue(db)(qrPairing.qrPairingOfAccount),
    markPickedUp: imSystem(db, WITHOUT_ACCOUNT, qrPairing.markPickedUp),
    markConfirmed: imSystem(db, 'Die Zeile trägt das Konto erst mit der Bestätigung', qrPairing.markConfirmed),
    countQrFailedAttempt: imSystem(db, 'wie markiereBestaetigt', qrPairing.countQrFailedAttempt),
    markRejected: imSystem(db, 'Auch das Gerät ohne Konto lehnt ab', qrPairing.markRejected),
  },
  uebernahmen: {
    terminateAn: imSystem(db, TAKEOVER, takeovers.scheduleTermination),
    adminOrJustBeen: imSystem(db, TAKEOVER, takeovers.adminOrJustBeen),
    takeDue: imSystem(db, TAKEOVER, takeovers.takeDue),
    abortTakeoversAb: imSystem(db, TAKEOVER, takeovers.abortTakeovers),
    targetToAbort: imSystem(db, 'Abbruch-Link: Die Anfrage trägt kein Konto', takeovers.targetToAbort),
    announced: imSystem(db, TAKEOVER, takeovers.announced),
  },
  startVerwalter: {
    accountsPresent: imSystem(db, ALL_NAMES, startAdmin.accountsPresent),
    openStartpasswort: imSystem(db, ALL_NAMES, startAdmin.openStartPassword),
    putAdminAn: imSystem(db, ACCESS, startAdmin.createAdmin),
  },
  zugaenge: {
    validToken: imSystem(db, WITHOUT_ACCOUNT, accesses.validToken),
    endOverlap: imSystem(db, WITHOUT_ACCOUNT, accesses.endOverlap),
    touchToken: imSystem(db, WITHOUT_ACCOUNT, accesses.touchToken),
    putTokenAn: imSystem(db, 'Anmeldung: Die Sitzung des neuen Tokens trägt noch kein Konto', accesses.createToken),
    lockSwapSource: withValue(db)(accesses.lockSwapSource),
    unusedSuccessor: withValue(db)(accesses.unusedSuccessor),
    deleteFamily: withValue(db)(accesses.deleteFamily),
    deleteUnusedSuccessor: withValue(db)(accesses.deleteUnusedSuccessor),
    putSuccessorAn: withValue(db)(accesses.createSuccessor),
    limitTimePredecessor: withValue(db)(accesses.limitTimePredecessor),
    lockFamily: imSystem(db, WITHOUT_ACCOUNT, accesses.lockFamily),
    deleteOrphanedConsumed: imSystem(db, ALL_ACCOUNTS, accesses.deleteOrphanedConsumed),
    loescheToken: imSystem(
      db,
      'Abmelden mit einem Token, dessen Konto die Anfrage nicht mehr trägt',
      accesses.deleteToken,
    ),
    deleteTokensOfAccount: imSystem(db, FOREIGN_ACCOUNT, accesses.deleteTokensOfAccount),
    capSessions: imSystem(db, SYSTEM_ROLE_ONLY, accesses.capSessions),
    capTokens: imSystem(db, 'Anmeldung: Die Sitzung des neuen Tokens trägt noch kein Konto', accesses.capTokens),
    deleteSessionsOfAccount: imSystem(db, SYSTEM_ROLE_ONLY, accesses.deleteSessionsOfAccount),
    sitzungsVersion: imSystem(db, WITHOUT_ACCOUNT, accesses.sessionVersion),
    countSessionVersionHigh: imSystem(db, ACCESS, accesses.countSessionVersionHigh),
    boundUnlimited: imSystem(db, ALL_ACCOUNTS, accesses.boundUnlimited),
    pullAltzeilenAfter: imSystem(db, ALL_ACCOUNTS, accesses.pullOldRowsAfter),
    deleteExpired: imSystem(db, ALL_ACCOUNTS, accesses.deleteExpiredAccesses),
    deleteUnused: imSystem(db, ALL_ACCOUNTS, accesses.deleteUnused),
    accountToLogin: imSystem(db, SYSTEM_ROLE_ONLY, accesses.accountToLogin),
    passwortHash: imSystem(db, SYSTEM_ROLE_ONLY, accesses.passwortHash),
    replacePasswordHash: imSystem(db, SYSTEM_ROLE_ONLY, accesses.replacePasswordHash),
  },
});

export const access = (db: Db) => ({ ...setupAccess(db), ...accountAccess(db), ...sessionAccess(db) });
export type AccountContext = Context<AccountDependencies, ReturnType<typeof access>>;
