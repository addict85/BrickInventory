import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import * as repo from './repository/jobs';
import { reportError } from '../infra/error';
import type { JobsContext } from './context';

/** Every claim carries its process's identifier. A process that ends hard
 * (memory, power failure) returns nothing; its lock, however, ends with the
 * connection, and the next start takes over immediately instead of after the deadline. */
export const PROCESS = randomUUID();

export const receiptId = (): string => `${PROCESS}/${randomUUID()}`;

/** The lock connection belongs to the access whose pool it comes from. */
const lock = (k: JobsContext) => k.compartments.slot('prozessSperre', () => ({ client: null as PoolClient | null }));

/** @returns jobs taken over from dead processes */
export async function registerProcess(k: JobsContext): Promise<number> {
  const s = lock(k);
  if (!s.client) {
    const c = await k.db.systemPool.connect();
    c.on('error', e => reportError('auftraege:prozess-sperre', e));
    await repo.holdProcessLock(c, PROCESS);
    s.client = c;
  }
  return repo.giveOrphanedBack(s.client, PROCESS);
}

export function deregisterProcess(k: JobsContext): void {
  const s = lock(k);
  s.client?.release(true);
  s.client = null;
}
