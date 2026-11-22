/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { Db } from '../../db/database';
import { withValue, buildArea, type Inspect } from '../infra/area';
import * as deviceChallenge from './deviceChallenge';
import { access, type DevicesDependencies, type DevicesContext } from './context';

export type { DevicesDependencies, DevicesContext } from './context';

export function createDevices(a: DevicesDependencies, inspect?: Inspect<DevicesContext>) {
  return buildArea(
    a,
    (db: Db) => access(db, a.lesevertrag),
    (k: DevicesContext) => ({
      newNonce: withValue(k)(deviceChallenge.newNonce),
      depositKey: withValue(k)(deviceChallenge.depositKey),
      newChallenge: withValue(k)(deviceChallenge.newChallenge),
      resolveOne: withValue(k)(deviceChallenge.resolveOne),
      pruefeFreigabe: withValue(k)(deviceChallenge.checkApproval),
      nonceForQrToken: withValue(k)(deviceChallenge.nonceForQrToken),
    }),
    inspect,
  );
}

export type DevicesServices = ReturnType<typeof createDevices>;
