/** Access to PostgreSQL: pool, queries, transactions. Transaction state in
 * transaction.ts, retry in retry.ts, first start in schemaStart.ts. */

import { Pool, types as pgTypes, Client } from 'pg';
import type { PoolClient, PoolConfig, QueryResult } from 'pg';
import { Notification, type Signals } from './pgNotify';
import type { DbInterface } from './types';
import { errorCode, reportError } from '../src/infra/error';
import { konfig, databaseConnection, systemConnection, systemWebConnection } from '../src/infra/config';
import { queryWithRetry, isReading } from './retry';
import { inTransactionPath, rowsContext } from '../src/infra/accountContext';
import {
  runningTx,
  contextSql,
  contextCheckSql,
  txQueries,
  commitCompanion,
  withCommitCompanion,
  innerTransaction,
  BesideTheTransaction,
  newTxStatus,
  TransactionEnded,
  UnboundQuery,
  type TxHandleOf,
  type TxStand,
} from './transaction';
import { initSchema, initSchemaOnce, MAY_SCHEMA_CHANGE, type FirstStart } from './schemaStart';
import { lockInventories } from './txLock';
import type { HoldingLock, TxOptions, Access } from '../src/infra/access';

export { queryWithRetry, isReading } from './retry';
export {
  withCommitCompanion,
  TransactionEnded,
  BesideTheTransaction,
  UnboundQuery,
  ConcurrentSavepoint,
} from './transaction';
export type { FirstStart as Erststart } from './schemaStart';

// All dependencies are up here: a require() in the body hides them
// and yields `any`.

/** NUMERIC as a number: we compute in ten-thousandths (src/infra/geld.ts). Up to 2^53/10^4
 * Math.round(n × 10^4) hits the value exactly (NUMERIC(12,4) reaches 10^8); above that it throws instead of rounding silently. */
export function numericAsNumber(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  if (Math.abs(n) >= EXACT_UNTIL) throw new RangeError(`NUMERIC ${v} ist in Zehntausendsteln nicht mehr genau`);
  return n;
}
const EXACT_UNTIL = Number.MAX_SAFE_INTEGER / 10_000;
pgTypes.setTypeParser(pgTypes.builtins.NUMERIC, numericAsNumber);

// At most two processes (web and jobs) with 15 connections each: far below
// max_connections, with room for tools and the CSV import process.
const DEFAULT_POOL = 15;

/** What a connection needs; the process reads it once and passes it on. */
export interface DbConfig {
  verbindung: PoolConfig;
  pool: PoolConfig;
  /** The system role for the system frame; without it the frame runs over `verbindung`. */
  system?: PoolConfig | null;
  /** The system role for the system frame of HTTP requests (access tables only); without it `system`. */
  systemWeb?: PoolConfig | null;
  /** In tests a fallback value inside a transaction throws even outside the database (src/infra/error.ts). */
  streng?: boolean;
  /** The time zone of the entry day, written into the database at startup (schemaStart.ts). */
  entryTimeZone?: string;
}

/** What the body of a transaction gets: its queries and an access `db` over its
 * connection, from which the context `t` is built. */
export interface TxGriff extends TxHandleOf<Db> {}

export function dbKonfigFromEnvironment(): DbConfig {
  const K = konfig();
  return {
    verbindung: databaseConnection(),
    system: systemConnection(),
    systemWeb: systemWebConnection(),
    streng: K.nodeEnv === 'test',
    entryTimeZone: K.entryTimeZone,
    pool: {
      max: K.pgPoolMax ?? DEFAULT_POOL,
      min: K.pgPoolMin,
      idleTimeoutMillis: K.pgIdleMs,
      connectionTimeoutMillis: K.pgConnMs,
      // Via the connection options instead of per request. The time zone of the
      // entry day is stored in the database (writeEntryTimeZone).
      options: `-c statement_timeout=${K.pgStmtMs} -c idle_in_transaction_session_timeout=${K.pgIdleTxMs} -c lock_timeout=${K.pgSperreMs}`,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    },
  };
}

/** A row with the columns the caller reads; further ones travel along as `unknown`. */
export type Row<T extends object = object> = T & Record<string, unknown>;

// Named, so tx callbacks are type-checked.
export type { DbInterface };
export type { Hit as Treffer } from './types';

// Inside an outer transaction repeatAtConflict has no effect; there its option decides.
export type { TxOptions };
const TX_CONFLICT = new Set(['40P01', '40001']);
const TX_RETRIES = 2;

