import { LOCKS } from './lockNamespaces';

/**
 * Ob in dieser Datenbank gerade niemand die Primär-Sperre hält. Die
 * einwertige Beratungssperre steht in pg_locks als classid 0, objid = Schlüssel,
 * objsubid 1; pg_locks gilt für den ganzen Cluster, darum die Datenbank dazu.
 */
export async function primaerFehlt(db: { get: (sql: string, p?: unknown[]) => Promise<unknown> }): Promise<boolean> {
  const halter = await db.get(
    `SELECT 1 AS ok FROM pg_locks
      WHERE locktype = 'advisory' AND granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND classid = 0 AND objid = $1 AND objsubid = 1
      LIMIT 1`, [LOCKS.PRIMARY_WORKER]);
  return !halter;
}
