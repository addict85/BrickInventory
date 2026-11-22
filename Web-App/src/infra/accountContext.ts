/** The call frame, the only channel via AsyncLocalStorage: who asks (row security per transaction),
 * flags for the database's guards, commit companions, request identifier (docs/architecture.md). */
import { AsyncLocalStorage } from 'node:async_hooks';

/** What reveals the account of a request: session, token or a job on behalf
 * of an account. Deliberately without Express so that counters deep down can read it. */
export interface AccountSource {
  apiUser?: { user_id?: number; is_admin?: boolean } | undefined;
  session?: { userId?: number; isAdmin?: unknown } | undefined;
  tokenUserId?: number | undefined;
}

/** What the guards know about the open transaction (db/transaction.ts fills it): the guard
 * against substitute values travels with it in the frame, not as process state. */
export interface PathTransaction {
  /** Does this error leave it spoiled? A savepoint that caught it does not. */
  verdirbt(e: unknown): boolean;
  /** In tests an error outside the database throws as well, so that the rule applies. */
  readonly streng: boolean;
}

interface Frame {
  /** Read only when asking: login sets the account later on the same object. */
  source: AccountSource | null;
  system: string | null;
  web: boolean;
  /** The open transaction of this call path: only for guards, never a way to it. */
  transaktion: PathTransaction | null;
  companion: unknown;
  rid: string | null;
}
const LEER: Frame = { source: null, system: null, web: false, transaktion: null, companion: null, rid: null };
const frame = new AsyncLocalStorage<Frame>();
const now = (): Frame => frame.getStore() ?? LEER;
const withFrame = <T>(teil: Partial<Frame>, f: () => T): T => frame.run({ ...now(), ...teil }, f);

export function currentAccount(): { id: number; verwalter: boolean } | null {
  const q = now().source;
  if (!q) return null;
  const id = Number(q.apiUser?.user_id ?? q.session?.userId ?? q.tokenUserId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const verwalter = q.apiUser ? !!q.apiUser.is_admin : !!q.session?.isAdmin;
  return { id, verwalter };
}

/** Work across account boundaries: queries then go via the system role (BYPASSRLS, migration 0112).
 * The reason stands at the call, findable via `inSystemContext(`. */
export function inSystemContext<T>(reason: string, f: () => T): T {
  return withFrame({ system: reason }, f);
}

/** On behalf of an account (job): without an inherited system frame and not as an HTTP request. */
export function asRequest<T>(source: AccountSource, f: () => T): T {
  return withFrame({ system: null, web: false, source }, f);
}

/** An HTTP request inherits no system frame; its own is carried by the web system role (db/database.ts). */
export function asWebRequest<T>(source: AccountSource, f: () => T): T {
  return withFrame({ system: null, web: true, source }, f);
}

export function rowsContext(): { system: boolean; web: boolean; konto: number | null } {
  const r = now();
  return { system: !!r.system, web: r.web, konto: currentAccount()?.id ?? null };
}

/** A service for an account other than that of the row security would silently see less; others via asRequest. */
export class ForeignAccount extends Error {
  constructor(uid: number, konto: number) {
    super(`Dienst für Konto ${uid} unter dem Zeilenschutz von Konto ${konto}`);
  }
}

export function checkRequester(uid: number): void {
  if (now().system) return;
  // Without an account in the frame (startup, before login) no row security filters silently.
  const konto = currentAccount()?.id;
  if (konto !== undefined && konto !== uid) throw new ForeignAccount(uid, konto);
}

/** For the database's guards (db/transaction.ts), the idempotency's commit companion and the log. */
export function inTransactionPath<T>(transaktion: PathTransaction, f: () => T): T {
  return withFrame({ transaktion }, f);
}
export function transactionOfPath(): PathTransaction | null {
  return now().transaktion;
}

export function withCompanion<T>(companion: unknown, f: () => T): T {
  return withFrame({ companion }, f);
}
export function companionOfPath(): unknown {
  return now().companion;
}

export const requestContext = {
  run: <T>(w: { rid: string }, f: () => T): T => withFrame({ rid: w.rid }, f),
  getStore: (): { rid: string } | undefined => {
    const rid = now().rid;
    return rid === null ? undefined : { rid };
  },
};
