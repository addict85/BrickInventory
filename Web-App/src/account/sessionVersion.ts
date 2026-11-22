/** Deleting session rows is not enough: a running request writes its
 * session back at the end via upsert. Hence every session carries the version
 * of the account; whoever ends accesses increments it, and every request compares. */
import { reportAccessChange } from './accessChange';
import { processEvent } from '../infra/event';
import type { AccountContext } from './context';

const CACHE_MS = 5_000;
/** Per access; `stand` counts every clearing so that an older read state does not get back in. */
const speicher = (k: AccountContext) =>
  k.faecher.fach('sitzungsVersion', () => ({
    eintraege: new Map<number, { version: number | null; bis: number }>(),
    stand: 0,
    verteilt: false,
  }));
const gemerkt = (k: AccountContext) => speicher(k).eintraege;

/** A second web process would otherwise keep the old version for up to five seconds: every increment
 * is announced via NOTIFY. Without a standing listen connection only the database counts (fail closed). */
const CHANNEL = 'sitzung_version';
const increased = (k: AccountContext) =>
  k.faecher.fach('sitzungsVersionSignal', () => {
    const e = processEvent('sitzungsVersion', CHANNEL);
    e.horche(() => forgetAllSessionVersions(k));
    return e;
  });
function forgetAllSessionVersions(k: AccountContext): void {
  const s = speicher(k);
  s.eintraege.clear();
  s.stand++;
}
export function listenOnSessionVersion(k: AccountContext): void {
  speicher(k).verteilt = true;
  increased(k).connect(k.db.notification);
}
function nutzbar(k: AccountContext): boolean {
  if (speicher(k).verteilt && k.db.notification.listensTo(CHANNEL)) return true;
  forgetAllSessionVersions(k);
  return false;
}
function reportIncrease(k: AccountContext): void {
  if (speicher(k).verteilt) void increased(k).melde(k.db.notification);
}

/** null: account missing or locked. */
export function sessionVersionFromDb(k: AccountContext, uid: number): Promise<number | null> {
  return k.zugaenge.sitzungsVersion(uid);
}

export async function currentSessionVersion(k: AccountContext, uid: number): Promise<number | null> {
  if (!nutzbar(k)) return k.zugaenge.sitzungsVersion(uid);
  const g = gemerkt(k).get(uid);
  if (g && g.bis > k.uhr.jetzt()) return g.version;
  const vorher = speicher(k).stand;
  const version = await k.zugaenge.sitzungsVersion(uid);
  if (speicher(k).stand === vorher) gemerkt(k).set(uid, { version, bis: k.uhr.jetzt() + CACHE_MS });
  return version;
}

/** Call before deleting the rows; returns the new version. */
export async function increaseSessionVersion(k: AccountContext, uid: number): Promise<number> {
  const version = await k.zugaenge.countSessionVersionHigh(uid);
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