export interface Db extends DbInterface, Access<Db> {
  readonly pool: Pool;
  /** The pool of the system role; without a role of its own the same as `pool`. */
  readonly systemPool: Pool;
  /** The pool for the system frame of HTTP requests; without a role of its own the same as `systemPool`. */
  readonly systemWebPool: Pool;
  /** Whether the system frame really lifts row-level security (BYPASSRLS, ownership or superuser). */
  systemrahmenActs(): Promise<boolean>;
  /** LISTEN/NOTIFY of this access (db/pgNotify.ts); only listens on the first listen(). Inside a
   * transaction it sends over its connection: the signal takes effect with the COMMIT. */
  readonly notification: Signals;
  transaction<T>(fn: (tx: TxGriff) => Promise<T>, o?: TxOptions): Promise<T>;
  /** Whether this access is bound to a transaction or this call path holds one open. */
  inTransaction(): boolean;
  getPoolStats(): { total: number; idle: number; waiting: number; active: number };
  databaseResponds(): Promise<boolean>;
  asSuperuserConnected(): Promise<boolean>;
  ownConnection(): Promise<Client>;
  /** See withCommitCompanion (transaction.ts): applies to the transactions of this call path. */
  withCommitCompanion<T>(companion: (tx: DbInterface) => Promise<void>, work: () => T): T;
  initSchema(): Promise<boolean>;
  initSchemaOnce(): Promise<void>;
  /** Whether the connection may create schema objects: owner or superuser, not the runtime role. */
  changeMaySchema(): Promise<boolean>;
}

// SQL goes to PostgreSQL unchanged.

/** Pool of the runtime role and, if configured, of the system roles. */
function createPools(k: DbConfig): { pool: Pool; systemPool: Pool; systemWebPool: Pool } {
  // Pipeline: query() sends BEGIN with context, query and COMMIT at once, one round trip instead of three.
  const pool = new Pool({ ...k.verbindung, ...k.pool, pipeline: true });
  // Without a listener, the drop of an idle connection would bring down the process.
  pool.on('error', err => {
    console.error('[db-pool] idle client error:', err.message);
  });
  const weitere: Pool[] = [];
  const beside = (c: PoolConfig | null | undefined, name: string, otherwise: Pool): Pool => {
    if (!c) return otherwise;
    const p = new Pool({ ...k.pool, ...c });
    p.on('error', err => console.error(`[db-pool] idle client error (${name}):`, err.message));
    weitere.push(p);
    return p;
  };
  const systemPool = beside(k.system, 'System', pool);
  const systemWebPool = beside(k.systemWeb, 'System, Web', systemPool);
  if (weitere.length) {
    // Whoever closes the access closes pool; the system connections would otherwise keep the process alive.
    const close = pool.end.bind(pool);
    pool.end = (() => Promise.all([close(), ...weitere.map(p => p.end())]).then(() => undefined)) as Pool['end'];
  }
  return { pool, systemPool, systemWebPool };
}

/** What query() and oneTimeTransaction() need to know about their access. */
interface Frame {
  ich: object;
  pool: Pool;
  systemPool: Pool;
  systemWebPool: Pool;
  streng: boolean;
  /** The persistent access per connection (connectionAccess). */
  jeConnection: WeakMap<PoolClient, ConnectionSlot>;
}

function poolOfFrame(r: Frame): Pool {
  const { system, web } = rowsContext();
  return system ? (web ? r.systemWebPool : r.systemPool) : r.pool;
}

/** A transaction on the connection of the other role does not count; whoever switches the frame
 * in the middle of it would query over a second connection beside it (without its
 * state, possibly against its locks). That is an error: choose the frame before the transaction. */
function openTx(r: Frame): TxStand | null {
  const t = runningTx();
  return t?.offen && t.db === r.ich ? t : null;
}
function checkFrame(r: Frame, t: TxStand): void {
  if (t.pool !== poolOfFrame(r)) throw new BesideTheTransaction(t.pool !== r.pool);
}
/** The unbound access never queries into an open transaction of this path. */
function watch(r: Frame): void {
  const t = openTx(r);
  if (!t) return;
  checkFrame(r, t);
  throw new UnboundQuery();
}

/** Outside a transaction: without account and system frame directly over the
 * pool, otherwise in a short one of its own so set_config(…, true) applies and the
 * check before COMMIT (contextCheckSql) holds. The parts go out in the pipeline at once;
 * if the query fails, the COMMIT ends the aborted transaction as ROLLBACK. The
 * connection only goes back into the pool when idle, i.e. without context. */
