import type { DbInterface } from '../../../db/database';

/** Separate from the settings, so that export, backup and settings
 * show no intermediate states of jobs. */
export async function liesZustand(db: DbInterface, schluessel: string): Promise<string | null> {
  const z = await db.get<{ value: unknown }>('SELECT value FROM run_state WHERE key = $1', [schluessel]);
  return z ? String(z.value) : null;
}

export async function setzeZustand(db: DbInterface, schluessel: string, wert: unknown): Promise<void> {
  await db.run(
    `INSERT INTO run_state (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [schluessel, String(wert)],
  );
}

export async function deleteState(db: DbInterface, ...schluessel: string[]): Promise<void> {
  if (schluessel.length) await db.run('DELETE FROM run_state WHERE key = ANY($1)', [schluessel]);
}

/** Atomic, never below 0: the row lock serializes concurrent calls. */
export async function countState(db: DbInterface, schluessel: string, delta: number): Promise<void> {
  await db.run(
    `INSERT INTO run_state (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = GREATEST(0, COALESCE(NULLIF(run_state.value, '')::int, 0) + $3)::text, updated_at = NOW()`,
    [schluessel, String(Math.max(0, delta)), delta],
  );
}
