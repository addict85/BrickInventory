/** What the services get; separate from area.ts so no import cycle arises. */
import type { AppConfig } from '../infra/config';
import type { Db } from '../../db/database';
import type { Compartments } from '../infra/cache';
import { asSystem, bound, type Context } from '../infra/area';
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
  setup: { accountsStatus: asSystem(db, ALL_NAMES, setup.accountsStatus) },
});

/** Accounts and log. */
const accountAccess = (db: Db) => ({
  accounts: {
    accountShort: asSystem(db, ALL_NAMES, accounts.accountShort),
    accountToNames: asSystem(db, WITHOUT_ACCOUNT, accounts.accountToNames),
    accountFull: asSystem(db, ADDRESS, accounts.accountFull),
    profileRow: asSystem(db, ADDRESS, accounts.profileRow),
    nameTaken: asSystem(db, ADDRESS, accounts.nameTaken),
    changeNames: bound(db)(accounts.changeNames),
    changeUsernames: asSystem(db, ACCESS, accounts.changeUsernames),
    discardPendingAddress: asSystem(db, ACCESS, accounts.discardPendingAddress),
    rememberEmailNew: asSystem(db, ACCESS, accounts.rememberEmailNew),
    accountToEmailToken: asSystem(db, ADDRESS, accounts.accountToEmailToken),
    adoptEmailNew: asSystem(db, ACCESS, accounts.adoptEmailNew),
    discardEmailNew: asSystem(db, ACCESS, accounts.discardEmailNew),
    nameForEmailToken: asSystem(db, ADDRESS, accounts.nameForEmailToken),
    openRegistrations: asSystem(db, ADDRESS, accounts.openRegistrations),
    switchRegistrationFree: asSystem(db, ACCESS, accounts.switchRegistrationFree),
    pendingWithoutLink: asSystem(db, ADDRESS, accounts.pendingWithoutLink),
    allAccounts: asSystem(db, 'Verwaltung: liest alle Konten', accounts.allAccounts),
    allAddresses: asSystem(db, ADDRESS, accounts.allAddresses),
    activeAdmin: asSystem(db, ADDRESS, accounts.activeAdmin),
    addAccountOne: asSystem(db, ACCESS, accounts.addAccountOne),
    setAdmin: asSystem(db, ACCESS, accounts.setAdmin),
    writeActive: asSystem(db, ACCESS, accounts.writeActive),
    setPasswordHash: asSystem(db, ACCESS, accounts.setPasswordHash),
    setOwnPassword: asSystem(db, ACCESS, accounts.setOwnPassword),
    accountExists: asSystem(db, ALL_NAMES, accounts.accountExists),
    deleteAccount: asSystem(db, ACCESS, accounts.deleteAccount),
    deleteOwnAccount: asSystem(db, ACCESS, accounts.deleteOwnAccount),
    deleteOpenRegistrations: asSystem(db, ACCESS, accounts.deleteOpenRegistrations),
    accountWithEmail: asSystem(db, ADDRESS, accounts.accountWithEmail),
    registerAccount: asSystem(db, ACCESS, accounts.registerAccount),
    activeAccountAfterEmail: asSystem(db, ADDRESS, accounts.activeAccountAfterEmail),
    setResetTokenIfFree: asSystem(db, ACCESS, accounts.setResetTokenIfFree),
    renewEmailTokenIfFree: asSystem(db, ACCESS, accounts.renewEmailTokenIfFree),
    accountAfterResetToken: asSystem(db, ADDRESS, accounts.accountAfterResetToken),
    resetSetPasswordAfter: asSystem(db, ACCESS, accounts.resetSetPasswordAfter),
    accessesOfAccount: bound(db)(accounts.accessesOfAccount),
    tokenState: asSystem(db, 'Token-Prüfung: sucht über den Hash, ohne Konto', accounts.tokenState),
    deleteAccess: bound(db)(accounts.deleteAccess),
    deleteOtherAccesses: bound(db)(accounts.deleteOtherAccesses),
    deleteOtherSessions: asSystem(db, SYSTEM_ROLE_ONLY, accounts.deleteOtherSessions),
    mustChangePassword: bound(db)(accounts.mustChangePassword),
  },
  log: {
    logEntry: asSystem(db, ALL_NAMES, log.logEntry),
    lastEntries: asSystem(db, ALL_NAMES, log.lastEntries),
    cleanLogOn: asSystem(db, ALL_ACCOUNTS, log.cleanLogOn),
  },
});

