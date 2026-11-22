import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { newPool } from './bcryptPool';
import { config } from '../infra/config';

/** Every password check costs computing time and memory (argon2id, old bcrypt hashes, passwordHash.ts).
 * The brakes per address and account do not help against many addresses; this limit fixes the
 * number of concurrent runs, and whoever would have to wait too long gets 503. */
export class BcryptOverload extends Error {
  status = 503;
  code = 'server_busy' as const;
  constructor() {
    super('bcrypt: zu viele gleichzeitige Prüfungen');
  }
}

export interface Gate {
  /** vorrang: to the front of the queue and never rejected because of its length. */
  run<T>(work: () => Promise<T>, priority?: boolean): Promise<T>;
  state(): { laufend: number; wartend: number };
}

export function newLimit(concurrent: number, waitingAtMost: number, waitTimeMs: number): Gate {
  let laufend = 0;
  const queue: (() => void)[] = [];
  const slot = (priority: boolean): Promise<void> => {
    if (laufend < concurrent) {
      laufend++;
      return Promise.resolve();
    }
    if (!priority && queue.length >= waitingAtMost) return Promise.reject(new BcryptOverload());
    return new Promise((next, cancel) => {
      const los = () => {
        clearTimeout(frist);
        next();
      };
      const frist = setTimeout(() => {
        queue.splice(queue.indexOf(los), 1);
        cancel(new BcryptOverload());
      }, waitTimeMs);
      if (priority) queue.unshift(los);
      else queue.push(los);
    });
  };
  // The free slot goes directly to the next waiting one, `laufend` then stays the same.
  const free = () => {
    const next = queue.shift();
    if (next) next();
    else laufend--;
  };
  return {
    async run(work, priority = false) {
      await slot(priority);
      try {
        return await work();
      } finally {
        free();
      }
    },
    state: () => ({ laufend, wartend: queue.length }),
  };
}

/** Cores according to the cgroup quota (v2 cpu.max, v1 cfs_quota), null without a quota. */
export function quotaCores(wurzel = '/sys/fs/cgroup'): number | null {
  const lies = (f: string) => {
    try {
      return fs.readFileSync(path.join(wurzel, f), 'utf8').trim();
    } catch {
      return '';
    }
  };
  const [v2q, v2p] = lies('cpu.max').split(/\s+/);
  const [quote, period] = v2q
    ? [Number(v2q), Number(v2p)]
    : [Number(lies('cpu/cpu.cfs_quota_us')), Number(lies('cpu/cpu.cfs_period_us'))];
  return quote > 0 && period > 0 ? Math.max(1, Math.ceil(quote / period)) : null;
}

/** Every worker takes a good 12 MB; the host's cores say nothing about the
 * container's memory limit. BCRYPT_WORKERS raises the default of 4. */
export function bcryptWorkers(
  assigned = config().bcryptWorker,
  kerne = os.availableParallelism(),
  quota = quotaCores(),
): number {
  return assigned ?? Math.max(2, Math.min(kerne, quota ?? kerne, 4));
}

const KERNE = bcryptWorkers();
export const bcryptGate = newLimit(KERNE, KERNE * 8, 5000);
export const bcryptPool = newPool(KERNE);
