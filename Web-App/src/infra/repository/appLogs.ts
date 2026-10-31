/** Die Verbindung kommt vom Protokoll: Es läuft vor der Datenbankschicht an
 * und darf sie nicht importieren. */
export interface Abfrager { query(sql: string, werte?: unknown[]): Promise<unknown> }

export function schreibeLogZeilen(pool: Abfrager, zeilen: { level: string; message: string }[]) {
  const vals = zeilen.map((_, i) => `($${i * 2 + 1},$${i * 2 + 2})`).join(',');
  return pool.query(`INSERT INTO app_logs (level,message) VALUES ${vals}`, zeilen.flatMap(r => [r.level, r.message]));
}

export function loescheAlteLogZeilen(pool: Abfrager) {
  return pool.query(`DELETE FROM app_logs WHERE logged_at < NOW() - INTERVAL '48 hours'`);
}
