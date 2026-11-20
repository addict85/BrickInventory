/** pg_advisory_lock on its own, permanent connection: it applies across all
 * processes and ends with the connection if the process crashes. */
export type LockConnection = {
  query: (sql: string, werte?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export async function attemptsLock(client: LockConnection, schluessel: number): Promise<boolean> {
  const r = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [schluessel]);
  return !!r.rows[0]?.ok;
}

export async function giveLockFree(client: LockConnection, schluessel: number): Promise<void> {
  await client.query('SELECT pg_advisory_unlock($1)', [schluessel]);
}
