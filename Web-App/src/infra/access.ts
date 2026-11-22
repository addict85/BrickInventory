/** What the areas need from database access, as an interface of the lowest level:
 * db/database.ts fulfills it (Db), src/infra/area.ts builds on it without depending on db/. */

/** An inventory lock: account (always the owner) and key (inventoryKey). */
export interface HoldingLock {
  konto: number;
  schluessel: string | number;
}

export interface TxOptions {
  /** On deadlock (40P01) or serialization failure (40001) restart the whole transaction up to
   * twice. Only for bodies without external effects: they then run several times. */
  repeatAtConflict?: boolean;
  /** Taken before the body (db/txLock.ts); they hold until the end of the outermost transaction. */
  sperren?: readonly HoldingLock[];
}

/** `D` is the access itself: a transaction's body gets one of the same kind (`tx.db`). */
export interface Access<D> {
  transaction<T>(fn: (tx: { readonly db: D }) => Promise<T>, o?: TxOptions): Promise<T>;
  /** Whether this access is bound to a transaction or this call path holds one open. */
  inTransaction(): boolean;
}
