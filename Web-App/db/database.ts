/** Der Zugang zu PostgreSQL: Pool, Abfragen, Transaktionen. Stand der Transaktion in
 * transaction.ts, Wiederholung in retry.ts, Erststart in schemaStart.ts. */

import { Pool, types as pgTypes, Client } from 'pg';
import type { PoolClient, PoolConfig, QueryResult } from 'pg';
import { Benachrichtigung, type Signale } from './pgNotify';
import type { DbInterface } from './types';
import { fehlerCode, reportError } from '../src/infra/error';
import { konfig, databaseConnection, systemConnection, systemWebConnection } from '../src/infra/config';
import { queryWithRetry, isReading } from './retry';
import { inTransactionPath, rowsContext } from '../src/infra/accountContext';
import {
  runningTx,
  contextSql,
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
import { initSchema, initSchemaOnce, MAY_SCHEMA_CHANGE, type Erststart } from './schemaStart';
import { lockInventories } from './txLock';
import type { Bestandssperre, TxOptions, Zugang } from '../src/infra/access';

export { queryWithRetry, isReading } from './retry';
export {
  withCommitCompanion,
  TransactionEnded,
  BesideTheTransaction,
  UnboundQuery,
  ConcurrentSavepoint,
} from './transaction';
export type { Erststart } from './schemaStart';

// Alle Abhängigkeiten stehen hier oben: Ein require() im Rumpf versteckt sie
// und liefert `any`.

/** NUMERIC als Zahl: Gerechnet wird in Zehntausendsteln (src/infra/geld.ts). Bis 2^53/10^4 trifft
 * Math.round(n × 10^4) den Wert genau (NUMERIC(12,4) reicht bis 10^8); darüber wirft er, statt still zu runden. */
export function numericAsNumber(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  if (Math.abs(n) >= EXACT_UNTIL) throw new RangeError(`NUMERIC ${v} ist in Zehntausendsteln nicht mehr genau`);
  return n;
}
const EXACT_UNTIL = Number.MAX_SAFE_INTEGER / 10_000;
pgTypes.setTypeParser(pgTypes.builtins.NUMERIC, numericAsNumber);

// Höchstens zwei Prozesse (web und jobs) mit je 15 Verbindungen: weit unter
// max_connections, mit Luft für Werkzeuge und den CSV-Importprozess.
const DEFAULT_POOL = 15;

/** Was eine Verbindung braucht; der Prozess liest es einmal und reicht es weiter. */
export interface DbKonfig {
  verbindung: PoolConfig;
  pool: PoolConfig;
  /** Die Systemrolle für den Systemrahmen; ohne sie läuft er über `verbindung`. */
  system?: PoolConfig | null;
  /** Die Systemrolle für den Systemrahmen von HTTP-Anfragen (nur Zugangstabellen); ohne sie `system`. */
  systemWeb?: PoolConfig | null;
  /** In Tests wirft ein Ersatzwert in einer Transaktion auch ausserhalb der Datenbank (src/infra/error.ts). */
  streng?: boolean;
  /** Die Zeitzone des Erfassungstags, beim Start in die Datenbank geschrieben (schemaStart.ts). */
  entryTimeZone?: string;
}

/** Was der Rumpf einer Transaktion bekommt: ihre Abfragen und einen Zugang `db` über ihrer
 * Verbindung, aus dem der Kontext `t` entsteht. */
export interface TxGriff extends TxHandleOf<Db> {}

export function dbKonfigFromEnvironment(): DbKonfig {
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
      // Über die Verbindungsoptionen statt je Anfrage. Die Zeitzone des
      // Erfassungstags steht in der Datenbank (writeEntryTimeZone).
      options: `-c statement_timeout=${K.pgStmtMs} -c idle_in_transaction_session_timeout=${K.pgIdleTxMs} -c lock_timeout=${K.pgSperreMs}`,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    },
  };
}

/** Eine Zeile mit den Spalten, die der Aufrufer liest; weitere reisen als `unknown` mit. */
export type Zeile<T extends object = object> = T & Record<string, unknown>;

// Benannt, damit tx-Rückrufe geprüft werden.
export type { DbInterface };
export type { Treffer } from './types';

// In einer äusseren Transaktion ist repeatAtConflict ohne Wirkung; dort entscheidet deren Option.
export type { TxOptions };
const TX_CONFLICT = new Set(['40P01', '40001']);
const TX_RETRIES = 2;

