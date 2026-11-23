import type { DbInterface } from '../../../db/database';

/** Two counters in one go: accounts at all, and admins that still carry the
 * start password from the log. */
export async function accountsStatus(db: DbInterface): Promise<{ existing: boolean; start_password: boolean }> {
  const r = await db.get<{ count: number; start_password: number }>(
    `SELECT COUNT(*)::int AS count,
            COUNT(*) FILTER (WHERE is_admin AND must_change_password)::int AS start_password
       FROM users`,
  );
  return { existing: Number(r?.count) > 0, start_password: Number(r?.start_password) > 0 };
}
