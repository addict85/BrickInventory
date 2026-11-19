/** The area's factory: services as a closure over k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as legacySecrets from './legacySecrets';
import * as passkeys from './passkeys';
import * as secondFactor from './secondFactor';
import { access, type FactorsDependencies, type FactorsContext } from './context';

export type { FactorsDependencies, FactorsContext } from './context';

/** Second factor and passkeys: their own tables, no account. When they apply is the account's call. */
export function createFactors(a: FactorsDependencies, einblick?: Einblick<FactorsContext>) {
  return baueBereich(
    a,
    access,
    (k: FactorsContext) => ({
      isActive: mit(k)(secondFactor.isActive),
      activeAmong: mit(k)(secondFactor.activeAmong),
      status: mit(k)(secondFactor.status),
      beginSetup: mit(k)(secondFactor.beginSetup),
      confirmSetup: mit(k)(secondFactor.confirmSetup),
      otpauthFor: mit(k)(secondFactor.otpauthFor),
      checkCode: mit(k)(secondFactor.checkCode),
      disable: mit(k)(secondFactor.disable),
      renewCodes: mit(k)(secondFactor.renewCodes),
      registrationOptions: mit(k)(passkeys.registrationOptions),
      verifyRegistration: mit(k)(passkeys.verifyRegistration),
      authenticationOptions: mit(k)(passkeys.authenticationOptions),
      verifyAuthentication: mit(k)(passkeys.verifyAuthentication),
      accountPasskeys: mit(k)(passkeys.accountPasskeys),
      hasPasskeys: mit(k)(passkeys.hasPasskeys),
      deletePasskey: mit(k)(passkeys.deletePasskey),
      revokePasskeys: mit(k)(passkeys.revokePasskeys),
      encryptLegacySecrets: mit(k)(legacySecrets.encryptLegacySecrets),
    }),
    einblick,
  );
}

export type FactorsServices = ReturnType<typeof createFactors>;
