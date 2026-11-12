/** Sitzungssperren, die ein Prozess für seine ganze Lebenszeit hält; sie enden
 * mit seiner Verbindung, auch wenn er hart abbricht. */
import type { ClientBase } from 'pg';

/** true, wenn diese Verbindung die Sperre (klasse, 0) jetzt hält. */
export async function versucheProzessSperre(c: ClientBase, klasse: number): Promise<boolean> {
  const r = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1, 0) AS ok', [klasse]);
  return r.rows[0]?.ok === true;
}
