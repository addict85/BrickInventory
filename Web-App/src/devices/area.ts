/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { Db } from '../../db/database';
import { bound, buildArea, type Inspect } from '../infra/area';
import * as deviceChallenge from './deviceChallenge';
import { access, type DevicesDependencies, type DevicesContext } from './context';

export type { DevicesDependencies, DevicesContext } from './context';

export function createDevices(a: DevicesDependencies, inspect?: Inspect<DevicesContext>) {
  return buildArea(
    a,
    (db: Db) => access(db, a.lesevertrag),
    (k: DevicesContext) => ({
      newNonce: bound(k)(deviceChallenge.newNonce),
      depositKey: bound(k)(deviceChallenge.depositKey),
      newChallenge: bound(k)(deviceChallenge.newChallenge),
      resolveOne: bound(k)(deviceChallenge.resolveOne),
      checkApproval: bound(k)(deviceChallenge.checkApproval),
      nonceForQrToken: bound(k)(deviceChallenge.nonceForQrToken),
    }),
    inspect,
  );
}

export type DevicesServices = ReturnType<typeof createDevices>;
