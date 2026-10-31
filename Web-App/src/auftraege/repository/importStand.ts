import * as db from '../../../db/database';

/** Datenzugriff auf import_stand: der Stand des CSV-Imports, eine Zeile je Konto. */

/**
 * Ein Lauf, der seit `minuten` nicht geschrieben hat, gehört einem Prozess,
 * den es nicht mehr gibt; „running" sperrte sonst jeden weiteren Import.
 */
export async function markiereVerwaist(userId: number, fehler: string, minuten: number): Promise<void> {
  await db.run(
    `UPDATE import_stand SET status = 'error', current = NULL, error = $2, updated_at = NOW()
      WHERE user_id = $1 AND status IN ('running', 'pending')
        AND updated_at < NOW() - make_interval(mins => $3)`, [userId, fehler, minuten]);
}

export function importStand(userId: number) {
  return db.get('SELECT * FROM import_stand WHERE user_id = $1', [userId]);
}

/**
 * Die Schlüssel landen als SPALTENNAMEN im Abfragetext, wo keine
 * Parameterbindung hilft — deshalb die Positivliste.
 * Ausführlich: docs/begruendungen/src/auftraege/importAuftrag.ts.md#job-columns
 */
const JOB_COLUMNS = new Set(['status', 'total', 'done', 'current', 'results', 'error', 'started_at', 'run_id']);

function spalten(fields: Record<string, unknown>): string[] {
  const keys = Object.keys(fields);
  for (const k of keys) if (!JOB_COLUMNS.has(k)) throw new Error(`jobSet: unerlaubte Spalte "${k}"`);
  return keys;
}

export async function schreibeImportStand(userId: number, fields: Record<string, unknown>): Promise<void> {
  const keys = spalten(fields);
  await db.run(
    `INSERT INTO import_stand (user_id, ${keys.join(', ')}, updated_at)
     VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}, NOW())
     ON CONFLICT (user_id) DO UPDATE SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()`,
    [userId, ...keys.map(k => fields[k])]);
}

/** Mit `lauf` nur, solange dieser Lauf eingetragen ist und läuft. @returns geänderte Zeilen */
export async function aendereImportStand(userId: number, fields: Record<string, unknown>, lauf?: string): Promise<number> {
  const keys = spalten(fields);
  const werte = [userId, ...keys.map(k => fields[k])];
  const r = await db.run(
    `UPDATE import_stand SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()
      WHERE user_id = $1${lauf ? ` AND run_id = $${keys.length + 2} AND status = 'running'` : ''}`,
    lauf ? [...werte, lauf] : werte);
  return r?.changes ?? 0;
}

/** Nach einem Neustart auch dann, wenn die Zeile inzwischen als verwaist markiert ist. */
export function setzeLaufFort(userId: number, lauf: string) {
  return db.get(
    `UPDATE import_stand SET status = 'running', error = NULL, updated_at = NOW()
      WHERE user_id = $1 AND run_id = $2 AND status IN ('running', 'error')
      RETURNING results, current`, [userId, lauf]);
}
