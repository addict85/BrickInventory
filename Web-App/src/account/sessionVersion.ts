/** Deleting session rows is not enough: a running request writes its
 * session back at the end via upsert. Hence every session carries the version
 * of the account; whoever ends accesses increments it, and every request compares. */
import { reportAccessChange } from './accessChange';
import { processEvent } from '../infra/event';
import type { AccountContext } from './context';

const CACHE_MS = 5_000;
/** Per access; `stand` counts every clearing so that an older read state does not get back in. */
const store = (k: AccountContext) =>
  k.faecher.slot('sitzungsVersion', () => ({
    entries: new Map<number, { version: number | null; bis: number }>(),
    state: 0,
    verteilt: false,
  }));
const remembered = (k: AccountContext) => store(k).entries;

/** A second web process would otherwise keep the old version for up to five seconds: every increment
 * is announced via NOTIFY. Without a standing listen connection only the database counts (fail closed). */
const CHANNEL = 'sitzung_version';
const increased = (k: AccountContext) =>
  k.faecher.slot('sitzungsVersionSignal', () => {
    const e = processEvent('sitzungsVersion', CHANNEL);
    e.listen(() => forgetAllSessionVersions(k));
    return e;
  });
function forgetAllSessionVersions(k: AccountContext): void {
  const s = store(k);
  s.entries.clear();
  s.state++;
}
export function listenOnSessionVersion(k: AccountContext): void {
  store(k).verteilt = true;
  increased(k).connect(k.db.notification);
}
function usable(k: AccountContext): boolean {
  if (store(k).verteilt && k.db.notification.listensTo(CHANNEL)) return true;
  forgetAllSessionVersions(k);
  return false;
}
function reportIncrease(k: AccountContext): void {
  if (store(k).verteilt) void increased(k).report(k.db.notification);
}

/** null: account missing or locked. */
export function sessionVersionFromDb(k: AccountContext, uid: number): Promise<number | null> {
  return k.accesses.sessionVersion(uid);
}

export async function currentSessionVersion(k: AccountContext, uid: number): Promise<number | null> {
  if (!usable(k)) return k.accesses.sessionVersion(uid);
  const g = remembered(k).get(uid);
  if (g && g.bis > k.clock.now()) return g.version;
  const before = store(k).state;
  const version = await k.accesses.sessionVersion(uid);
  if (store(k).state === before) remembered(k).set(uid, { version, bis: k.clock.now() + CACHE_MS });
  return version;
}

/** Call before deleting the rows; returns the new version. */
export async function increaseSessionVersion(k: AccountContext, uid: number): Promise<number> {
  const version = await k.accesses.countSessionVersionHigh(uid);
  forgetAllSessionVersions(k);
  reportAccessChange();
  reportIncrease(k);
  return version;
}

/** After the COMMIT of a transaction that incremented the version: a request
 * in between would otherwise have remembered the old state again. */
export function forgetSessionVersion(k: AccountContext, _uid: number): void {
  forgetAllSessionVersions(k);
  reportAccessChange();
  reportIncrease(k);
}
