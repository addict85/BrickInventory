/** What the services get; kept apart from area.ts so no import cycle forms. */
import type { Konfig } from '../infra/config';
import type { Db } from '../../db/database';
import type { Clock } from '../infra/clock';
import { imSystem, withValue, type Context } from '../infra/area';
import type { SettingsServices } from '../settings';
import * as legacySecrets from './repository/legacySecrets';
import * as passkeys from './repository/passkeys';
import * as secondFactor from './repository/secondFactor';

export interface FactorsDependencies {
  uhr: Clock;
  konfig: Readonly<Konfig>;
  db: Db;
  einstellungen: SettingsServices;
}

/** Row guard (0112): only a caller checking before login, or against a foreign account, gets the system frame. */
const NO_ACCOUNT = 'Login or token check: there is no account yet for the row guard to apply to';
const FOREIGN_ACCOUNT = 'Admin or forgot-password: changes an account the request does not carry';
const BEFORE_LOGIN = 'Login check: asks before the account is logged in';
const CODE_BEFORE_LOGIN = 'Login: checks the code before the account is logged in';
const REENCRYPT_ON_START = 'Start: re-encrypts every account’s secrets';

export const access = (db: Db) => ({
  legacySecrets: {
    legacyFactorSecrets: imSystem(db, REENCRYPT_ON_START, legacySecrets.legacyFactorSecrets),
    replaceFactorSecret: imSystem(db, REENCRYPT_ON_START, legacySecrets.replaceFactorSecret),
  },
  passkeys: {
    storeChallenge: imSystem(
      db,
      'Login options without an account; the upper limit counts every open one',
      passkeys.storeChallenge,
    ),
    consumeChallenge: imSystem(db, NO_ACCOUNT, passkeys.consumeChallenge),
    markConsumed: imSystem(db, NO_ACCOUNT, passkeys.markConsumed),
    accountCredentialIds: withValue(db)(passkeys.accountCredentialIds),
    createCredential: withValue(db)(passkeys.createCredential),
    byCredentialId: imSystem(db, 'Login with a passkey: the account only follows from it', passkeys.byCredentialId),
    advanceCounter: imSystem(db, NO_ACCOUNT, passkeys.advanceCounter),
    passkeysForAccount: withValue(db)(passkeys.passkeysForAccount),
    hasAny: imSystem(db, BEFORE_LOGIN, passkeys.hasAny),
    deleteAllForAccount: imSystem(db, FOREIGN_ACCOUNT, passkeys.deleteAllForAccount),
    deletePasskeyRow: withValue(db)(passkeys.deletePasskeyRow),
  },
  secondFactor: {
    replaceCodes: withValue(db)(secondFactor.replaceCodes),
    isActive: imSystem(db, BEFORE_LOGIN, secondFactor.readActive),
    withActiveFactor: imSystem(db, 'Admin: reads the second factor of every account', secondFactor.withActiveFactor),
    factorStatus: withValue(db)(secondFactor.factorStatus),
    createSecret: withValue(db)(secondFactor.createSecret),
    lockUnconfirmedSecret: withValue(db)(secondFactor.lockUnconfirmedSecret),
    activate: withValue(db)(secondFactor.activate),
    activeSecret: imSystem(db, CODE_BEFORE_LOGIN, secondFactor.activeSecret),
    consumeStep: imSystem(db, CODE_BEFORE_LOGIN, secondFactor.consumeStep),
    consumeCode: imSystem(db, CODE_BEFORE_LOGIN, secondFactor.consumeCode),
    markCodesCurrent: imSystem(db, CODE_BEFORE_LOGIN, secondFactor.markCodesCurrent),
    remove: imSystem(db, FOREIGN_ACCOUNT, secondFactor.remove),
  },
});
export type FactorsContext = Context<FactorsDependencies, ReturnType<typeof access>>;
