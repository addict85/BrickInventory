/** Die App-Zugänge eines Kontos in den Einstellungen: lesen und einzeln oder
 * alle anderen beenden. Der Token-Cache gälte sonst noch kurz nach. */
import { hintInBackground } from './kontoHinweis';
import { emptyTokenCache } from './tokenCache';
import type { AccountContext } from './kontext';

export function accessesList(k: AccountContext, uid: number) {
  return k.konten.accessesOfAccount(uid);
}

/** Einen fremden Zugang erfährt der Inhaber per Mail; den eigenen hat er selbst beendet. */
export async function endAccess(k: AccountContext, uid: number, kennung: string, ownDevice: boolean): Promise<number> {
  const { anzahl, label } = await k.konten.deleteAccess(uid, kennung);
  if (anzahl) {
    emptyTokenCache(k);
    if (!ownDevice) hintInBackground(k, uid, 'zugang_beendet', label ?? undefined);
  }
  return anzahl;
}
