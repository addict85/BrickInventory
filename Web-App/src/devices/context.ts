/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { AppConfig } from '../infra/config';
import type { Clock } from '../infra/clock';
import type { Db } from '../../db/database';
import { asSystem, bound, type Context } from '../infra/area';
import type { DevicesReadContract } from './readContract';
import type { JobsServices } from '../jobQueue';
import * as deviceKey from './repository/deviceKeys';

export interface DevicesDependencies {
  config: Readonly<AppConfig>;
  db: Db;
  clock: Clock;
  /** The run state holds the attestation's revocation list (catalog/revocationList.ts loads it). */
  jobQueue: JobsServices;
  readContract: DevicesReadContract;
}

/** Keys and approvals are under row security; checking happens before the request carries an account. */
const WITHOUT_ACCOUNT = 'Anmeldung oder Token-Prüfung: Es gibt noch kein Konto, für das der Zeilenschutz gälte';

export const access = (db: Db, l: DevicesReadContract) => ({
  deviceKeys: {
    familyOfTokens: bound(l)(asSystem(db, WITHOUT_ACCOUNT, deviceKey.familyOfTokens)),
    keyThe: asSystem(db, WITHOUT_ACCOUNT, deviceKey.keyThe),
    entryThe: asSystem(db, WITHOUT_ACCOUNT, deviceKey.entryThe),
    createKey: bound(l)(asSystem(db, WITHOUT_ACCOUNT, deviceKey.createKey)),
    createNonce: bound(l)(asSystem(db, WITHOUT_ACCOUNT, deviceKey.createNonce)),
    qrNonceThe: asSystem(db, WITHOUT_ACCOUNT, deviceKey.qrNonceThe),
    takeNonce: asSystem(db, WITHOUT_ACCOUNT, deviceKey.takeNonce),
    createChallenge: asSystem(db, WITHOUT_ACCOUNT, deviceKey.createChallenge),
    takeChallenge: asSystem(db, WITHOUT_ACCOUNT, deviceKey.takeChallenge),
    openRelease: asSystem(db, WITHOUT_ACCOUNT, deviceKey.openRelease),
    useRelease: asSystem(db, WITHOUT_ACCOUNT, deviceKey.useRelease),
  },
});
export type DevicesContext = Context<DevicesDependencies, ReturnType<typeof access>>;