export interface Db extends DbInterface, Zugang<Db> {
  readonly pool: Pool;
  /** Der Pool der Systemrolle, ohne eigene Rolle derselbe wie `pool`. */
  readonly systemPool: Pool;
  /** Der Pool für den Systemrahmen von HTTP-Anfragen, ohne eigene Rolle derselbe wie `systemPool`. */
  readonly systemWebPool: Pool;
  /** Ob der Systemrahmen den Zeilenschutz wirklich aufhebt (BYPASSRLS, Eigentum oder Superuser). */
  systemrahmenActs(): Promise<boolean>;
  /** LISTEN/NOTIFY dieses Zugangs (db/pgNotify.ts); horcht erst beim ersten listen(). In einer
   * Transaktion sendet sie über deren Verbindung: Das Signal gilt mit dem COMMIT. */
  readonly notification: Signale;
  transaction<T>(fn: (tx: TxGriff) => Promise<T>, o?: TxOptions): Promise<T>;
  /** Ob dieser Zugang an einer Transaktion hängt oder dieser Aufrufpfad eine offen hält. */
  inTransaction(): boolean;
  getPoolStats(): { total: number; idle: number; waiting: number; active: number };
  databaseResponds(): Promise<boolean>;
  asSuperuserConnected(): Promise<boolean>;
  ownConnection(): Promise<Client>;
  /** Siehe withCommitCompanion (transaction.ts): gilt für die Transaktionen dieses Aufrufpfads. */
  withCommitCompanion<T>(companion: (tx: DbInterface) => Promise<void>, work: () => T): T;
  initSchema(): Promise<boolean>;
  initSchemaOnce(): Promise<void>;
  /** Ob die Verbindung Schema-Objekte anlegen darf: Eigentümerin oder Superuser, nicht die Laufzeitrolle. */
  changeMaySchema(): Promise<boolean>;
}

// SQL geht unverändert an PostgreSQL.

/** Pool der Laufzeitrolle und, wenn konfiguriert, der Systemrollen. */
function createPools(k: DbKonfig): { pool: Pool; systemPool: Pool; systemWebPool: Pool } {
  // Pipeline: abfrage() schickt BEGIN mit Kontext, Abfrage und COMMIT zugleich, ein Roundtrip statt drei.
  const pool = new Pool({ ...k.verbindung, ...k.pool, pipeline: true });
  // Ohne Lauscher brächte der Abriss einer ruhenden Verbindung den Prozess zu Fall.
  pool.on('error', err => {
    console.error('[db-pool] idle client error:', err.message);
  });
  const weitere: Pool[] = [];
  const neben = (c: PoolConfig | null | undefined, name: string, sonst: Pool): Pool => {
    if (!c) return sonst;
    const p = new Pool({ ...k.pool, ...c });
    p.on('error', err => console.error(`[db-pool] idle client error (${name}):`, err.message));
    weitere.push(p);
    return p;
  };
  const systemPool = neben(k.system, 'System', pool);
  const systemWebPool = neben(k.systemWeb, 'System, Web', systemPool);
  if (weitere.length) {
    // Wer den Zugang schliesst, schliesst pool; die Systemverbindungen hielten den Prozess sonst offen.
    const schliesse = pool.end.bind(pool);
    pool.end = (() => Promise.all([schliesse(), ...weitere.map(p => p.end())]).then(() => undefined)) as Pool['end'];
  }
  return { pool, systemPool, systemWebPool };
}

/** Was abfrage() und oneTimeTransaction() über ihren Zugang wissen müssen. */
interface Rahmen {
  ich: object;
  pool: Pool;
  systemPool: Pool;
  systemWebPool: Pool;
  streng: boolean;
  /** Der beständige Zugang je Verbindung (connectionAccess). */
  jeConnection: WeakMap<PoolClient, Verbindungsplatz>;
}

function poolOfFrame(r: Rahmen): Pool {
  const { system, web } = rowsContext();
  return system ? (web ? r.systemWebPool : r.systemPool) : r.pool;
}

/** Eine Transaktion auf der Verbindung der anderen Rolle gilt nicht; wer mitten in
 * ihr den Rahmen wechselt, fragte über eine zweite Verbindung neben ihr (ohne ihren
 * Stand, womöglich gegen ihre Sperren). Das ist ein Fehler: Rahmen vor der Transaktion wählen. */
function openTx(r: Rahmen): TxStand | null {
  const t = runningTx();
  return t?.offen && t.db === r.ich ? t : null;
}
function checkFrame(r: Rahmen, t: TxStand): void {
  if (t.pool !== poolOfFrame(r)) throw new BesideTheTransaction(t.pool !== r.pool);
}
/** Der ungebundene Zugang fragt nie in eine offene Transaktion dieses Pfads hinein. */
function wache(r: Rahmen): void {
  const t = openTx(r);
  if (!t) return;
  checkFrame(r, t);
  throw new UnboundQuery();
}

