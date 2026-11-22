/** Session locks a process holds for its whole lifetime; they end
 * with its connection, even if it aborts hard. */
import type { ClientBase } from 'pg';

/** true if this connection now holds the lock (klasse, 0). */
export async function attemptsProcessLock(c: ClientBase, kind: number): Promise<boolean> {
  const r = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1, 0) AS ok', [kind]);
  return r.rows[0]?.ok === true;
}
