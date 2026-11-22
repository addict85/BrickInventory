import type { DbInterface } from '../../../db/database';

/** A run without writes for `minuten` belongs to a vanished process;
 * "running" would otherwise block every further import. */
export async function markOrphaned(db: DbInterface, userId: number, error: string, minutes: number): Promise<void> {
  await db.run(
    `UPDATE import_status SET status = 'error', current = NULL, error = $2, updated_at = NOW()
      WHERE user_id = $1 AND status IN ('running', 'pending')
        AND updated_at < NOW() - make_interval(mins => $3)`,
    [userId, error, minutes],
  );
}

/** A row of import_status; results is jsonb. */
export interface ImportStatusRow {
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

export function importStand(db: DbInterface, userId: number) {
  return db.get<ImportStatusRow>('SELECT * FROM import_status WHERE user_id = $1', [userId]);
}

/** The keys end up as COLUMN NAMES in the query text, where no binding
 * helps — hence the allow list. */
const JOB_COLUMNS = new Set(['status', 'total', 'done', 'current', 'results', 'error', 'started_at', 'run_id']);

function columns(fields: Record<string, unknown>): string[] {
  const keys = Object.keys(fields);
  for (const k of keys) if (!JOB_COLUMNS.has(k)) throw new Error(`jobSet: unerlaubte Spalte "${k}"`);
  return keys;
}

export async function writeImportStatus(
  db: DbInterface,
  userId: number,
  fields: Record<string, unknown>,
): Promise<void> {
  const keys = columns(fields);
  await db.run(
    `INSERT INTO import_status (user_id, ${keys.join(', ')}, updated_at)
     VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}, NOW())
     ON CONFLICT (user_id) DO UPDATE SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()`,
    [userId, ...keys.map(k => fields[k])],
  );
}

/** Only as long as this run is registered and running. */
export async function changeImportStatus(
  db: DbInterface,
  userId: number,
  fields: Record<string, unknown>,
  lauf?: string,
): Promise<number> {
  const keys = columns(fields);
  const values = [userId, ...keys.map(k => fields[k])];
  const r = await db.run(
    `UPDATE import_status SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()
      WHERE user_id = $1${lauf ? ` AND run_id = $${keys.length + 2} AND status = 'running'` : ''}`,
    lauf ? [...values, lauf] : values,
  );
  return r?.changes ?? 0;
}

export function setRunFort(db: DbInterface, userId: number, lauf: string) {
  return db.get<Pick<ImportStatusRow, 'results' | 'current'>>(
    `UPDATE import_status SET status = 'running', error = NULL, updated_at = NOW()
      WHERE user_id = $1 AND run_id = $2 AND status IN ('running', 'error')
      RETURNING results, current`,
    [userId, lauf],
  );
}
