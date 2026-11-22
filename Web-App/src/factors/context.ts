/** What the services get; kept apart from area.ts so no import cycle forms. */
import type { AppConfig } from '../infra/config';
import type { Db } from '../../db/database';
import type { Clock } from '../infra/clock';
import { imSystem, bound, type Context } from '../infra/area';
import type { SettingsServices } from '../settings';
import * as legacySecrets from './repository/legacySecrets';
import * as passkeys from './repository/passkeys';
import * as secondFactor from './repository/secondFactor';

export interface FactorsDependencies {
  clock: Clock;
  config: Readonly<AppConfig>;
  db: Db;
  settings: SettingsServices;
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
    accountCredentialIds: bound(db)(passkeys.accountCredentialIds),
    createCredential: bound(db)(passkeys.createCredential),
    byCredentialId: imSystem(db, 'Login with a passkey: the account only follows from it', passkeys.byCredentialId),
    advanceCounter: imSystem(db, NO_ACCOUNT, passkeys.advanceCounter),
    passkeysForAccount: bound(db)(passkeys.passkeysForAccount),
    hasAny: imSystem(db, BEFORE_LOGIN, passkeys.hasAny),
    deleteAllForAccount: imSystem(db, FOREIGN_ACCOUNT, passkeys.deleteAllForAccount),
    deletePasskeyRow: bound(db)(passkeys.deletePasskeyRow),
  },
  secondFactor: {
    replaceCodes: bound(db)(secondFactor.replaceCodes),
    isActive: imSystem(db, BEFORE_LOGIN, secondFactor.readActive),
    withActiveFactor: imSystem(db, 'Admin: reads the second factor of every account', secondFactor.withActiveFactor),
    factorStatus: bound(db)(secondFactor.factorStatus),
    createSecret: bound(db)(secondFactor.createSecret),
    lockUnconfirmedSecret: bound(db)(secondFactor.lockUnconfirmedSecret),
    activate: bound(db)(secondFactor.activate),
    activeSecret: imSystem(db, CODE_BEFORE_LOGIN, secondFactor.activeSecret),
    consumeStep: imSystem(db, CODE_BEFORE_LOGIN, secondFactor.consumeStep),
    consumeCode: imSystem(db, CODE_BEFORE_LOGIN, secondFactor.consumeCode),
    markCodesCurrent: imSystem(db, CODE_BEFORE_LOGIN, secondFactor.markCodesCurrent),
    remove: imSystem(db, FOREIGN_ACCOUNT, secondFactor.remove),
  },
});
export type FactorsContext = Context<FactorsDependencies, ReturnType<typeof access>>;
