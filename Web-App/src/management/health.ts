/** Was compose.yaml und die Überwachung ohne Anmeldung fragen: anonym nur der
 * Status, der Verwalter sieht Startzustand und Verbindungen. */
import type { ManagementContext } from './context';

export async function healthReport(k: ManagementContext, verwalter: boolean) {
  const start = await k.auftraege.aktuellerStartZustand();
  return {
    status: start.ready ? ('ok' as const) : ('starting' as const),
    ...(verwalter
      ? { startup: start, db_pool: k.db.getPoolStats(), uptime_seconds: Math.floor(process.uptime()) }
      : {}),
  };
}

export function databaseReady(k: ManagementContext): Promise<boolean> {
  return k.db.datenbankAntwortet();
}
