/** End sessions and accesses of an account when something about its protection changes. */
import { increaseSessionVersion, listenOnSessionVersion, forgetSessionVersion } from './sessionVersion';
import { tokenDigest, ACCESSES_AT_MOST } from './deviceToken';
import { listenOnTokenRevocation, emptyTokenCache } from './tokenCache';
import { inSystemContext } from '../infra/accountContext';
import { imSystemrahmen } from '../infra/area';
import type { AccountContext } from './context';

/** Token cache and session versions of this process follow the revocations of the others (NOTIFY). */
export function listenOnRevocation(k: AccountContext): void {
  listenOnTokenRevocation(k);
  listenOnSessionVersion(k);
}

export function limitSessions(k: AccountContext, userId: number, eigene: string): Promise<number> {
  return k.zugaenge.capSessions(userId, eigene, ACCESSES_AT_MOST - 1);
}

/** In user_sessions, where the session store really lives. */
export async function endAllSessions(k: AccountContext, userId: number): Promise<void> {
  await increaseSessionVersion(k, userId);
  await k.zugaenge.deleteSessionsOfAccount(userId);
}

/** A transaction over credentials in the system frame (login looks for them before there is
 * an account). Inside a running one only if that itself runs in the system frame. */
export function accessTransaction<T>(k: AccountContext, fn: (t: AccountContext) => Promise<T>): Promise<T> {
  return imSystemrahmen(k.db, 'zugangsdaten', () => k.transaktion(fn));
}

/** Password, accesses and passkeys together, in the system frame (also without login: forgotten
 * password). The caches clear once more after the COMMIT, because a request in
 * between may have picked up the old state again. */
export async function withAccessEnd<T>(
  k: AccountContext,
  konto: number | ((r: T) => number | null),
  fn: (t: AccountContext) => Promise<T>,
): Promise<T> {
  const r = await inSystemContext('zugangsende', () => k.transaktion(fn, { repeatAtConflict: true }));
  emptyTokenCache(k);
  const uid = typeof konto === 'function' ? konto(r) : konto;
  if (uid) forgetSessionVersion(k, uid);
  return r;
}

/** All sessions except the own, with `zugaenge` also the app accesses except the own.
 * The caller writes the new version into the session that stays. */
export async function endOther(
  k: AccountContext,
  uid: number,
  o: { sitzung: string | null; token: string | null; zugaenge: boolean },
): Promise<{ sitzungen: number; zugaenge: number; version: number }> {
  return withAccessEnd(k, uid, async t => {
    const zugaenge = o.zugaenge ? await t.konten.deleteOtherAccesses(uid, o.token ? tokenDigest(o.token) : null) : 0;
    const version = await increaseSessionVersion(t, uid);
    const sitzungen = await t.konten.deleteOtherSessions(uid, o.sitzung ?? '');
    return { sitzungen, zugaenge, version };
  });
}
