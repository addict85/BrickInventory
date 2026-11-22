/** Log of administrator actions on foreign accounts; belongs to the account, because
 * deleting an account also writes it in the same transaction. */
import type { AdminAction } from './repository/log';
import type { AccountContext } from './context';

export type { AdminAction } from './repository/log';

export function rememberAdminAction(
  k: AccountContext,
  adminId: number,
  targetId: number,
  action: AdminAction,
  details: string | null = null,
): Promise<void> {
  return k.protokoll.protokolliere(adminId, targetId, action, details);
}

export function managementLog(k: AccountContext) {
  return k.protokoll.lastEntries();
}