async function query(r: Frame, sql: string, params?: unknown[]): Promise<QueryResult> {
  watch(r);
  const kontext = contextSql();
  const p = poolOfFrame(r);
  if (!kontext) return p.query(sql, params);
  const client = await p.connect();
  let kaputt: Error | undefined;
  const teardown = (e: Error) => {
    kaputt = e;
  };
  client.on('error', teardown);
  try {
    const [start, ergebnis, check, end] = await Promise.allSettled([
      client.query(`BEGIN; ${kontext}`),
      client.query(sql, params),
      client.query(contextCheckSql(kontext)),
      client.query('COMMIT'),
    ]);
    if (client.getTransactionStatus() !== 'I') kaputt ??= new Error('Verbindung nach COMMIT nicht im Leerlauf');
    for (const x of [start, ergebnis, check, end]) if (x.status === 'rejected') throw x.reason;
    return (ergebnis as PromiseFulfilledResult<QueryResult>).value;
  } finally {
    client.off('error', teardown);
    client.release(kaputt);
  }
}

async function oneTimeTransaction<T>(
  r: Frame,
  griff: (stand: TxStand) => TxGriff,
  fn: (tx: TxGriff) => Promise<T>,
): Promise<T> {
  const p = poolOfFrame(r);
  const client = await p.connect();
  const stand = newTxStatus({ client, db: r.ich, pool: p, streng: r.streng });
  let kaputt: Error | undefined;
  // If the connection drops in the middle of the transaction, the client reports that
  // as an 'error' event; without a listener it would end the whole process.
  const teardown = (e: Error) => {
    kaputt = e;
  };
  client.on('error', teardown);
  try {
    // The context in the same round trip as BEGIN; contextSync() follows changes afterwards.
    stand.kontext = contextSql();
    await client.query(stand.kontext ? `BEGIN; ${stand.kontext}` : 'BEGIN');
    const result = await inTransactionPath(stand, () => fn(griff(stand)));
    await commitCompanion()?.(griff(stand));
    stand.offen = false;
    if (!rowsContext().system) await client.query(contextCheckSql(stand.kontext));
    await client.query('COMMIT');
    return result;
  } catch (e) {
    stand.offen = false;
    // If the ROLLBACK fails as well, the connection is broken: it must not
    // go back into the pool, and the error that caused it is reported.
    try {
      await client.query('ROLLBACK');
    } catch (rb) {
      kaputt = rb instanceof Error ? rb : new Error(String(rb));
    }
    throw e;
  } finally {
    client.off('error', teardown);
    client.release(kaputt);
  }
}

/** The locks before the body, in the same transaction. */
function lockWith<T>(body: (tx: TxGriff) => Promise<T>, lock?: readonly HoldingLock[]) {
  if (!lock?.length) return body;
  return async (tx: TxGriff) => {
    await lockInventories(tx, lock);
    return body(tx);
  };
}

async function withRetry<T>(once: () => Promise<T>, o: TxOptions): Promise<T> {
  for (let versuch = 0; ; versuch++) {
    try {
      return await once();
    } catch (e) {
      if (!o.repeatAtConflict || versuch >= TX_RETRIES || !TX_CONFLICT.has(errorCode(e) ?? '')) throw e;
      // Staggered, so the contenders do not meet again in lockstep.
      await new Promise(res => setTimeout(res, 25 * (versuch + 1) + Math.random() * 50));
    }
  }
}

/** The handle of a transaction or one of its savepoints (`punkt`): queries over
 * its connection and an access on top; a transaction inside it becomes a savepoint. */
function griff(r: Frame, access: Db, counter: { savepoints: number }, stand: TxStand, point: string | null): TxGriff {
  const q = txQueries(stand, () => checkFrame(r, stand));
  if (point === null) return { ...q, db: connectionAccess(r, access, counter, stand) };
  const tdb: Db = {
    ...access,
    ...q,
    transaction: (fn, o = {}) =>
      innerTransaction(stand, point, ++counter.savepoints, name =>
        lockWith(fn, o.sperren)(griff(r, access, counter, stand, name)),
      ),
    notification: access.notification.over(q.run),
    inTransaction: () => true,
  };
  return { ...q, db: tdb };
}

/** Per connection one persistent access for the outermost level of its transaction: the areas
 * on top of it (Bereich.ueber) are built once per connection instead of per transaction (measured a good 1 ms
 * per transaction). It queries over the transaction currently running on the connection, and only from
 * its call path; a straggler of an earlier one gets TransactionEnded. */
