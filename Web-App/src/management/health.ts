/** What compose.yaml and monitoring ask without login: anonymously only the
 * status, the admin sees startup state and connections. */
import type { ManagementContext } from './context';

export async function healthReport(k: ManagementContext, admin: boolean) {
  const start = await k.jobQueue.currentStartState();
  return {
    status: start.ready ? ('ok' as const) : ('starting' as const),
    ...(admin ? { startup: start, db_pool: k.db.getPoolStats(), uptime_seconds: Math.floor(process.uptime()) } : {}),
  };
}

export function databaseReady(k: ManagementContext): Promise<boolean> {
  return k.db.databaseResponds();
}
