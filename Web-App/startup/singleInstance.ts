/** Throttle, PDF tickets, voucher balances, account limit and token cache
 * live in the web process's memory. A second one on the same database would have
 * its own counters and tickets (double quota, ticket from A unknown in B).
 * Instead of moving everything to Postgres, the web process holds a session lock
 * as long as it lives; a second one does not start. */
import type { Client } from 'pg';
import type { Db } from '../db/database';
import { attemptsProcessLock } from '../db/processLock';
import { reportError } from '../src/infra/error';
import { LOCKS } from '../src/infra/lockNamespaces';

export class SecondWebProcess extends Error {
  constructor(seconds: number) {
    super(
      `Ein zweiter Web-Prozess (ROLLE web oder beides) läuft schon auf dieser Datenbank; nach ${seconds} s ` +
        'Warten aufgegeben. Es darf nur einer laufen: Drossel, PDF-Tickets und Zwischenspeicher liegen im ' +
        'Prozessspeicher (UPGRADE.md#ein-web-prozess). Den anderen beenden oder hier ROLLE=jobs setzen.',
    );
  }
}

export interface Wait {
  /** Wait this long for a predecessor that is just ending (restart, deploy). */
  wartenMs?: number;
  taktMs?: number;
  /** The lock was lost and cannot be reclaimed; default: end the process. */
  atLoss?: (e: Error) => void;
}

/** An error while closing changes nothing any more; it is reported anyway. */
async function close(c: Client): Promise<void> {
  try {
    await c.end();
  } catch (e) {
    reportError('web-sperre:schliessen', e);
  }
}

async function receiptsLock(db: Db, o: Required<Pick<Wait, 'wartenMs' | 'taktMs'>>): Promise<Client> {
  const c = await db.ownConnection();
  // Without a listener, a disconnect while waiting would end the process unasked.
  c.on('error', () => {});
  const end = Date.now() + o.wartenMs;
  let reported = false;
  for (;;) {
    if (await attemptsProcessLock(c, LOCKS.WEB_PROCESS)) return c;
    if (!reported)
      console.warn(
        `[start] Ein anderer Web-Prozess hält die Sperre – warte bis zu ${o.wartenMs / 1000} s auf sein Ende`,
      );
    reported = true;
    if (Date.now() >= end) {
      await close(c);
      throw new SecondWebProcess(Math.round(o.wartenMs / 1000));
    }
    await new Promise(finished => setTimeout(finished, o.taktMs));
  }
}

/** @returns release (on shutdown). */
export async function holdWebLock(db: Db, o: Wait = {}): Promise<() => Promise<void>> {
  const frist = { wartenMs: o.wartenMs ?? 20_000, taktMs: o.taktMs ?? 1000 };
  const lost =
    o.atLoss ??
    ((e: Error) => {
      console.error(`❌ [start] Sperre des Web-Prozesses verloren: ${e.message}`);
      process.exit(1);
    });
  let client: Client | null = null;
  let free = false;
  // If the connection drops (database restart), the lock is gone: reclaim it,
  // again and again as long as the database is missing (live stays 200); give up only when
  // another web process holds it in the meantime.
  const retrieve = () => {
    if (free) return;
    receiptsLock(db, frist).then(hold, (e: unknown) =>
      e instanceof SecondWebProcess ? lost(e) : setTimeout(retrieve, frist.taktMs),
    );
  };
  const hold = (c: Client) => {
    if (free) return void close(c);
    client = c;
    c.on('error', () => {
      if (free || client !== c) return;
      client = null;
      retrieve();
    });
  };
  hold(await receiptsLock(db, frist));
  return async () => {
    free = true;
    if (client) await close(client);
    client = null;
  };
}