/** Ausserhalb einer Transaktion: ohne Konto und Systemrahmen direkt über den
 * Pool, sonst in einer kurzen eigenen, damit set_config(…, true) gilt. Die drei
 * Teile gehen in der Pipeline zugleich hinaus; scheitert die Abfrage, beendet das
 * COMMIT die abgebrochene Transaktion als ROLLBACK. Zurück in den Pool geht die
 * Verbindung nur im Leerlauf, also ohne Kontext. */
async function abfrage(r: Rahmen, sql: string, params?: unknown[]): Promise<QueryResult> {
  wache(r);
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
    const [anfang, ergebnis, ende] = await Promise.allSettled([
      client.query(`BEGIN; ${kontext}`),
      client.query(sql, params),
      client.query('COMMIT'),
    ]);
    if (client.getTransactionStatus() !== 'I') kaputt ??= new Error('Verbindung nach COMMIT nicht im Leerlauf');
    for (const x of [anfang, ergebnis, ende]) if (x.status === 'rejected') throw x.reason;
    return (ergebnis as PromiseFulfilledResult<QueryResult>).value;
  } finally {
    client.off('error', teardown);
    client.release(kaputt);
  }
}

async function oneTimeTransaction<T>(
  r: Rahmen,
  griff: (stand: TxStand) => TxGriff,
  fn: (tx: TxGriff) => Promise<T>,
): Promise<T> {
  const p = poolOfFrame(r);
  const client = await p.connect();
  const stand = newTxStatus({ client, db: r.ich, pool: p, streng: r.streng });
  let kaputt: Error | undefined;
  // Reisst die Verbindung mitten in der Transaktion ab, meldet der Client das
  // als 'error'-Ereignis; ohne Zuhörer beendete es den ganzen Prozess.
  const teardown = (e: Error) => {
    kaputt = e;
  };
  client.on('error', teardown);
  try {
    // Der Kontext im selben Roundtrip wie BEGIN; contextSync() folgt danach Wechseln.
    stand.kontext = contextSql();
    await client.query(stand.kontext ? `BEGIN; ${stand.kontext}` : 'BEGIN');
    const result = await inTransactionPath(stand, () => fn(griff(stand)));
    await commitCompanion()?.(griff(stand));
    stand.offen = false;
    await client.query('COMMIT');
    return result;
  } catch (e) {
    stand.offen = false;
    // Scheitert auch das ROLLBACK, ist die Verbindung kaputt: Sie darf nicht
    // in den Pool zurück, und gemeldet wird der Fehler, der es ausgelöst hat.
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

/** Die Sperren vor dem Rumpf, in derselben Transaktion. */
function lockWith<T>(rumpf: (tx: TxGriff) => Promise<T>, sperren?: readonly Bestandssperre[]) {
  if (!sperren?.length) return rumpf;
  return async (tx: TxGriff) => {
    await lockInventories(tx, sperren);
    return rumpf(tx);
  };
}

async function withRetry<T>(einmal: () => Promise<T>, o: TxOptions): Promise<T> {
  for (let versuch = 0; ; versuch++) {
    try {
      return await einmal();
    } catch (e) {
      if (!o.repeatAtConflict || versuch >= TX_RETRIES || !TX_CONFLICT.has(fehlerCode(e) ?? '')) throw e;
      // Versetzt, damit die Gegenspieler nicht im Gleichschritt wieder aufeinandertreffen.
      await new Promise(res => setTimeout(res, 25 * (versuch + 1) + Math.random() * 50));
    }
  }
}

/** Der Griff einer Transaktion oder eines ihrer Sicherungspunkte (`punkt`): Abfragen über
 * ihre Verbindung und ein Zugang darüber; eine Transaktion in ihm wird ein Sicherungspunkt. */
function griff(r: Rahmen, zugang: Db, zaehler: { savepoints: number }, stand: TxStand, punkt: string | null): TxGriff {
  const q = txQueries(stand, () => checkFrame(r, stand));
  if (punkt === null) return { ...q, db: connectionAccess(r, zugang, zaehler, stand) };
  const tdb: Db = {
    ...zugang,
    ...q,
    transaction: (fn, o = {}) =>
      innerTransaction(stand, punkt, ++zaehler.savepoints, name =>
        lockWith(fn, o.sperren)(griff(r, zugang, zaehler, stand, name)),
      ),
    notification: zugang.notification.ueber(q.run),
    inTransaction: () => true,
  };
  return { ...q, db: tdb };
}

/** Je Verbindung ein beständiger Zugang für die äusserste Ebene ihrer Transaktion: Die Bereiche
 * über ihm (Bereich.ueber) entstehen einmal je Verbindung statt je Transaktion (gemessen gut 1 ms
 * je Transaktion). Er fragt über die Transaktion, die gerade auf der Verbindung läuft, und nur aus
 * deren Aufrufpfad; ein Nachzügler einer früheren bekommt TransactionEnded. */
interface Verbindungsplatz {
  stand: TxStand | null;
  q: DbInterface | null;
  db: Db;
}
function connectionAccess(r: Rahmen, zugang: Db, zaehler: { savepoints: number }, stand: TxStand): Db {
  const da = r.jeConnection.get(stand.client);
  const platz = da ?? newSpace(r, zugang, zaehler);
  if (!da) r.jeConnection.set(stand.client, platz);
  platz.stand = stand;
  platz.q = txQueries(stand, () => checkFrame(r, stand));
  return platz.db;
}

function newSpace(r: Rahmen, zugang: Db, zaehler: { savepoints: number }): Verbindungsplatz {
  const aktiv = (): { stand: TxStand; q: DbInterface } => {
    const { stand, q } = platz;
    if (!stand || !q || runningTx() !== stand) throw new TransactionEnded();
    return { stand, q };
  };
  const q: DbInterface = {
    all: (sql, p) => aktiv().q.all(sql, p),
    get: (sql, p) => aktiv().q.get(sql, p),
    run: (sql, p) => aktiv().q.run(sql, p),
    exec: sql => aktiv().q.exec(sql),
  };
  const platz: Verbindungsplatz = {
    stand: null,
    q: null,
    db: {
      ...zugang,
      ...q,
      transaction: (fn, o = {}) => {
        const { stand } = aktiv();
        return innerTransaction(stand, null, ++zaehler.savepoints, name =>
          lockWith(fn, o.sperren)(griff(r, zugang, zaehler, stand, name)),
        );
      },
      notification: zugang.notification.ueber(q.run),
      inTransaction: () => true,
    },
  };
  return platz;
}

/** Ein Zugang zur Datenbank mit eigenem Pool. Der Pool entsteht hier, nicht
 * beim Import: Wer die Adresse kennt, ruft die Fabrik. */
export function createDb(k: DbKonfig, o: { firstStart?: Erststart } = {}): Db {
  const { pool, systemPool, systemWebPool } = createPools(k);
  const r: Rahmen = {
    ich: {},
    pool,
    systemPool,
    systemWebPool,
    streng: k.streng === true,
    jeConnection: new WeakMap(),
  };
  const zaehler = { savepoints: 0 };

  /** Alle Zeilen einer Abfrage. T ist ungeprüft: Der Aufrufer sagt, welche
   * Spalten sein SQL liefert; ohne Angabe bleibt es `unknown`. */
  async function all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    wache(r);
    return queryWithRetry(async () => (await abfrage(r, sql, params)).rows, isReading(sql));
  }
  async function get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await all<T>(sql, params))[0];
  }
  /** Wer die neue id braucht, schreibt RETURNING und liest mit get(). */
  async function run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    wache(r);
    return queryWithRetry(async () => ({ changes: (await abfrage(r, sql, params)).rowCount || 0 }), false);
  }
  async function transaction<T>(rumpf: (tx: TxGriff) => Promise<T>, opt: TxOptions = {}): Promise<T> {
    wache(r);
    return withRetry(
      () => oneTimeTransaction(r, stand => griff(r, zugang, zaehler, stand, null), lockWith(rumpf, opt.sperren)),
      opt,
    );
  }

  /** Eine EIGENE Verbindung, die NICHT aus dem Pool kommt. */
  async function ownConnection() {
    const c = new Client({ ...k.verbindung });
    await c.connect();
    return c;
  }
  const dieBasis = () => initSchema(ownConnection, o.firstStart);

  const zugang: Db = {
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
      await abfrage(r, sql);
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
    notification: new Benachrichtigung(k.verbindung, (sql, p) => run(sql, p)),
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
    // Gefragt ist die Rolle der Anfragen, auch wenn der Start im Systemrahmen fragt.
    asSuperuserConnected: async () =>
      !!(await pool.query<{ s: boolean }>('SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user')).rows[0]
        ?.s,
  };
  return zugang;
}
