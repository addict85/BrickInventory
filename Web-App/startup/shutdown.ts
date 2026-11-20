/** What ends on shutdown before the pool closes, the same for web and
 * job role: buffers in memory still need a connection for writing.
 * The log last, so that it still writes the messages before it. */
import type { Db } from '../db/database';
import type { Dienste } from './wiring';
import { stopLog } from '../src/infra/log';
import { logAndContinue } from '../src/infra/error';

export async function closeBufferAndTicks(zugang: Db, d: Dienste): Promise<void> {
  // Both catch their write errors themselves.
  await d.images.stopImageDemand();
  await d.images.stopNone();
  await zugang.notification.close().catch(logAndContinue('server:close'));
  await stopLog();
}
