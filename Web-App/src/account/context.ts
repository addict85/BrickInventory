/** What the services get; separate from area.ts so no import cycle arises. */
import type { AppConfig } from '../infra/config';
import type { Db } from '../../db/database';
import type { Compartments } from '../infra/cache';
import { imSystem, bound, type Context } from '../infra/area';
import * as setup from './repository/setup';
import * as accounts from './repository/accounts';
import * as log from './repository/log';
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
  clock: Clock;
  config: Readonly<AppConfig>;
  db: Db;
  /** State per access (token cache, session versions); createAccount creates them. */
  compartments: Compartments;
  settings: SettingsServices;
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
  setup: { accountsStatus: imSystem(db, ALL_NAMES, setup.accountsStatus) },
});

/** Accounts and log. */
const accountAccess = (db: Db) => ({
  accounts: {
    accountShort: imSystem(db, ALL_NAMES, accounts.accountShort),
    accountToNames: imSystem(db, WITHOUT_ACCOUNT, accounts.accountToNames),
    accountFull: imSystem(db, ADDRESS, accounts.accountFull),
    profileRow: imSystem(db, ADDRESS, accounts.profileRow),
    nameTaken: imSystem(db, ADDRESS, accounts.nameTaken),
    changeNames: bound(db)(accounts.changeNames),
    changeUsernames: imSystem(db, ACCESS, accounts.changeUsernames),
    discardPendingAddress: imSystem(db, ACCESS, accounts.discardPendingAddress),
    rememberEmailNew: imSystem(db, ACCESS, accounts.rememberEmailNew),
    accountToEmailToken: imSystem(db, ADDRESS, accounts.accountToEmailToken),
    adoptEmailNew: imSystem(db, ACCESS, accounts.adoptEmailNew),
    discardEmailNew: imSystem(db, ACCESS, accounts.discardEmailNew),
    nameForEmailToken: imSystem(db, ADDRESS, accounts.nameForEmailToken),
    openRegistrations: imSystem(db, ADDRESS, accounts.openRegistrations),
    switchRegistrationFree: imSystem(db, ACCESS, accounts.switchRegistrationFree),
    pendingWithoutLink: imSystem(db, ADDRESS, accounts.pendingWithoutLink),
    allAccounts: imSystem(db, 'Verwaltung: liest alle Konten', accounts.allAccounts),
    allAddresses: imSystem(db, ADDRESS, accounts.allAddresses),
    activeAdmin: imSystem(db, ADDRESS, accounts.activeAdmin),
    addAccountOne: imSystem(db, ACCESS, accounts.addAccountOne),
    setAdmin: imSystem(db, ACCESS, accounts.setAdmin),
    writeActive: imSystem(db, ACCESS, accounts.writeActive),
    setPasswordHash: imSystem(db, ACCESS, accounts.setPasswordHash),
    setOwnPassword: imSystem(db, ACCESS, accounts.setOwnPassword),
    accountExists: imSystem(db, ALL_NAMES, accounts.accountExists),
    deleteAccount: imSystem(db, ACCESS, accounts.deleteAccount),
    deleteOwnAccount: imSystem(db, ACCESS, accounts.deleteOwnAccount),
    deleteOpenRegistrations: imSystem(db, ACCESS, accounts.deleteOpenRegistrations),
    accountWithEmail: imSystem(db, ADDRESS, accounts.accountWithEmail),
    registerAccount: imSystem(db, ACCESS, accounts.registerAccount),
    activeAccountAfterEmail: imSystem(db, ADDRESS, accounts.activeAccountAfterEmail),
    setResetTokenIfFree: imSystem(db, ACCESS, accounts.setResetTokenIfFree),
    renewEmailTokenIfFree: imSystem(db, ACCESS, accounts.renewEmailTokenIfFree),
    accountAfterResetToken: imSystem(db, ADDRESS, accounts.accountAfterResetToken),
    resetSetPasswordAfter: imSystem(db, ACCESS, accounts.resetSetPasswordAfter),
    accessesOfAccount: bound(db)(accounts.accessesOfAccount),
    tokenStand: imSystem(db, 'Token-Prüfung: sucht über den Hash, ohne Konto', accounts.tokenStand),
    deleteAccess: bound(db)(accounts.deleteAccess),
    deleteOtherAccesses: bound(db)(accounts.deleteOtherAccesses),
    deleteOtherSessions: imSystem(db, SYSTEM_ROLE_ONLY, accounts.deleteOtherSessions),
    mustChangePassword: bound(db)(accounts.mustChangePassword),
  },
  log: {
    logEntry: imSystem(db, ALL_NAMES, log.logEntry),
    lastEntries: imSystem(db, ALL_NAMES, log.lastEntries),
    cleanLogOn: imSystem(db, ALL_ACCOUNTS, log.cleanLogOn),
  },
});

