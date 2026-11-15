import type { DbSchnittstelle } from '../../../db/database';

/** Zwei Zähler in einem Zug: Konten überhaupt, und Verwalter, die noch das
 * Startpasswort aus dem Protokoll tragen. */
export async function kontenStand(db: DbSchnittstelle): Promise<{ vorhanden: boolean; startpasswort: boolean }> {
  const r = await db.get<{ anzahl: number; startpasswort: number }>(
    `SELECT COUNT(*)::int AS anzahl,
            COUNT(*) FILTER (WHERE is_admin AND must_change_password)::int AS startpasswort
       FROM users`,
  );
  return { vorhanden: Number(r?.anzahl) > 0, startpasswort: Number(r?.startpasswort) > 0 };
}
