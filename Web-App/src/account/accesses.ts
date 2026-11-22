/** The app accesses of an account in the settings: read and end one or
 * all others. The token cache would otherwise still apply briefly. */
import { hintInBackground } from './accountNotice';
import { emptyTokenCache } from './tokenCache';
import type { AccountContext } from './context';

export function accessesList(k: AccountContext, uid: number) {
  return k.accounts.accessesOfAccount(uid);
}

/** The owner learns about a foreign access by mail; the own one they ended themselves. */
export async function endAccess(k: AccountContext, uid: number, key: string, ownDevice: boolean): Promise<number> {
  const { count, label } = await k.accounts.deleteAccess(uid, key);
  if (count) {
    emptyTokenCache(k);
    if (!ownDevice) hintInBackground(k, uid, 'access_ended', label ?? undefined);
  }
  return count;
}
