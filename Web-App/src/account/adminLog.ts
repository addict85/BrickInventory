/** Protokoll der Verwalteraktionen an fremden Konten; gehört zum Konto, weil
 * auch das Löschen eines Kontos es in derselben Transaktion schreibt. */
import type { AdminAction } from './repository/log';
import type { AccountContext } from './context';

export type { AdminAction } from './repository/log';

export function rememberAdminAction(
  k: AccountContext,
  adminId: number,
  targetId: number,
  aktion: AdminAction,
  einzelheiten: string | null = null,
): Promise<void> {
  return k.protokoll.protokolliere(adminId, targetId, aktion, einzelheiten);
}

export function managementLog(k: AccountContext) {
  return k.protokoll.lastEntries();
}
