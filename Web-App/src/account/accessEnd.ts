/** Sitzungen und Zugänge eines Kontos beenden, wenn sich an seinem Schutz etwas ändert. */
import { increaseSessionVersion, listenOnSessionVersion, forgetSessionVersion } from './sessionVersion';
import { tokenDigest, ACCESSES_AT_MOST } from './deviceToken';
import { listenOnTokenRevocation, emptyTokenCache } from './tokenCache';
import { inSystemContext } from '../infra/kontoKontext';
import { imSystemrahmen } from '../infra/bereich';
import type { AccountContext } from './context';

/** Token-Zwischenspeicher und Sitzungsversionen dieses Prozesses folgen den Widerrufen der anderen (NOTIFY). */
export function listenOnRevocation(k: AccountContext): void {
  listenOnTokenRevocation(k);
  listenOnSessionVersion(k);
}

export function limitSessions(k: AccountContext, userId: number, eigene: string): Promise<number> {
  return k.zugaenge.capSessions(userId, eigene, ACCESSES_AT_MOST - 1);
}

/** In user_sessions, wo der Session-Store wirklich liegt. */
export async function endAllSessions(k: AccountContext, userId: number): Promise<void> {
  await increaseSessionVersion(k, userId);
  await k.zugaenge.deleteSessionsOfAccount(userId);
}

/** Eine Transaktion über Zugangsdaten im Systemrahmen (die Anmeldung sucht sie, bevor es
 * ein Konto gibt). In einer laufenden nur, wenn sie selbst im Systemrahmen läuft. */
export function accessTransaction<T>(k: AccountContext, fn: (t: AccountContext) => Promise<T>): Promise<T> {
  return imSystemrahmen(k.db, 'zugangsdaten', () => k.transaktion(fn));
}

/** Passwort, Zugänge und Passkeys zusammen, im Systemrahmen (auch ohne Anmeldung: Passwort
 * vergessen). Die Zwischenspeicher leeren sich nach dem COMMIT noch einmal, weil eine Anfrage
 * dazwischen den alten Stand wieder aufgenommen haben kann. */
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

/** Alle Sitzungen ausser der eigenen, mit `zugaenge` auch die App-Zugänge ausser dem eigenen.
 * Die neue Version schreibt der Aufrufer in die Sitzung, die bleibt. */
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
