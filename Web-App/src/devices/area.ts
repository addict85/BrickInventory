/** Die Fabrik des Bereichs: Dienste als Closure über k (buildArea, src/infra/area.ts). */
import type { Db } from '../../db/database';
import { mit, buildArea, type Inspect } from '../infra/area';
import * as geraeteChallenge from './deviceChallenge';
import { zugang, type DevicesDependencies, type DevicesContext } from './context';

export type { DevicesDependencies, DevicesContext } from './context';

export function createDevices(a: DevicesDependencies, inspect?: Inspect<DevicesContext>) {
  return buildArea(
    a,
    (db: Db) => zugang(db, a.lesevertrag),
    (k: DevicesContext) => ({
      newNonce: mit(k)(geraeteChallenge.newNonce),
      depositKey: mit(k)(geraeteChallenge.depositKey),
      newChallenge: mit(k)(geraeteChallenge.newChallenge),
      resolveOne: mit(k)(geraeteChallenge.resolveOne),
      pruefeFreigabe: mit(k)(geraeteChallenge.pruefeFreigabe),
      nonceForQrToken: mit(k)(geraeteChallenge.nonceForQrToken),
    }),
    inspect,
  );
}

export type DevicesServices = ReturnType<typeof createDevices>;
