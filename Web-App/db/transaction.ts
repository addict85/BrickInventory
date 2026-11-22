/** The state of a transaction: row-level-security context, savepoints, stragglers
 * and frame switches. createDb() (database.ts) opens it; whoever queries in it gets
 * its handle (`tx`, `tx.db`) passed explicitly. */
import type { Pool, PoolClient } from 'pg';
import type { DbInterface } from './types';
import {
  companionOfPath,
  withCompanion,
  transactionOfPath,
  rowsContext,
  type PathTransaction,
} from '../src/infra/accountContext';

/** `offen` guards against stragglers after COMMIT; `db` is the access that opened it. */
export type TxStand = PathTransaction & {
  client: PoolClient;
  offen: boolean;
  db: object;
  pool: Pool;
  innerster: string | null;
  kontext: string;
};

/** The open transaction of this call path, for the guards (UnboundQuery, fallback value). */
export function runningTx(): TxStand | null {
  const t = transactionOfPath();
  return t && 'client' in t ? (t as TxStand) : null;
}

/** For row-level security (migration 0111): who is asking, only until the end
 * of the transaction. A value at session level would stick to the pool connection
 * and apply to the next request of another account. The account id
 * is a checked integer and may therefore go into the SQL. The system frame
 * is carried by the role of the connection (migration 0112), not a setting. */
export function contextSql(): string {
  const { system, konto } = rowsContext();
  if (system || konto === null) return '';
  return `SELECT set_config('app.konto', '${konto}', true)`;
}
const CONTEXT_EMPTY = "SELECT set_config('app.konto', '', true)";

/** Any SQL can set app.konto (an injection): before COMMIT it must still be what `kontext` set,
 * otherwise this fails and the transaction ends as ROLLBACK. */
export function contextCheckSql(context: string): string {
  const konto = /'app\.konto', '(\d*)'/.exec(context)?.[1] ?? '';
  return (
    `DO $$BEGIN IF COALESCE(current_setting('app.konto', true), '') <> '${konto}' THEN ` +
    `RAISE EXCEPTION 'app.konto changed within the transaction' USING ERRCODE = '42501'; END IF; END$$`
  );
}

/** If the account changes in the middle of the transaction (asRequest), the setting follows. */
export async function contextSync(stand: TxStand): Promise<void> {
  const expected = contextSql();
  if (expected === stand.kontext) return;
  await stand.client.query(expected || CONTEXT_EMPTY);
  stand.kontext = expected;
}

/** What the body of a transaction gets: its queries and `db`, a whole access
 * over its connection, from which the context `t` is built (src/infra/area.ts). */
export interface TxHandleOf<D> extends DbInterface {
  readonly db: D;
}

/** The queries over the transaction's connection; `pruefe` guards the frame. */
export function txQueries(stand: TxStand, check: () => void): DbInterface {
  const q = async (sql: string, p?: unknown[]) => {
    openStill(stand);
    check();
    await contextSync(stand);
    return stand.client.query(sql, p);
  };
  return {
    all: <T = unknown>(sql: string, p?: unknown[]) => q(sql, p).then(r => r.rows as T[]),
    get: <T = unknown>(sql: string, p?: unknown[]) => q(sql, p).then(r => r.rows[0] as T | undefined),
    run: (sql: string, p?: unknown[]) => q(sql, p).then(r => ({ changes: r.rowCount ?? 0 })),
    exec: (sql: string) => q(sql).then(() => undefined),
  };
}

/** Runs before the COMMIT of every outermost transaction of this call path,
 * inside it: what it writes takes effect exactly when the transaction's effect does. */
type CommitCompanion = (tx: DbInterface) => Promise<void>;
export function commitCompanion(): CommitCompanion | null {
  return (companionOfPath() as CommitCompanion | null) ?? null;
}
export function withCommitCompanion<T>(companion: CommitCompanion, work: () => T): T {
  return withCompanion(companion, work);
}

/** The connection of a finished transaction is already back in the pool: a straggler
 * (Promise.all aborts on the first error, the others keep running) would spoil
 * a stranger's transaction there. */
export class TransactionEnded extends Error {
  constructor() {
    super('Abfrage nach dem Ende ihrer Transaktion (Nachzügler aus Promise.all?)');
  }
}
function openStill(stand: TxStand): void {
  if (!stand.offen) throw new TransactionEnded();
}

export class BesideTheTransaction extends Error {
  constructor(transactionInSystemFrame: boolean) {
    super(
      transactionInSystemFrame
        ? 'Abfrage ohne Systemrahmen in einer Transaktion des Systemrahmens: Sie liefe über eine zweite Verbindung neben ihr.'
        : 'Systemrahmen (imSystemkontext) mitten in einer Transaktion: Die Abfrage liefe über eine zweite ' +
            'Verbindung neben ihr. Den Rahmen vor der Transaktion betreten.',
    );
  }
}

/** A query over the unbound access while a transaction is open in this call path:
 * it belongs either into the transaction (via `t`) or
 * before or after it. Silently redirecting would mean the call site does not say what applies. */
export class UnboundQuery extends Error {
  constructor() {
    super(
      'Abfrage über den ungebundenen Zugang (k/db) mitten in einer Transaktion: über den Kontext ' +
        'der Transaktion (t) fragen oder ausserhalb von ihr.',
    );
  }
}

export class ConcurrentSavepoint extends Error {
  constructor(open: string) {
    super(
      `Innere Transaktion, während ${open} derselben Transaktion noch läuft (Promise.all über ` +
        'db.transaction?): Sicherungspunkte einer Verbindung sind ein Stapel, nacheinander ausführen.',
    );
  }
}

/** Inside a transaction a savepoint: if the inner part fails
 * and the caller catches that, the outer transaction stays usable. Two
 * concurrent ones would share a connection; the ROLLBACK TO of one would take
 * the other's work with it. Hence each begins in the innermost open one, and
 * which one that is is told by the handle it is called through (`rahmen`). */
export function innerTransaction<T>(
  stand: TxStand,
  frame: string | null,
  number: number,
  fn: (name: string) => Promise<T>,
): Promise<T> {
  if (stand.innerster !== frame) return Promise.reject(new ConcurrentSavepoint(stand.innerster ?? ''));
  const name = `sp_${number}`;
  stand.innerster = name;
  return (async () => {
    const { client } = stand;
    // ROLLBACK TO also undoes a set_config() from the savepoint.
    const contextBefore = stand.kontext;
    try {
      openStill(stand);
      await client.query(`SAVEPOINT ${name}`);
      try {
        const r = await fn(name);
        openStill(stand);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return r;
      } catch (e) {
        if (!stand.offen) throw e;
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        stand.kontext = contextBefore;
        if (e !== null && typeof e === 'object') fromSavepointCaught.add(e);
        throw e;
      }
    } finally {
      stand.innerster = frame;
    }
  })();
}

/** After ROLLBACK TO SAVEPOINT the transaction is usable again: whoever catches this
 * error and delivers a replacement hides nothing. */
const fromSavepointCaught = new WeakSet<object>();

/** The state of a new transaction; it is also its guard against fallback values. */
export function newTxStatus(t: Omit<TxStand, 'verdirbt' | 'offen' | 'innerster' | 'kontext'>): TxStand {
  const stand: TxStand = {
    ...t,
    offen: true,
    innerster: null,
    kontext: '',
    verdirbt: e => stand.offen && !(e !== null && typeof e === 'object' && fromSavepointCaught.has(e)),
  };
  return stand;
}
