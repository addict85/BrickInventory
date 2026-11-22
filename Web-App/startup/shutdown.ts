/** What ends on shutdown before the pool closes, the same for web and
 * job role: buffers in memory still need a connection for writing.
 * The log last, so that it still writes the messages before it. */
import type { Db } from '../db/database';
import type { Services } from './wiring';
import { stopLog } from '../src/infra/log';
import { logAndContinue } from '../src/infra/error';

export async function closeBufferAndTicks(access: Db, d: Services): Promise<void> {
  // Both catch their write errors themselves.
  await d.images.stopImageDemand();
  await d.images.stopNone();
  await access.notification.close().catch(logAndContinue('server:close'));
  await stopLog();
}
