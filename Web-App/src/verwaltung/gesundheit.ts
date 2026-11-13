/** Was compose.yaml und die Überwachung ohne Anmeldung fragen: anonym nur der
 * Status, der Verwalter sieht Startzustand und Verbindungen. */
import type { VerwaltungKontext } from './kontext';

export async function gesundheitsBericht(k: VerwaltungKontext, verwalter: boolean) {
  const start = await k.auftraege.aktuellerStartZustand();
  return {
    status: start.ready ? ('ok' as const) : ('starting' as const),
    ...(verwalter
      ? { startup: start, db_pool: k.db.getPoolStats(), uptime_seconds: Math.floor(process.uptime()) }
      : {}),
  };
}

export function datenbankBereit(k: VerwaltungKontext): Promise<boolean> {
  return k.db.datenbankAntwortet();
}
