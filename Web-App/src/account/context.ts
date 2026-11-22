/** What the services get; separate from area.ts so no import cycle arises. */
import type { Konfig } from '../infra/config';
import type { Db } from '../../db/database';
import type { Faecher } from '../infra/cache';
import { imSystem, mit, type Kontext } from '../infra/area';
import * as einrichtung from './repository/setup';
import * as konten from './repository/accounts';
import * as protokoll from './repository/log';
import * as qrKopplung from './repository/qrPairing';
import * as startVerwalter from './repository/startAdmin';
import * as uebernahmen from './repository/takeovers';
import * as zugaenge from './repository/accesses';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../household';
import type { JobsServices } from '../jobQueue';
import type { MailServices } from '../mail';
import type { ThrottleServices } from '../throttle';
import type { DevicesServices } from '../devices';
import type { FactorsServices } from '../factors';
import type { Uhr } from '../infra/clock';

export interface AccountDependencies {
  uhr: Uhr;
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
const NUR_SYSTEMROLLE = 'Passwort-Hash oder Sitzungsspeicher: nur die Systemrolle darf sie lesen';
const TAKEOVER = 'Verwalterübernahme: Verwalter und Ziel sind verschiedene Konten';
const ACCESS = 'Passwort, Rechte, Adresse und Sitzungsversion schreibt nur die Systemrolle (0117)';
const ADDRESS = 'Adressen und Links liest nur die Systemrolle (0121)';
const ALL_NAMES = 'Fremde Konten: Die Laufzeitrolle sieht nur das eigene und den Haushalt (0121)';

/** The setup state of the start page: accounts at all, and whether the start password still applies. */
const einrichtungszugang = (db: Db) => ({
  einrichtung: { accountsStatus: imSystem(db, ALL_NAMES, einrichtung.accountsStatus) },
});

/** Accounts and log. */
const kontenzugang = (db: Db) => ({
  konten: {
    accountShort: imSystem(db, ALL_NAMES, konten.accountShort),
    accountToNames: imSystem(db, WITHOUT_ACCOUNT, konten.accountToNames),
    accountFull: imSystem(db, ADDRESS, konten.accountFull),
    profileRow: imSystem(db, ADDRESS, konten.profileRow),
    nameTaken: imSystem(db, ADDRESS, konten.nameTaken),
    changeNames: mit(db)(konten.changeNames),
    changeUsernames: imSystem(db, ACCESS, konten.changeUsernames),
    discardPendingAddress: imSystem(db, ACCESS, konten.discardPendingAddress),
    rememberEmailNew: imSystem(db, ACCESS, konten.rememberEmailNew),
    accountToEmailToken: imSystem(db, ADDRESS, konten.accountToEmailToken),
    adoptEmailNew: imSystem(db, ACCESS, konten.adoptEmailNew),
    discardEmailNew: imSystem(db, ACCESS, konten.discardEmailNew),
    nameZuEmailToken: imSystem(db, ADDRESS, konten.nameZuEmailToken),
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
    setRuecksetzTokenIfFree: imSystem(db, ACCESS, konten.setRuecksetzTokenIfFree),
    renewEmailTokenIfFree: imSystem(db, ACCESS, konten.renewEmailTokenIfFree),
    accountAfterRuecksetzToken: imSystem(db, ADDRESS, konten.accountAfterRuecksetzToken),
    resetSetPasswordAfter: imSystem(db, ACCESS, konten.resetSetPasswordAfter),
    accessesOfAccount: mit(db)(konten.accessesOfAccount),
    tokenStand: imSystem(db, 'Token-Prüfung: sucht über den Hash, ohne Konto', konten.tokenStand),
    deleteAccess: mit(db)(konten.deleteAccess),
    deleteOtherAccesses: mit(db)(konten.deleteOtherAccesses),
    deleteOtherSessions: imSystem(db, NUR_SYSTEMROLLE, konten.deleteOtherSessions),
    mussPasswortAendern: mit(db)(konten.mussPasswortAendern),
  },
  protokoll: {
    protokolliere: imSystem(db, ALL_NAMES, protokoll.protokolliere),
    lastEntries: imSystem(db, ALL_NAMES, protokoll.lastEntries),
    cleanLogOn: imSystem(db, ALL_ACCOUNTS, protokoll.cleanLogOn),
  },
});

/** Pairing, start administrator and tokens. */
const sitzungszugang = (db: Db) => ({
  qrKopplung: {
    cleanQrPairingsOn: imSystem(db, ALL_ACCOUNTS, qrKopplung.cleanQrPairingsOn),
    putQrPairingAn: imSystem(db, 'Das Gerät ohne Konto legt die Kopplung an', qrKopplung.putQrPairingAn),
    melde: imSystem(db, WITHOUT_ACCOUNT, qrKopplung.melde),
    afterPickup: imSystem(db, WITHOUT_ACCOUNT, qrKopplung.afterPickup),
    qrPairingOfAccount: mit(db)(qrKopplung.qrPairingOfAccount),
    markPickedUp: imSystem(db, WITHOUT_ACCOUNT, qrKopplung.markPickedUp),
    markConfirmed: imSystem(db, 'Die Zeile trägt das Konto erst mit der Bestätigung', qrKopplung.markConfirmed),
    countQrFailedAttempt: imSystem(db, 'wie markiereBestaetigt', qrKopplung.countQrFailedAttempt),
    markRejected: imSystem(db, 'Auch das Gerät ohne Konto lehnt ab', qrKopplung.markRejected),
  },
  uebernahmen: {
    terminateAn: imSystem(db, TAKEOVER, uebernahmen.terminateAn),
    adminOrJustBeen: imSystem(db, TAKEOVER, uebernahmen.adminOrJustBeen),
    takeDue: imSystem(db, TAKEOVER, uebernahmen.takeDue),
    abortTakeoversAb: imSystem(db, TAKEOVER, uebernahmen.abortTakeoversAb),
    targetToAbort: imSystem(db, 'Abbruch-Link: Die Anfrage trägt kein Konto', uebernahmen.targetToAbort),
    announced: imSystem(db, TAKEOVER, uebernahmen.announced),
  },
  startVerwalter: {
    accountsPresent: imSystem(db, ALL_NAMES, startVerwalter.accountsPresent),
    openStartpasswort: imSystem(db, ALL_NAMES, startVerwalter.openStartpasswort),
    putAdminAn: imSystem(db, ACCESS, startVerwalter.putAdminAn),
  },
  zugaenge: {
    validToken: imSystem(db, WITHOUT_ACCOUNT, zugaenge.validToken),
    endOverlap: imSystem(db, WITHOUT_ACCOUNT, zugaenge.endOverlap),
    touchToken: imSystem(db, WITHOUT_ACCOUNT, zugaenge.touchToken),
    putTokenAn: imSystem(db, 'Anmeldung: Die Sitzung des neuen Tokens trägt noch kein Konto', zugaenge.putTokenAn),
    lockSwapSource: mit(db)(zugaenge.lockSwapSource),
    unusedSuccessor: mit(db)(zugaenge.unusedSuccessor),
    deleteFamily: mit(db)(zugaenge.deleteFamily),
    deleteUnusedSuccessor: mit(db)(zugaenge.deleteUnusedSuccessor),
    putSuccessorAn: mit(db)(zugaenge.putSuccessorAn),
    limitTimePredecessor: mit(db)(zugaenge.limitTimePredecessor),
    lockFamily: imSystem(db, WITHOUT_ACCOUNT, zugaenge.lockFamily),
    deleteOrphanedConsumed: imSystem(db, ALL_ACCOUNTS, zugaenge.deleteOrphanedConsumed),
    loescheToken: imSystem(
      db,
      'Abmelden mit einem Token, dessen Konto die Anfrage nicht mehr trägt',
      zugaenge.loescheToken,
    ),
    deleteTokensOfAccount: imSystem(db, FOREIGN_ACCOUNT, zugaenge.deleteTokensOfAccount),
    capSessions: imSystem(db, NUR_SYSTEMROLLE, zugaenge.capSessions),
    capTokens: imSystem(db, 'Anmeldung: Die Sitzung des neuen Tokens trägt noch kein Konto', zugaenge.capTokens),
    deleteSessionsOfAccount: imSystem(db, NUR_SYSTEMROLLE, zugaenge.deleteSessionsOfAccount),
    sitzungsVersion: imSystem(db, WITHOUT_ACCOUNT, zugaenge.sitzungsVersion),
    countSessionVersionHigh: imSystem(db, ACCESS, zugaenge.countSessionVersionHigh),
    boundUnlimited: imSystem(db, ALL_ACCOUNTS, zugaenge.boundUnlimited),
    pullAltzeilenAfter: imSystem(db, ALL_ACCOUNTS, zugaenge.pullAltzeilenAfter),
    deleteExpired: imSystem(db, ALL_ACCOUNTS, zugaenge.deleteExpiredAccesses),
    deleteUnused: imSystem(db, ALL_ACCOUNTS, zugaenge.deleteUnused),
    accountToLogin: imSystem(db, NUR_SYSTEMROLLE, zugaenge.accountToLogin),
    passwortHash: imSystem(db, NUR_SYSTEMROLLE, zugaenge.passwortHash),
    replacePasswordHash: imSystem(db, NUR_SYSTEMROLLE, zugaenge.replacePasswordHash),
  },
});

export const zugang = (db: Db) => ({ ...einrichtungszugang(db), ...kontenzugang(db), ...sitzungszugang(db) });
export type AccountContext = Kontext<AccountDependencies, ReturnType<typeof zugang>>;
