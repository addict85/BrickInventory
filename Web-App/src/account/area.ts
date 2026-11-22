/** The area's factory: services as closures over k (buildArea, src/infra/area.ts). */
import { withValue, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
import * as loginCheck from './loginCheck';
import * as loginFlow from './loginFlow';
import * as geraeteToken from './deviceToken';
import { accountJobTypes } from './jobTypes';
import * as accountNotice from './accountNotice';
import * as sideRuns from './sideRuns';
import * as changeProfile from './changeProfile';
import * as loginLimiter from './loginLimiter';
import * as registrationFlow from './registrationFlow';
import * as tokenRequest from './tokenRequest';
import * as adminActions from './adminActions';
import * as adminLog from './adminLog';
import * as accessEnd from './accessEnd';
import * as targetThrottle from './targetThrottle';
import * as passwordConfirmation from './passwordConfirmation';
import * as sessionVersion from './sessionVersion';
import * as accessesService from './accesses';
import * as startAdminService from './startAdmin';
import * as qrPairingService from './qrPairing';
import * as accountsService from './accounts';
import type { DevicesServices } from '../devices';
import { access, type AccountDependencies, type AccountContext } from './context';

export type { AccountDependencies, AccountContext } from './context';

export function createAccount(a: Omit<AccountDependencies, 'faecher'>, inspect?: Inspect<AccountContext>) {
  return buildArea(
    { ...a, faecher: new Faecher() },
    access,
    (k: AccountContext) => ({
      ...loginAndDevices(k),
      ...konten(k),
      verwalter: management(k),
      sitzungen: sessions(k),
    }),
    inspect,
  );
}

/** Login, devices and tokens. */
function loginAndDevices(k: AccountContext) {
  return {
    verifyEmailToken: withValue(k)(loginCheck.verifyEmailToken),
    checkCredentials: withValue(k)(loginCheck.checkCredentials),
    eigenesPasswortAendern: withValue(k)(loginFlow.changeOwnPassword),
    loginResponse: withValue(k)(loginFlow.loginResponse),
    devicesTokenIssue: withValue(k)(loginFlow.devicesTokenIssue),
    createQrAccess: withValue(k)(loginFlow.createQrAccess),
    // The step guard (http/stepGuard.ts) asks the account whether the request may proceed; the rule lives in devices.
    pruefeFreigabe: (...a: Parameters<DevicesServices['pruefeFreigabe']>) => k.devices.pruefeFreigabe(...a),
    pruefeToken: withValue(k)(geraeteToken.pruefeToken),
    rotateToken: withValue(k)(geraeteToken.rotateToken),
    tokenLoeschen: withValue(k)(geraeteToken.deleteToken),
    nutzerZumToken: withValue(k)(geraeteToken.nutzerZumToken),
    tokenGilt: withValue(k)(geraeteToken.tokenGilt),
  };
}

/** Accounts, accesses, administration and settings of the account. */
function konten(k: AccountContext) {
  return {
    onRaeumSteps: withValue(k)(sideRuns.onCleanupSteps),
    adressHints: withValue(k)(sideRuns.addressHints),
    accountsList: withValue(k)(accountsService.accountsList),
    profil: withValue(k)(accountsService.profile),
    profilAendern: withValue(k)(changeProfile.changeProfile),
    accountShortOf: withValue(k)(accountsService.accountShortOf),
    accountFullOf: withValue(k)(accountsService.accountFullOf),
    givesAccount: withValue(k)(accountsService.givesAccount),
    passwordSwitchDue: withValue(k)(accountsService.passwordSwitchDue),
    accountConfigured: withValue(k)(accountsService.accountConfigured),
    openFactorRequired: withValue(k)(accountsService.openFactorRequired),
    setPasswordPerLink: withValue(k)(accountsService.setPasswordPerLink),
    putAccountAn: withValue(k)(accountsService.createAccount),
    kontoEntfernen: withValue(k)(adminActions.accountRemoveBy),
    auftragsarten: accountJobTypes,
    adminHintInBackground: withValue(k)(accountNotice.adminHintInBackground),
    hintInBackground: withValue(k)(accountNotice.hintInBackground),
    joinHousehold: withValue(k)(accountNotice.joinHousehold),
    countRequest: withValue(k)(loginLimiter.countRequest),
    redeemMailLink: withValue(k)(adminActions.redeemMailLink),
    reportDevice: withValue(k)(qrPairingService.reportDevice),
    holeQrTokenAb: withValue(k)(qrPairingService.fetchQrToken),
    discardPickup: withValue(k)(qrPairingService.discardPickup),
    kopplungsStand: withValue(k)(qrPairingService.pairingState),
    confirmPairing: withValue(k)(qrPairingService.confirmPairing),
    rejectPairingAb: withValue(k)(qrPairingService.rejectPairing),
    tryRegistration: withValue(k)(registrationFlow.tryRegistration),
    confirmationAgainRequest: withValue(k)(registrationFlow.confirmationAgainRequest),
    ruecksetzLinkRequest: withValue(k)(registrationFlow.resetLinkRequest),
    nameToConfirmation: withValue(k)(registrationFlow.nameToConfirmation),
    accountToRuecksetzLink: withValue(k)(registrationFlow.accountToResetLink),
    putStartAdminAn: withValue(k)(startAdminService.createStartAdmin),
    listenOnRevocation: withValue(k)(accessEnd.listenOnRevocation),
    tokenDetails: withValue(k)(tokenRequest.tokenDetails),
    targetThrottled: withValue(k)(targetThrottle.targetThrottled),
    accountThrottled: withValue(k)(targetThrottle.accountThrottled),
    confirmSetupThrottled: withValue(k)(passwordConfirmation.confirmSetupThrottled),
    checkConfirmation: withValue(k)(passwordConfirmation.checkConfirmation),
    checkCodeConfirmation: withValue(k)(passwordConfirmation.checkCodeConfirmation),
  };
}

/** Sessions and app accesses of the own account. */
function sessions(k: AccountContext) {
  return {
    accessesList: withValue(k)(accessesService.accessesList),
    endAccess: withValue(k)(accessesService.endAccess),
    endOther: withValue(k)(accessEnd.endOther),
    limit: withValue(k)(accessEnd.limitSessions),
    versionFromDb: withValue(k)(sessionVersion.sessionVersionFromDb),
    currentVersion: withValue(k)(sessionVersion.currentSessionVersion),
  };
}

/** Administrators on foreign accounts: changes, takeovers and their log. */
function management(k: AccountContext) {
  return {
    unlockRegistration: withValue(k)(adminActions.unlockRegistration),
    aktivSetzen: withValue(k)(adminActions.aktivSetzen),
    verwalterRolleSetzen: withValue(k)(adminActions.verwalterRolleSetzen),
    passwordByAdmin: withValue(k)(adminActions.passwordByAdmin),
    factorByAdmin: withValue(k)(adminActions.factorByAdmin),
    cancelTakeovers: withValue(k)(adminActions.cancelTakeovers),
    rememberAdminAction: withValue(k)(adminLog.rememberAdminAction),
    managementLog: withValue(k)(adminLog.managementLog),
  };
}

export type AccountServices = ReturnType<typeof createAccount>;
