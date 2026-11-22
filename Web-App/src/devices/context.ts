/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { Konfig } from '../infra/config';
import type { Clock } from '../infra/clock';
import type { Db } from '../../db/database';
import { imSystem, withValue, type Context } from '../infra/area';
import type { DevicesReadContract } from './readContract';
import type { JobsServices } from '../jobQueue';
import * as deviceKey from './repository/deviceKeys';

export interface DevicesDependencies {
  konfig: Readonly<Konfig>;
  db: Db;
  uhr: Clock;
  /** The run state holds the attestation's revocation list (catalog/revocationList.ts loads it). */
  jobQueue: JobsServices;
  lesevertrag: DevicesReadContract;
}

/** Keys and approvals are under row security; checking happens before the request carries an account. */
const WITHOUT_ACCOUNT = 'Anmeldung oder Token-Prüfung: Es gibt noch kein Konto, für das der Zeilenschutz gälte';

export const access = (db: Db, l: DevicesReadContract) => ({
  geraeteSchluessel: {
    familyOfTokens: withValue(l)(imSystem(db, WITHOUT_ACCOUNT, deviceKey.familyOfTokens)),
    keyThe: imSystem(db, WITHOUT_ACCOUNT, deviceKey.keyThe),
    entryThe: imSystem(db, WITHOUT_ACCOUNT, deviceKey.entryThe),
    putKeyAn: withValue(l)(imSystem(db, WITHOUT_ACCOUNT, deviceKey.createKey)),
    putNonceAn: withValue(l)(imSystem(db, WITHOUT_ACCOUNT, deviceKey.createNonce)),
    qrNonceThe: imSystem(db, WITHOUT_ACCOUNT, deviceKey.qrNonceThe),
    takeNonce: imSystem(db, WITHOUT_ACCOUNT, deviceKey.takeNonce),
    putChallengeAn: imSystem(db, WITHOUT_ACCOUNT, deviceKey.createChallenge),
    takeChallenge: imSystem(db, WITHOUT_ACCOUNT, deviceKey.takeChallenge),
    openRelease: imSystem(db, WITHOUT_ACCOUNT, deviceKey.openRelease),
    useRelease: imSystem(db, WITHOUT_ACCOUNT, deviceKey.useRelease),
  },
});
export type DevicesContext = Context<DevicesDependencies, ReturnType<typeof access>>;
