/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { withValue, buildArea, type Inspect } from '../infra/area';
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
      isActive: withValue(k)(secondFactor.isActive),
      activeAmong: withValue(k)(secondFactor.activeAmong),
      status: withValue(k)(secondFactor.status),
      beginSetup: withValue(k)(secondFactor.beginSetup),
      confirmSetup: withValue(k)(secondFactor.confirmSetup),
      otpauthFor: withValue(k)(secondFactor.otpauthFor),
      checkCode: withValue(k)(secondFactor.checkCode),
      disable: withValue(k)(secondFactor.disable),
      renewCodes: withValue(k)(secondFactor.renewCodes),
      registrationOptions: withValue(k)(passkeys.registrationOptions),
      verifyRegistration: withValue(k)(passkeys.verifyRegistration),
      authenticationOptions: withValue(k)(passkeys.authenticationOptions),
      verifyAuthentication: withValue(k)(passkeys.verifyAuthentication),
      accountPasskeys: withValue(k)(passkeys.accountPasskeys),
      hasPasskeys: withValue(k)(passkeys.hasPasskeys),
      deletePasskey: withValue(k)(passkeys.deletePasskey),
      revokePasskeys: withValue(k)(passkeys.revokePasskeys),
      encryptLegacySecrets: withValue(k)(legacySecrets.encryptLegacySecrets),
    }),
    inspect,
  );
}

export type FactorsServices = ReturnType<typeof createFactors>;
