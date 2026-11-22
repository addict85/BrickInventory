/**
 * Log of admin actions on other accounts (migration 0049).
 */
import type { DbInterface } from '../../../db/database';

export type AdminAction =
  | 'account_created'
  | 'password_set'
  | 'second_factor_removed'
  | 'admin_appointed'
  | 'admin_revoked'
  | 'account_deleted'
  | 'account_deactivated'
  | 'account_reactivated'
  | 'account_unlocked'
  | 'settings_changed'
  | 'voucher_plaintext'
  | 'voucher_pdf'
  | 'voucher_export'
  | 'takeover_announced'
  | 'takeover_cancelled';

/** Call before deleting — afterwards the name can no longer be determined. */
export async function logEntry(
  db: DbInterface,
  adminId: number,
  targetId: number,
  action: AdminAction,
  details: string | null = null,
): Promise<void> {
  await db.run(
    `INSERT INTO admin_log (admin_id, target_id, target_name, action, details)
     VALUES ($1, $2, (SELECT username FROM users WHERE id = $2), $3, $4)`,
    [adminId, targetId, action, details],
  );
  console.log(`[verwaltung] Konto ${adminId}: ${action} für Konto ${targetId}`);
}

export async function lastEntries(db: DbInterface, count = 200) {
  return db.all<Record<string, unknown>>(
    `SELECT p.id, p.occurred_at, p.action, p.details, p.target_id, p.target_name, p.admin_id, u.username AS verwalter_name
       FROM admin_log p LEFT JOIN users u ON u.id = p.admin_id
      ORDER BY p.occurred_at DESC, p.id DESC LIMIT $1`,
    [count],
  );
}

/** No app role has UPDATE and DELETE (0117): the retention period (one year) and the rule are fixed in
 * the owner's function. */
export async function cleanLogOn(db: DbInterface): Promise<number> {
  return (await db.get<{ n: number }>('SELECT admin_log_cleanup() AS n'))?.n ?? 0;
}
