/** The connection comes from the log: it starts before the database layer
 * and must not import it. */
export interface Abfrager {
  query(sql: string, werte?: unknown[]): Promise<unknown>;
}

export function writeLogRows(pool: Abfrager, zeilen: { level: string; message: string }[]) {
  const vals = zeilen.map((_, i) => `($${i * 2 + 1},$${i * 2 + 2})`).join(',');
  return pool.query(
    `INSERT INTO app_logs (level,message) VALUES ${vals}`,
    zeilen.flatMap(r => [r.level, r.message]),
  );
}

export function deleteOldLogRows(pool: Abfrager) {
  return pool.query(`DELETE FROM app_logs WHERE logged_at < NOW() - INTERVAL '48 hours'`);
}
