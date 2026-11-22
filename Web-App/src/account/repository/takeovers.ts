import type { DbInterface } from '../../../db/database';

export type TakeoverKind = 'password' | 'second_factor' | 'deactivate' | 'revoke_role' | 'delete';
export interface Takeover {
  target_id: number;
  type: TakeoverKind;
  initiated_by: number;
  password_hash: string | null;
}

export async function scheduleTermination(
  db: DbInterface,
  u: Takeover,
  hours: number,
  abortHash: string,
): Promise<Date> {
  const r = await db.get<{ effective_at: Date }>(
    `INSERT INTO admin_takeovers (target_id, type, initiated_by, password_hash, effective_at, cancel_hash)
     VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5), $6)
     ON CONFLICT (target_id, type) DO UPDATE SET initiated_by = EXCLUDED.initiated_by, password_hash = EXCLUDED.password_hash,
       created_at = NOW(), effective_at = EXCLUDED.effective_at, cancel_hash = EXCLUDED.cancel_hash
     RETURNING effective_at`,
    [u.target_id, u.type, u.initiated_by, u.password_hash, hours, abortHash],
  );
  return r!.effective_at;
}

/** Whoever just lost the role still counts as admin: otherwise one would revoke it first and then take over immediately. */
export async function adminOrJustBeen(db: DbInterface, target: number, hours: number): Promise<boolean> {
  const r = await db.get<{ yes: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND is_admin)
         OR EXISTS (SELECT 1 FROM admin_log WHERE target_id = $1 AND action = 'admin_revoked'
                     AND occurred_at > NOW() - make_interval(hours => $2)) AS yes`,
    [target, hours],
  );
  return r?.yes === true;
}

/** Due and still backed by the admin who announced it. Not password and factor if the
 * target has been deactivated since or is being deactivated now: it could no longer log in to cancel. */
export async function takeDue(db: DbInterface): Promise<{ valid: Takeover[]; discarded: number }> {
  const route = await db.all<Takeover & { valid: boolean }>(
    `WITH weg AS (DELETE FROM admin_takeovers WHERE effective_at <= NOW() RETURNING *)
     SELECT w.target_id, w.type, w.initiated_by, w.password_hash,
       EXISTS (SELECT 1 FROM users d WHERE d.id = w.initiated_by AND d.is_admin AND d.is_active)
       AND (w.type NOT IN ('password', 'second_factor') OR NOT (
         EXISTS (SELECT 1 FROM admin_log p WHERE p.target_id = w.target_id
                   AND p.action = 'account_deactivated' AND p.occurred_at >= w.created_at)
         OR EXISTS (SELECT 1 FROM weg x WHERE x.target_id = w.target_id AND x.type = 'deactivate'))) AS valid
       FROM weg w`,
  );
  return { valid: route.filter(z => z.valid), discarded: route.filter(z => !z.valid).length };
}

export async function abortTakeovers(db: DbInterface, target: number): Promise<TakeoverKind[]> {
  const r = await db.all<{ type: TakeoverKind }>('DELETE FROM admin_takeovers WHERE target_id = $1 RETURNING type', [
    target,
  ]);
  return r.map(z => z.type);
}

/** The target for the link from the mail; the link works once because cancelling deletes the rows. */
export async function targetToAbort(db: DbInterface, abortHash: string): Promise<number | null> {
  const r = await db.get<{ target_id: number }>('SELECT target_id FROM admin_takeovers WHERE cancel_hash = $1', [
    abortHash,
  ]);
  return r?.target_id ?? null;
}

export function announced(db: DbInterface) {
  return db.all<{ target_id: number; type: TakeoverKind; effective_at: Date }>(
    'SELECT target_id, type, effective_at FROM admin_takeovers ORDER BY effective_at',
  );
}
