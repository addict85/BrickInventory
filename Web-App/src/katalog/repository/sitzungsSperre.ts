/**
 * Eine Sperre auf Sitzungsebene (pg_advisory_lock) über eine eigene, dauerhafte
 * Verbindung: Sie gilt über alle Prozesse und endet mit der Verbindung, falls
 * der Prozess abstürzt.
 */
export type SperrVerbindung = { query: (sql: string, werte?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

export async function versucheSperre(client: SperrVerbindung, schluessel: number): Promise<boolean> {
  const r = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [schluessel]);
  return !!r.rows[0]?.ok;
}

export async function gibSperreFrei(client: SperrVerbindung, schluessel: number): Promise<void> {
  await client.query('SELECT pg_advisory_unlock($1)', [schluessel]);
}
