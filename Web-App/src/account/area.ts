/** The area's factory: services as closures over k (buildArea, src/infra/area.ts). */
import { bound, buildArea, type Inspect } from '../infra/area';
import { Compartments } from '../infra/cache';
import * as loginCheck from './loginCheck';
import * as loginFlow from './loginFlow';
import * as deviceToken from './deviceToken';
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
    { ...a, faecher: new Compartments() },
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
    verifyEmailToken: bound(k)(loginCheck.verifyEmailToken),
    checkCredentials: bound(k)(loginCheck.checkCredentials),
    changeOwnPassword: bound(k)(loginFlow.changeOwnPassword),
    loginResponse: bound(k)(loginFlow.loginResponse),
    devicesTokenIssue: bound(k)(loginFlow.devicesTokenIssue),
    createQrAccess: bound(k)(loginFlow.createQrAccess),
    // The step guard (http/stepGuard.ts) asks the account whether the request may proceed; the rule lives in devices.
    checkApproval: (...a: Parameters<DevicesServices['checkApproval']>) => k.devices.checkApproval(...a),
    checkToken: bound(k)(deviceToken.checkToken),
    rotateToken: bound(k)(deviceToken.rotateToken),
    deleteToken: bound(k)(deviceToken.deleteToken),
    userForToken: bound(k)(deviceToken.userForToken),
    tokenGilt: bound(k)(deviceToken.tokenGilt),
  };
}

/** Accounts, accesses, administration and settings of the account. */
function konten(k: AccountContext) {
  return {
    onCleanupSteps: bound(k)(sideRuns.onCleanupSteps),
    addressHints: bound(k)(sideRuns.addressHints),
    accountsList: bound(k)(accountsService.accountsList),
    profile: bound(k)(accountsService.profile),
    changeProfile: bound(k)(changeProfile.changeProfile),
    accountShortOf: bound(k)(accountsService.accountShortOf),
    accountFullOf: bound(k)(accountsService.accountFullOf),
    givesAccount: bound(k)(accountsService.givesAccount),
    passwordSwitchDue: bound(k)(accountsService.passwordSwitchDue),
    accountConfigured: bound(k)(accountsService.accountConfigured),
    openFactorRequired: bound(k)(accountsService.openFactorRequired),
    setPasswordPerLink: bound(k)(accountsService.setPasswordPerLink),
    addAccount: bound(k)(accountsService.addAccount),
    removeAccount: bound(k)(adminActions.accountRemoveBy),
    jobKinds: accountJobTypes,
    adminHintInBackground: bound(k)(accountNotice.adminHintInBackground),
    hintInBackground: bound(k)(accountNotice.hintInBackground),
    joinHousehold: bound(k)(accountNotice.joinHousehold),
    countRequest: bound(k)(loginLimiter.countRequest),
    redeemMailLink: bound(k)(adminActions.redeemMailLink),
    reportDevice: bound(k)(qrPairingService.reportDevice),
    fetchQrToken: bound(k)(qrPairingService.fetchQrToken),
    discardPickup: bound(k)(qrPairingService.discardPickup),
    pairingState: bound(k)(qrPairingService.pairingState),
    confirmPairing: bound(k)(qrPairingService.confirmPairing),
    rejectPairing: bound(k)(qrPairingService.rejectPairing),
    tryRegistration: bound(k)(registrationFlow.tryRegistration),
    confirmationAgainRequest: bound(k)(registrationFlow.confirmationAgainRequest),
    resetLinkRequest: bound(k)(registrationFlow.resetLinkRequest),
    nameToConfirmation: bound(k)(registrationFlow.nameToConfirmation),
    accountToResetLink: bound(k)(registrationFlow.accountToResetLink),
    createStartAdmin: bound(k)(startAdminService.createStartAdmin),
    listenOnRevocation: bound(k)(accessEnd.listenOnRevocation),
    tokenDetails: bound(k)(tokenRequest.tokenDetails),
    targetThrottled: bound(k)(targetThrottle.targetThrottled),
    accountThrottled: bound(k)(targetThrottle.accountThrottled),
    confirmSetupThrottled: bound(k)(passwordConfirmation.confirmSetupThrottled),
    checkConfirmation: bound(k)(passwordConfirmation.checkConfirmation),
    checkCodeConfirmation: bound(k)(passwordConfirmation.checkCodeConfirmation),
  };
}

/** Sessions and app accesses of the own account. */
function sessions(k: AccountContext) {
  return {
    accessesList: bound(k)(accessesService.accessesList),
    endAccess: bound(k)(accessesService.endAccess),
    endOther: bound(k)(accessEnd.endOther),
    limit: bound(k)(accessEnd.limitSessions),
    versionFromDb: bound(k)(sessionVersion.sessionVersionFromDb),
    currentVersion: bound(k)(sessionVersion.currentSessionVersion),
  };
}

/** Administrators on foreign accounts: changes, takeovers and their log. */
function management(k: AccountContext) {
  return {
    unlockRegistration: bound(k)(adminActions.unlockRegistration),
    setActive: bound(k)(adminActions.aktivSetzen),
    setAdminRole: bound(k)(adminActions.verwalterRolleSetzen),
    passwordByAdmin: bound(k)(adminActions.passwordByAdmin),
    factorByAdmin: bound(k)(adminActions.factorByAdmin),
    cancelTakeovers: bound(k)(adminActions.cancelTakeovers),
    rememberAdminAction: bound(k)(adminLog.rememberAdminAction),
    managementLog: bound(k)(adminLog.managementLog),
  };
}

export type AccountServices = ReturnType<typeof createAccount>;