interface ConnectionSlot {
  stand: TxStand | null;
  q: DbInterface | null;
  db: Db;
}
function connectionAccess(r: Frame, access: Db, counter: { savepoints: number }, stand: TxStand): Db {
  const da = r.jeConnection.get(stand.client);
  const slot = da ?? newSpace(r, access, counter);
  if (!da) r.jeConnection.set(stand.client, slot);
  slot.stand = stand;
  slot.q = txQueries(stand, () => checkFrame(r, stand));
  return slot.db;
}

function newSpace(r: Frame, access: Db, counter: { savepoints: number }): ConnectionSlot {
  const active = (): { stand: TxStand; q: DbInterface } => {
    const { stand, q } = slot;
    if (!stand || !q || runningTx() !== stand) throw new TransactionEnded();
    return { stand, q };
  };
  const q: DbInterface = {
    all: (sql, p) => active().q.all(sql, p),
    get: (sql, p) => active().q.get(sql, p),
    run: (sql, p) => active().q.run(sql, p),
    exec: sql => active().q.exec(sql),
  };
  const slot: ConnectionSlot = {
    stand: null,
    q: null,
    db: {
      ...access,
      ...q,
      transaction: (fn, o = {}) => {
        const { stand } = active();
        return innerTransaction(stand, null, ++counter.savepoints, name =>
          lockWith(fn, o.sperren)(griff(r, access, counter, stand, name)),
        );
      },
      notification: access.notification.over(q.run),
      inTransaction: () => true,
    },
  };
  return slot;
}

/** An access to the database with a pool of its own. The pool is created here, not
 * on import: whoever knows the address calls the factory. */
export function createDb(k: DbConfig, o: { firstStart?: FirstStart } = {}): Db {
  const { pool, systemPool, systemWebPool } = createPools(k);
  const r: Frame = {
    ich: {},
    pool,
    systemPool,
    systemWebPool,
    streng: k.streng === true,
    jeConnection: new WeakMap(),
  };
  const counter = { savepoints: 0 };

  /** All rows of a query. T is unchecked: the caller says which
   * columns its SQL returns; without that it stays `unknown`. */
  async function all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    watch(r);
    return queryWithRetry(async () => (await query(r, sql, params)).rows, isReading(sql));
  }
  async function get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await all<T>(sql, params))[0];
  }
  /** Whoever needs the new id writes RETURNING and reads with get(). */
  async function run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    watch(r);
    return queryWithRetry(async () => ({ changes: (await query(r, sql, params)).rowCount || 0 }), false);
  }
  async function transaction<T>(body: (tx: TxGriff) => Promise<T>, opt: TxOptions = {}): Promise<T> {
    watch(r);
    return withRetry(
      () => oneTimeTransaction(r, stand => griff(r, access, counter, stand, null), lockWith(body, opt.sperren)),
      opt,
    );
  }

  /** An OWN connection that does NOT come from the pool. */
  async function ownConnection() {
    const c = new Client({ ...k.verbindung });
    await c.connect();
    return c;
  }
  const dieBasis = () => initSchema(ownConnection, o.firstStart);

  const access: Db = {
    pool,
    systemPool,
    systemWebPool,
    systemrahmenActs: async () =>
      (
        await systemPool.query<{ frei: boolean }>(
          `SELECT r.rolsuper OR r.rolbypassrls OR pg_has_role(current_user, c.relowner, 'USAGE') AS frei
             FROM pg_roles r, pg_class c WHERE r.rolname = current_user AND c.oid = 'public.sets'::regclass`,
        )
      ).rows[0]?.frei === true,
    all,
    get,
    run,
    exec: async (sql: string) => {
      await query(r, sql);
    },
    transaction,
    initSchema: dieBasis,
    initSchemaOnce: () =>
      initSchemaOnce(
        pool,
        dieBasis,
        k.entryTimeZone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
        systemPool,
      ),
    ownConnection,
    withCommitCompanion,
    notification: new Notification(k.verbindung, (sql, p) => run(sql, p)),
    changeMaySchema: async () => (await get<{ d: boolean }>(MAY_SCHEMA_CHANGE))?.d === true,
    inTransaction: () => openTx(r) !== null,
    getPoolStats: () => ({
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      active: pool.totalCount - pool.idleCount,
    }),
    databaseResponds: () =>
      pool.query('SELECT 1').then(
        () => true,
        (e: unknown) => {
          reportError('health:ready', e);
          return false;
        },
      ),
    // What matters is the role of the requests, even if startup asks in the system frame.
    asSuperuserConnected: async () =>
      !!(await pool.query<{ s: boolean }>('SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user')).rows[0]
        ?.s,
  };
  return access;
}