/** Pairing, start administrator and tokens. */
const sessionAccess = (db: Db) => ({
  qrPairing: {
    cleanQrPairingsOn: imSystem(db, ALL_ACCOUNTS, qrPairing.cleanQrPairingsOn),
    createQrPairing: imSystem(db, 'Das Gerät ohne Konto legt die Kopplung an', qrPairing.createQrPairing),
    report: imSystem(db, WITHOUT_ACCOUNT, qrPairing.report),
    afterPickup: imSystem(db, WITHOUT_ACCOUNT, qrPairing.afterPickup),
    qrPairingOfAccount: bound(db)(qrPairing.qrPairingOfAccount),
    markPickedUp: imSystem(db, WITHOUT_ACCOUNT, qrPairing.markPickedUp),
    markConfirmed: imSystem(db, 'Die Zeile trägt das Konto erst mit der Bestätigung', qrPairing.markConfirmed),
    countQrFailedAttempt: imSystem(db, 'wie markiereBestaetigt', qrPairing.countQrFailedAttempt),
    markRejected: imSystem(db, 'Auch das Gerät ohne Konto lehnt ab', qrPairing.markRejected),
  },
  takeovers: {
    scheduleTermination: imSystem(db, TAKEOVER, takeovers.scheduleTermination),
    adminOrJustBeen: imSystem(db, TAKEOVER, takeovers.adminOrJustBeen),
    takeDue: imSystem(db, TAKEOVER, takeovers.takeDue),
    abortTakeovers: imSystem(db, TAKEOVER, takeovers.abortTakeovers),
    targetToAbort: imSystem(db, 'Abbruch-Link: Die Anfrage trägt kein Konto', takeovers.targetToAbort),
    announced: imSystem(db, TAKEOVER, takeovers.announced),
  },
  startAdmin: {
    accountsPresent: imSystem(db, ALL_NAMES, startAdmin.accountsPresent),
    openStartPassword: imSystem(db, ALL_NAMES, startAdmin.openStartPassword),
    createAdmin: imSystem(db, ACCESS, startAdmin.createAdmin),
  },
  accesses: {
    validToken: imSystem(db, WITHOUT_ACCOUNT, accesses.validToken),
    endOverlap: imSystem(db, WITHOUT_ACCOUNT, accesses.endOverlap),
    touchToken: imSystem(db, WITHOUT_ACCOUNT, accesses.touchToken),
    createToken: imSystem(db, 'Anmeldung: Die Sitzung des neuen Tokens trägt noch kein Konto', accesses.insertToken),
    lockSwapSource: bound(db)(accesses.lockSwapSource),
    unusedSuccessor: bound(db)(accesses.unusedSuccessor),
    deleteFamily: bound(db)(accesses.deleteFamily),
    deleteUnusedSuccessor: bound(db)(accesses.deleteUnusedSuccessor),
    createSuccessor: bound(db)(accesses.createSuccessor),
    limitTimePredecessor: bound(db)(accesses.limitTimePredecessor),
    lockFamily: imSystem(db, WITHOUT_ACCOUNT, accesses.lockFamily),
    deleteOrphanedConsumed: imSystem(db, ALL_ACCOUNTS, accesses.deleteOrphanedConsumed),
    deleteToken: imSystem(
      db,
      'Abmelden mit einem Token, dessen Konto die Anfrage nicht mehr trägt',
      accesses.deleteTokenRow,
    ),
    deleteTokensOfAccount: imSystem(db, FOREIGN_ACCOUNT, accesses.deleteTokensOfAccount),
    capSessions: imSystem(db, SYSTEM_ROLE_ONLY, accesses.capSessions),
    capTokens: imSystem(db, 'Anmeldung: Die Sitzung des neuen Tokens trägt noch kein Konto', accesses.capTokens),
    deleteSessionsOfAccount: imSystem(db, SYSTEM_ROLE_ONLY, accesses.deleteSessionsOfAccount),
    sessionVersion: imSystem(db, WITHOUT_ACCOUNT, accesses.sessionVersion),
    countSessionVersionHigh: imSystem(db, ACCESS, accesses.countSessionVersionHigh),
    boundUnlimited: imSystem(db, ALL_ACCOUNTS, accesses.boundUnlimited),
    pullOldRowsAfter: imSystem(db, ALL_ACCOUNTS, accesses.pullOldRowsAfter),
    deleteExpired: imSystem(db, ALL_ACCOUNTS, accesses.deleteExpiredAccesses),
    deleteUnused: imSystem(db, ALL_ACCOUNTS, accesses.deleteUnused),
    accountToLogin: imSystem(db, SYSTEM_ROLE_ONLY, accesses.accountToLogin),
    passwordHash: imSystem(db, SYSTEM_ROLE_ONLY, accesses.passwordHash),
    replacePasswordHash: imSystem(db, SYSTEM_ROLE_ONLY, accesses.replacePasswordHash),
  },
});

export const access = (db: Db) => ({ ...setupAccess(db), ...accountAccess(db), ...sessionAccess(db) });
export type AccountContext = Context<AccountDependencies, ReturnType<typeof access>>;
