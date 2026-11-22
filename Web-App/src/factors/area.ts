/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { bound, buildArea, type Inspect } from '../infra/area';
import * as legacySecrets from './legacySecrets';
import * as passkeys from './passkeys';
import * as secondFactor from './secondFactor';
import { access, type FactorsDependencies, type FactorsContext } from './context';

export type { FactorsDependencies, FactorsContext } from './context';

/** Second factor and passkeys: their own tables, no account. When they apply is the account's call. */
export function createFactors(a: FactorsDependencies, inspect?: Inspect<FactorsContext>) {
  return buildArea(
    a,
    access,
    (k: FactorsContext) => ({
      isActive: bound(k)(secondFactor.isActive),
      activeAmong: bound(k)(secondFactor.activeAmong),
      status: bound(k)(secondFactor.status),
      beginSetup: bound(k)(secondFactor.beginSetup),
      confirmSetup: bound(k)(secondFactor.confirmSetup),
      otpauthFor: bound(k)(secondFactor.otpauthFor),
      checkCode: bound(k)(secondFactor.checkCode),
      disable: bound(k)(secondFactor.disable),
      renewCodes: bound(k)(secondFactor.renewCodes),
      registrationOptions: bound(k)(passkeys.registrationOptions),
      verifyRegistration: bound(k)(passkeys.verifyRegistration),
      authenticationOptions: bound(k)(passkeys.authenticationOptions),
      verifyAuthentication: bound(k)(passkeys.verifyAuthentication),
      accountPasskeys: bound(k)(passkeys.accountPasskeys),
      hasPasskeys: bound(k)(passkeys.hasPasskeys),
      deletePasskey: bound(k)(passkeys.deletePasskey),
      revokePasskeys: bound(k)(passkeys.revokePasskeys),
      encryptLegacySecrets: bound(k)(legacySecrets.encryptLegacySecrets),
    }),
    inspect,
  );
}

export type FactorsServices = ReturnType<typeof createFactors>;
