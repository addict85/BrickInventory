/** Was compose.yaml und die Überwachung ohne Anmeldung fragen: anonym nur der
 * Status, der Verwalter sieht Startzustand und Verbindungen. */
import * as db from '../../db/database';
import { aktuellerStartZustand } from '../auftraege/startZustand';

export async function gesundheitsBericht(verwalter: boolean) {
  const start = await aktuellerStartZustand();
  return {
    status: start.ready ? ('ok' as const) : ('starting' as const),
    ...(verwalter ? { startup: start, db_pool: db.getPoolStats(), uptime_seconds: Math.floor(process.uptime()) } : {}),
  };
}

export function datenbankBereit(): Promise<boolean> {
  return db.datenbankAntwortet();
}
