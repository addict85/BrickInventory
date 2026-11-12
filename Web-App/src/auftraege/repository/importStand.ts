import type { DbSchnittstelle } from '../../../db/database';

/** Ein Lauf ohne Schreiben seit `minuten` gehört einem verschwundenen Prozess;
 * „running" sperrte sonst jeden weiteren Import. */
export async function markiereVerwaist(
  db: DbSchnittstelle,
  userId: number,
  fehler: string,
  minuten: number,
): Promise<void> {
  await db.run(
    `UPDATE import_stand SET status = 'error', current = NULL, error = $2, updated_at = NOW()
      WHERE user_id = $1 AND status IN ('running', 'pending')
        AND updated_at < NOW() - make_interval(mins => $3)`,
    [userId, fehler, minuten],
  );
}

/** Eine Zeile von import_stand; results ist jsonb. */
export interface ImportStandZeile {
  user_id: number;
  status: string | null;
  total: number | null;
  done: number | null;
  current: string | null;
  error: string | null;
  results: { success?: boolean; isWarning?: boolean; [k: string]: unknown }[] | null;
  run_id: string | null;
  started_at: Date | null;
  updated_at: Date | null;
}

export function importStand(db: DbSchnittstelle, userId: number) {
  return db.get<ImportStandZeile>('SELECT * FROM import_stand WHERE user_id = $1', [userId]);
}

/** Die Schlüssel landen als SPALTENNAMEN im Abfragetext, wo keine Bindung
 * hilft — deshalb die Positivliste. */
const JOB_COLUMNS = new Set(['status', 'total', 'done', 'current', 'results', 'error', 'started_at', 'run_id']);

function spalten(fields: Record<string, unknown>): string[] {
  const keys = Object.keys(fields);
  for (const k of keys) if (!JOB_COLUMNS.has(k)) throw new Error(`jobSet: unerlaubte Spalte "${k}"`);
  return keys;
}

export async function schreibeImportStand(
  db: DbSchnittstelle,
  userId: number,
  fields: Record<string, unknown>,
): Promise<void> {
  const keys = spalten(fields);
  await db.run(
    `INSERT INTO import_stand (user_id, ${keys.join(', ')}, updated_at)
     VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}, NOW())
     ON CONFLICT (user_id) DO UPDATE SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()`,
    [userId, ...keys.map(k => fields[k])],
  );
}

/** Nur, solange dieser Lauf eingetragen ist und läuft. */
export async function aendereImportStand(
  db: DbSchnittstelle,
  userId: number,
  fields: Record<string, unknown>,
  lauf?: string,
): Promise<number> {
  const keys = spalten(fields);
  const werte = [userId, ...keys.map(k => fields[k])];
  const r = await db.run(
    `UPDATE import_stand SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()
      WHERE user_id = $1${lauf ? ` AND run_id = $${keys.length + 2} AND status = 'running'` : ''}`,
    lauf ? [...werte, lauf] : werte,
  );
  return r?.changes ?? 0;
}

export function setzeLaufFort(db: DbSchnittstelle, userId: number, lauf: string) {
  return db.get<Pick<ImportStandZeile, 'results' | 'current'>>(
    `UPDATE import_stand SET status = 'running', error = NULL, updated_at = NOW()
      WHERE user_id = $1 AND run_id = $2 AND status IN ('running', 'error')
      RETURNING results, current`,
    [userId, lauf],
  );
}
