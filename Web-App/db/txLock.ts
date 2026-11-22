/**
 * Serializing concurrent mutations of the same inventory row.
 */
import type { Pool } from 'pg';
import type { DbInterface } from './types';
import { LOCKS } from '../src/infra/lockNamespaces';
import { reportError } from '../src/infra/error';

/** A transaction lock on (class, hashtext(key)); it ends with COMMIT or ROLLBACK.
 * Inventory locks are taken by k.transact(…, { sperren }) (src/infra/area.ts). The class
 * LOCKS.INVENTORY instead of the account id as first value: otherwise account 42 would lock the
 * image download (LOCKS.IMAGE_DOWNLOAD = 42) of the same set. */
async function lockUntilToEnd(tx: DbInterface, kind: number, key: string): Promise<void> {
  await tx.run('SELECT pg_advisory_xact_lock($1, hashtext($2))', [kind, key]);
}

import type { HoldingLock } from '../src/infra/access';

export type { HoldingLock };

/** Ascending by account, so two opposite directions (something moves between accounts) do not deadlock. */
async function lockInventories(tx: DbInterface, lock: readonly HoldingLock[]): Promise<void> {
  const key = [...new Set(lock.map(s => `${s.account}|${s.key}`))];
  const account = (x: string) => Number(x.slice(0, x.indexOf('|')));
  key.sort((x, y) => account(x) - account(y) || (x < y ? -1 : x > y ? 1 : 0));
  for (const s of key) await lockUntilToEnd(tx, LOCKS.INVENTORY, s);
}

/**
 * The lock key of an inventory row — the same for all paths, otherwise
 * two changes to the same part would not wait for each other. The lock is always on
 * the OWNER, not on the actor.
 */
function inventoryKey(kind: 'set' | 'part' | 'fig', keys: unknown[]): string {
  return kind === 'set' ? String(keys[0]) : `${kind}:${keys.join(':')}`;
}

/** Lock for household currency and linking: both check or change the same rule. */
async function lockHouseholdCurrency(tx: DbInterface): Promise<void> {
  await tx.run('SELECT pg_advisory_xact_lock($1, 0)', [LOCKS.HOUSEHOLD_CURRENCY]);
}

/**
 * A session lock on a connection of its own (advisory locks hang on the
 * session); if it is taken, `belegt` decides what happens.
 */
async function withSessionLock<T>(
  access: { pool: Pool },
  key: number,
  lauf: () => Promise<T>,
  claimed: () => never,
): Promise<T> {
  const client = await access.pool.connect();
  // If releasing fails, the connection must not go back into the pool with the lock
  // held; it is discarded (the lock ends with the session).
  let broken: Error | undefined;
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [key]);
    if (!rows[0]?.ok) claimed();
    try {
      return await lauf();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, 0)', [key]).catch((e: unknown) => {
        broken = e instanceof Error ? e : new Error(String(e));
        reportError('txLock:freigabe', e);
      });
    }
  } finally {
    client.release(broken);
  }
}

/**
 * Take a session lock for a whole lifetime.
 * @returns release, or null if another process holds it
 */
async function receiptsSessionLock(access: { pool: Pool }, key: number): Promise<(() => Promise<void>) | null> {
  const client = await access.pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [key]);
    if (!rows[0]?.ok) {
      client.release();
      return null;
    }
  } catch (e) {
    client.release();
    throw e;
  }
  return async () => {
    let broken: Error | undefined;
    await client.query('SELECT pg_advisory_unlock($1, 0)', [key]).catch((e: unknown) => {
      broken = e instanceof Error ? e : new Error(String(e));
      reportError('txLock:freigabe', e);
    });
    client.release(broken);
  };
}

type Querier = Pick<import('pg').ClientBase, 'query'>;

/** Session lock without waiting; the second value is hashtext(key). */
async function attemptsKeyLock(c: Querier, namespace: number, key: string): Promise<boolean> {
  const { rows } = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok', [
    namespace,
    key,
  ]);
  return !!rows[0]?.ok;
}

async function giveKeyLockFree(c: Querier, namespace: number, key: string): Promise<void> {
  await c.query('SELECT pg_advisory_unlock($1, hashtext($2))', [namespace, key]);
}

export {
  lockInventories,
  inventoryKey,
  lockHouseholdCurrency,
  withSessionLock,
  receiptsSessionLock,
  attemptsKeyLock,
  giveKeyLockFree,
  lockUntilToEnd,
};
