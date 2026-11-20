/** Die Fabrik des Bereichs: Dienste als Closure über k (buildArea, src/infra/bereich.ts). */
import { mit, buildArea, type Inspect } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as anmeldepruefung from './anmeldepruefung';
import * as anmeldungAblauf from './anmeldungAblauf';
import * as geraeteToken from './geraeteToken';
import { accountJobTypes } from './auftragsarten';
import * as kontoHinweis from './kontoHinweis';
import * as nebenlaeufe from './nebenlaeufe';
import * as profilAendern from './profilAendern';
import * as loginLimiter from './loginLimiter';
import * as registrierungAblauf from './registrierungAblauf';
import * as tokenWunsch from './tokenWunsch';
import * as verwalterAktionen from './verwalterAktionen';
import * as verwalterProtokoll from './verwalterProtokoll';
import * as zugangsende from './zugangsende';
import * as zielDrossel from './zielDrossel';
import * as passwortBestaetigung from './passwortBestaetigung';
import * as sitzungsVersion from './sitzungsVersion';
import * as accessesService from './zugaenge';
import * as startAdminService from './startVerwalter';
import * as qrPairingService from './qrKopplung';
import * as accountsService from './konten';
import type { DevicesServices } from '../geraete';
import { zugang, type AccountDependencies, type AccountContext } from './kontext';

export type { AccountDependencies, AccountContext } from './kontext';

export function createAccount(a: Omit<AccountDependencies, 'faecher'>, inspect?: Inspect<AccountContext>) {
  return buildArea(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: AccountContext) => ({
      ...loginAndDevices(k),
      ...konten(k),
      verwalter: verwaltung(k),
      sitzungen: sitzungen(k),
    }),
    inspect,
  );
}

/** Anmeldung, Geräte und Token. */
function loginAndDevices(k: AccountContext) {
  return {
    verifyEmailToken: mit(k)(anmeldepruefung.verifyEmailToken),
    checkCredentials: mit(k)(anmeldepruefung.checkCredentials),
    eigenesPasswortAendern: mit(k)(anmeldungAblauf.eigenesPasswortAendern),
    loginResponse: mit(k)(anmeldungAblauf.loginResponse),
    devicesTokenIssue: mit(k)(anmeldungAblauf.devicesTokenIssue),
    createQrAccess: mit(k)(anmeldungAblauf.createQrAccess),
    // Der Schrittschutz (http/schrittschutz.ts) fragt das Konto, ob die Anfrage darf; die Regel steht in geraete.
    pruefeFreigabe: (...a: Parameters<DevicesServices['pruefeFreigabe']>) => k.geraete.pruefeFreigabe(...a),
    pruefeToken: mit(k)(geraeteToken.pruefeToken),
    rotateToken: mit(k)(geraeteToken.rotateToken),
    tokenLoeschen: mit(k)(geraeteToken.tokenLoeschen),
    nutzerZumToken: mit(k)(geraeteToken.nutzerZumToken),
    tokenGilt: mit(k)(geraeteToken.tokenGilt),
  };
}

/** Konten, Zugänge, Verwaltung und Einstellungen des Kontos. */
function konten(k: AccountContext) {
  return {
    onRaeumSteps: mit(k)(nebenlaeufe.onRaeumSteps),
    adressHints: mit(k)(nebenlaeufe.adressHints),
    accountsList: mit(k)(accountsService.accountsList),
    profil: mit(k)(accountsService.profil),
    profilAendern: mit(k)(profilAendern.profilAendern),
    accountShortOf: mit(k)(accountsService.accountShortOf),
    accountFullOf: mit(k)(accountsService.accountFullOf),
    givesAccount: mit(k)(accountsService.givesAccount),
    passwordSwitchDue: mit(k)(accountsService.passwordSwitchDue),
    accountConfigured: mit(k)(accountsService.accountConfigured),
    openFactorRequired: mit(k)(accountsService.openFactorRequired),
    setPasswordPerLink: mit(k)(accountsService.setPasswordPerLink),
    putAccountAn: mit(k)(accountsService.putAccountAn),
    kontoEntfernen: mit(k)(verwalterAktionen.accountRemoveBy),
    auftragsarten: accountJobTypes,
    adminHintInBackground: mit(k)(kontoHinweis.adminHintInBackground),
    hintInBackground: mit(k)(kontoHinweis.hintInBackground),
    joinHousehold: mit(k)(kontoHinweis.joinHousehold),
    countRequest: mit(k)(loginLimiter.countRequest),
    redeemMailLink: mit(k)(verwalterAktionen.redeemMailLink),
    reportDevice: mit(k)(qrPairingService.reportDevice),
    holeQrTokenAb: mit(k)(qrPairingService.holeQrTokenAb),
    discardPickup: mit(k)(qrPairingService.discardPickup),
    kopplungsStand: mit(k)(qrPairingService.kopplungsStand),
    confirmPairing: mit(k)(qrPairingService.confirmPairing),
    rejectPairingAb: mit(k)(qrPairingService.rejectPairingAb),
    tryRegistration: mit(k)(registrierungAblauf.tryRegistration),
    confirmationAgainRequest: mit(k)(registrierungAblauf.confirmationAgainRequest),
    ruecksetzLinkRequest: mit(k)(registrierungAblauf.ruecksetzLinkRequest),
    nameToConfirmation: mit(k)(registrierungAblauf.nameToConfirmation),
    accountToRuecksetzLink: mit(k)(registrierungAblauf.accountToRuecksetzLink),
    putStartAdminAn: mit(k)(startAdminService.putStartAdminAn),
    listenOnRevocation: mit(k)(zugangsende.listenOnRevocation),
    tokenDetails: mit(k)(tokenWunsch.tokenDetails),
    targetThrottled: mit(k)(zielDrossel.targetThrottled),
    accountThrottled: mit(k)(zielDrossel.accountThrottled),
    confirmSetupThrottled: mit(k)(passwortBestaetigung.confirmSetupThrottled),
    checkConfirmation: mit(k)(passwortBestaetigung.checkConfirmation),
    checkCodeConfirmation: mit(k)(passwortBestaetigung.checkCodeConfirmation),
  };
}

/** Sitzungen und App-Zugänge des eigenen Kontos. */
function sitzungen(k: AccountContext) {
  return {
    accessesList: mit(k)(accessesService.accessesList),
    endAccess: mit(k)(accessesService.endAccess),
    endOther: mit(k)(zugangsende.endOther),
    limit: mit(k)(zugangsende.limitSessions),
    versionFromDb: mit(k)(sitzungsVersion.sessionVersionFromDb),
    currentVersion: mit(k)(sitzungsVersion.currentSessionVersion),
  };
}

/** Verwalter an fremden Konten: Änderungen, Übernahmen und ihr Protokoll. */
function verwaltung(k: AccountContext) {
  return {
    unlockRegistration: mit(k)(verwalterAktionen.unlockRegistration),
    aktivSetzen: mit(k)(verwalterAktionen.aktivSetzen),
    verwalterRolleSetzen: mit(k)(verwalterAktionen.verwalterRolleSetzen),
    passwordByAdmin: mit(k)(verwalterAktionen.passwordByAdmin),
    factorByAdmin: mit(k)(verwalterAktionen.factorByAdmin),
    cancelTakeovers: mit(k)(verwalterAktionen.cancelTakeovers),
    rememberAdminAction: mit(k)(verwalterProtokoll.rememberAdminAction),
    managementLog: mit(k)(verwalterProtokoll.managementLog),
  };
}

export type AccountServices = ReturnType<typeof createAccount>;
