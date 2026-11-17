import type { DbSchnittstelle } from '../../../db/database';

/** Getrennt von den Einstellungen, damit Export, Sicherung und Einstellungen
 * keine Zwischenstände von Jobs zeigen. */
export async function liesZustand(db: DbSchnittstelle, schluessel: string): Promise<string | null> {
  const z = await db.get<{ value: unknown }>('SELECT value FROM run_state WHERE key = $1', [schluessel]);
  return z ? String(z.value) : null;
}

export async function setzeZustand(db: DbSchnittstelle, schluessel: string, wert: unknown): Promise<void> {
  await db.run(
    `INSERT INTO run_state (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [schluessel, String(wert)],
  );
}

export async function loescheZustand(db: DbSchnittstelle, ...schluessel: string[]): Promise<void> {
  if (schluessel.length) await db.run('DELETE FROM run_state WHERE key = ANY($1)', [schluessel]);
}

/** Atomar, nie unter 0: Die Zeilensperre serialisiert gleichzeitige Aufrufe. */
export async function zaehleZustand(db: DbSchnittstelle, schluessel: string, delta: number): Promise<void> {
  await db.run(
    `INSERT INTO run_state (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = GREATEST(0, COALESCE(NULLIF(run_state.value, '')::int, 0) + $3)::text, updated_at = NOW()`,
    [schluessel, String(Math.max(0, delta)), delta],
  );
}