/** Pairing, start administrator and tokens. */
const sessionAccess = (db: Db) => ({
  qrPairing: {
    cleanQrPairingsOn: asSystem(db, ALL_ACCOUNTS, qrPairing.cleanQrPairingsOn),
    createQrPairing: asSystem(db, 'Das Gerät ohne Konto legt die Kopplung an', qrPairing.createQrPairing),
    report: asSystem(db, WITHOUT_ACCOUNT, qrPairing.report),
    afterPickup: asSystem(db, WITHOUT_ACCOUNT, qrPairing.afterPickup),
    qrPairingOfAccount: bound(db)(qrPairing.qrPairingOfAccount),
    markPickedUp: asSystem(db, WITHOUT_ACCOUNT, qrPairing.markPickedUp),
    markConfirmed: asSystem(db, 'Die Zeile trägt das Konto erst mit der Bestätigung', qrPairing.markConfirmed),
    countQrFailedAttempt: asSystem(db, 'wie markiereBestaetigt', qrPairing.countQrFailedAttempt),
    markRejected: asSystem(db, 'Auch das Gerät ohne Konto lehnt ab', qrPairing.markRejected),
  },
  takeovers: {
    scheduleTermination: asSystem(db, TAKEOVER, takeovers.scheduleTermination),
    adminOrJustBeen: asSystem(db, TAKEOVER, takeovers.adminOrJustBeen),
    takeDue: asSystem(db, TAKEOVER, takeovers.takeDue),
    abortTakeovers: asSystem(db, TAKEOVER, takeovers.abortTakeovers),
    targetToAbort: asSystem(db, 'Abbruch-Link: Die Anfrage trägt kein Konto', takeovers.targetToAbort),
    announced: asSystem(db, TAKEOVER, takeovers.announced),
  },
  startAdmin: {
    accountsPresent: asSystem(db, ALL_NAMES, startAdmin.accountsPresent),
    openStartPassword: asSystem(db, ALL_NAMES, startAdmin.openStartPassword),
    createAdmin: asSystem(db, ACCESS, startAdmin.createAdmin),
  },
  accesses: {
    validToken: asSystem(db, WITHOUT_ACCOUNT, accesses.validToken),
    endOverlap: asSystem(db, WITHOUT_ACCOUNT, accesses.endOverlap),
    touchToken: asSystem(db, WITHOUT_ACCOUNT, accesses.touchToken),
    createToken: asSystem(db, 'Anmeldung: Die Sitzung des neuen Tokens trägt noch kein Konto', accesses.insertToken),
    lockSwapSource: bound(db)(accesses.lockSwapSource),
    unusedSuccessor: bound(db)(accesses.unusedSuccessor),
    deleteFamily: bound(db)(accesses.deleteFamily),
    deleteUnusedSuccessor: bound(db)(accesses.deleteUnusedSuccessor),
    createSuccessor: bound(db)(accesses.createSuccessor),
    limitTimePredecessor: bound(db)(accesses.limitTimePredecessor),
    lockFamily: asSystem(db, WITHOUT_ACCOUNT, accesses.lockFamily),
    deleteOrphanedConsumed: asSystem(db, ALL_ACCOUNTS, accesses.deleteOrphanedConsumed),
    deleteToken: asSystem(
      db,
      'Abmelden mit einem Token, dessen Konto die Anfrage nicht mehr trägt',
      accesses.deleteTokenRow,
    ),
    deleteTokensOfAccount: asSystem(db, FOREIGN_ACCOUNT, accesses.deleteTokensOfAccount),
    capSessions: asSystem(db, SYSTEM_ROLE_ONLY, accesses.capSessions),
    capTokens: asSystem(db, 'Anmeldung: Die Sitzung des neuen Tokens trägt noch kein Konto', accesses.capTokens),
    deleteSessionsOfAccount: asSystem(db, SYSTEM_ROLE_ONLY, accesses.deleteSessionsOfAccount),
    sessionVersion: asSystem(db, WITHOUT_ACCOUNT, accesses.sessionVersion),
    countSessionVersionHigh: asSystem(db, ACCESS, accesses.countSessionVersionHigh),
    boundUnlimited: asSystem(db, ALL_ACCOUNTS, accesses.boundUnlimited),
    pullOldRowsAfter: asSystem(db, ALL_ACCOUNTS, accesses.pullOldRowsAfter),
    deleteExpired: asSystem(db, ALL_ACCOUNTS, accesses.deleteExpiredAccesses),
    deleteUnused: asSystem(db, ALL_ACCOUNTS, accesses.deleteUnused),
    accountToLogin: asSystem(db, SYSTEM_ROLE_ONLY, accesses.accountToLogin),
    passwordHash: asSystem(db, SYSTEM_ROLE_ONLY, accesses.passwordHash),
    replacePasswordHash: asSystem(db, SYSTEM_ROLE_ONLY, accesses.replacePasswordHash),
  },
});

export const access = (db: Db) => ({ ...setupAccess(db), ...accountAccess(db), ...sessionAccess(db) });
export type AccountContext = Context<AccountDependencies, ReturnType<typeof access>>;
