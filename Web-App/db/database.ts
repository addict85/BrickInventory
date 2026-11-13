/** Der Zugang zu PostgreSQL: Pool, Abfragen, Transaktionen. Stand der Transaktion in
 * transaktion.ts, Wiederholung in wiederholung.ts, Erststart in schemaStart.ts. */

import { Pool, types as pgTypes, Client } from 'pg';
import type { PoolConfig, QueryResult } from 'pg';
import { Benachrichtigung } from './pgNotify';
import type { DbSchnittstelle } from './typen';
import { fehlerCode, meldeFehler } from '../src/infra/fehler';
import { konfig, datenbankVerbindung, systemVerbindung } from '../src/infra/konfig';
import { zeilenKontext } from '../src/infra/kontoKontext';
import { queryWithRetry, istLesend } from './wiederholung';
import {
  laufendeTx,
  kontextSql,
  kontextAbgleich,
  txSchnittstelle,
  commitBegleiter,
  mitCommitBegleiter,
  innereTransaktion,
  NebenDerTransaktion,
  type TxStand,
} from './transaktion';
import { initSchema, initSchemaOnce, DARF_SCHEMA_AENDERN, type Erststart } from './schemaStart';

export { queryWithRetry, istLesend } from './wiederholung';
export {
  mitCommitBegleiter,
  TransaktionBeendet,
  NebenDerTransaktion,
  GleichzeitigerSicherungspunkt,
} from './transaktion';
export type { Erststart } from './schemaStart';

// Alle Abhängigkeiten stehen hier oben: Ein require() im Rumpf versteckt sie
// und liefert `any`.

// NUMERIC als Zahl: NUMERIC(12,4) bleibt weit unter 2^53, gerechnet wird in
// src/infra/geld.ts in Zehntausendsteln.
pgTypes.setTypeParser(pgTypes.builtins.NUMERIC, (v: string | null) => (v === null ? null : parseFloat(v)));

// Höchstens zwei Prozesse (web und jobs) mit je 15 Verbindungen: weit unter
// max_connections, mit Luft für Werkzeuge und den CSV-Importprozess.
const VORGABE_POOL = 15;

/** Was eine Verbindung braucht; der Prozess liest es einmal und reicht es weiter. */
export interface DbKonfig {
  verbindung: PoolConfig;
  pool: PoolConfig;
  /** Die Systemrolle für den Systemrahmen; ohne sie läuft er über `verbindung`. */
  system?: PoolConfig | null;
}

export function dbKonfigAusUmgebung(): DbKonfig {
  const K = konfig();
  return {
    verbindung: datenbankVerbindung(),
    system: systemVerbindung(),
    pool: {
      max: K.pgPoolMax ?? VORGABE_POOL,
      min: K.pgPoolMin,
      idleTimeoutMillis: K.pgIdleMs,
      connectionTimeoutMillis: K.pgConnMs,
      // Über die Verbindungsoptionen statt je Anfrage. Die Zeitzone des
      // Erfassungstags steht in der Datenbank (schreibeErfassungsZeitzone).
      options: `-c statement_timeout=${K.pgStmtMs} -c idle_in_transaction_session_timeout=${K.pgLeerlaufTxMs} -c lock_timeout=${K.pgSperreMs}`,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    },
  };
}

/** Eine Zeile mit den Spalten, die der Aufrufer liest; weitere reisen als `unknown` mit. */
export type Zeile<T extends object = object> = T & Record<string, unknown>;

// Benannt, damit tx-Rückrufe geprüft werden.
export type { DbSchnittstelle };

export interface TxOptionen {
  /** Bei Deadlock (40P01) oder Serialisierungsfehler (40001) die ganze Transaktion
   * bis zu zweimal neu beginnen. Nur für Rümpfe ohne Wirkung nach aussen (Netz,
   * Dateien, Mails): Sie laufen dann mehrfach. In einer äusseren Transaktion
   * ohne Wirkung; dort entscheidet deren Option. */
  wiederholeBeiKonflikt?: boolean;
}
const TX_KONFLIKT = new Set(['40P01', '40001']);
const TX_NEUVERSUCHE = 2;

export interface Db extends DbSchnittstelle {
  readonly pool: Pool;
  /** Der Pool der Systemrolle, ohne eigene Rolle derselbe wie `pool`. */
  readonly systemPool: Pool;
  /** Ob der Systemrahmen den Zeilenschutz wirklich aufhebt (BYPASSRLS, Eigentum oder Superuser). */
  systemrahmenWirkt(): Promise<boolean>;
  /** LISTEN/NOTIFY dieses Zugangs (db/pgNotify.ts); horcht erst beim ersten listen(). */
  readonly benachrichtigung: Benachrichtigung;
  transaction<T>(fn: (tx: DbSchnittstelle) => Promise<T>, o?: TxOptionen): Promise<T>;
  inTransaktion(): boolean;
  getPoolStats(): { total: number; idle: number; waiting: number; active: number };
  datenbankAntwortet(): Promise<boolean>;
  alsSuperuserVerbunden(): Promise<boolean>;
  eigeneVerbindung(): Promise<Client>;
  /** Siehe mitCommitBegleiter (transaktion.ts): gilt für die Transaktionen dieses Aufrufpfads. */
  mitCommitBegleiter<T>(begleiter: (tx: DbSchnittstelle) => Promise<void>, arbeit: () => T): T;
  initSchema(): Promise<boolean>;
  initSchemaOnce(): Promise<void>;
  /** Ob die Verbindung Schema-Objekte anlegen darf: Eigentümerin oder Superuser, nicht die Laufzeitrolle. */
  darfSchemaAendern(): Promise<boolean>;
}

// SQL geht unverändert an PostgreSQL.

/** Ein Zugang zur Datenbank mit eigenem Pool. Der Pool entsteht hier, nicht
 * beim Import: Wer die Adresse kennt, ruft die Fabrik. */
export function erzeugeDb(k: DbKonfig, o: { erststart?: Erststart } = {}): Db {
  // Pipeline: abfrage() schickt BEGIN mit Kontext, Abfrage und COMMIT zugleich, ein Roundtrip statt drei.
  const pool = new Pool({ ...k.verbindung, ...k.pool, pipeline: true });
  // Ohne Lauscher brächte der Abriss einer ruhenden Verbindung den Prozess zu Fall.
  pool.on('error', err => {
    console.error('[db-pool] idle client error:', err.message);
  });
  const systemPool = k.system ? new Pool({ ...k.pool, ...k.system }) : pool;
  if (systemPool !== pool) {
    systemPool.on('error', err => console.error('[db-pool] idle client error (System):', err.message));
    // Wer den Zugang schliesst, schliesst pool; die Systemverbindungen hielten den Prozess sonst offen.
    const schliesse = pool.end.bind(pool);
    pool.end = (() => Promise.all([schliesse(), systemPool.end()]).then(() => undefined)) as Pool['end'];
  }
  const ich = {};
  let sicherungspunkte = 0;
  const poolDesRahmens = (): Pool => (zeilenKontext().system ? systemPool : pool);
  /** Eine Transaktion auf der Verbindung der anderen Rolle gilt nicht; wer mitten in
   * ihr den Rahmen wechselt, fragte über eine zweite Verbindung neben ihr (ohne ihren
   * Stand, womöglich gegen ihre Sperren). Das ist ein Fehler: Rahmen vor der Transaktion wählen. */
  const offeneTx = (): TxStand | null => {
    const t = laufendeTx.getStore();
    return t?.offen && t.db === ich ? t : null;
  };
  const txStand = (): TxStand | null => {
    const t = offeneTx();
    if (t && t.pool !== poolDesRahmens()) throw new NebenDerTransaktion(t.pool === systemPool);
    return t;
  };

  /** Ausserhalb einer Transaktion: ohne Konto und Systemrahmen direkt über den
   * Pool, sonst in einer kurzen eigenen, damit set_config(…, true) gilt. Die drei
   * Teile gehen in der Pipeline zugleich hinaus; scheitert die Abfrage, beendet das
   * COMMIT die abgebrochene Transaktion als ROLLBACK. Zurück in den Pool geht die
   * Verbindung nur im Leerlauf, also ohne Kontext. */
  async function abfrage(sql: string, params?: unknown[]): Promise<QueryResult> {
    const stand = txStand();
    if (stand) {
      await kontextAbgleich(stand);
      return stand.client.query(sql, params);
    }
    const kontext = kontextSql();
    const p = poolDesRahmens();
    if (!kontext) return p.query(sql, params);
    const client = await p.connect();
    let kaputt: Error | undefined;
    const abriss = (e: Error) => {
      kaputt = e;
    };
    client.on('error', abriss);
    try {
      const [anfang, r, ende] = await Promise.allSettled([
        client.query(`BEGIN; ${kontext}`),
        client.query(sql, params),
        client.query('COMMIT'),
      ]);
      if (client.getTransactionStatus() !== 'I') kaputt ??= new Error('Verbindung nach COMMIT nicht im Leerlauf');
      for (const x of [anfang, r, ende]) if (x.status === 'rejected') throw x.reason;
      return (r as PromiseFulfilledResult<QueryResult>).value;
    } finally {
      client.off('error', abriss);
      client.release(kaputt);
    }
  }

  /** Alle Zeilen einer Abfrage. T ist ungeprüft: Der Aufrufer sagt, welche
   * Spalten sein SQL liefert; ohne Angabe bleibt es `unknown`. */
  async function all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (txStand()) return (await abfrage(sql, params)).rows as T[];
    return queryWithRetry(async () => (await abfrage(sql, params)).rows, istLesend(sql));
  }
  async function get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await all<T>(sql, params))[0];
  }
  /** Wer die neue id braucht, schreibt RETURNING und liest mit get(). */
  async function run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    if (txStand()) return { changes: (await abfrage(sql, params)).rowCount || 0 };
    return queryWithRetry(async () => ({ changes: (await abfrage(sql, params)).rowCount || 0 }), false);
  }
  async function exec(sql: string): Promise<void> {
    await abfrage(sql);
  }

  async function transaction<T>(fn: (tx: DbSchnittstelle) => Promise<T>, o: TxOptionen = {}): Promise<T> {
    const aussen = txStand();
    if (aussen) return innereTransaktion(aussen, ++sicherungspunkte, fn);
    for (let versuch = 0; ; versuch++) {
      try {
        return await einmaligeTransaktion(fn);
      } catch (e) {
        if (!o.wiederholeBeiKonflikt || versuch >= TX_NEUVERSUCHE || !TX_KONFLIKT.has(fehlerCode(e) ?? '')) throw e;
        // Versetzt, damit die Gegenspieler nicht im Gleichschritt wieder aufeinandertreffen.
        await new Promise(r => setTimeout(r, 25 * (versuch + 1) + Math.random() * 50));
      }
    }
  }

  async function einmaligeTransaktion<T>(fn: (tx: DbSchnittstelle) => Promise<T>): Promise<T> {
    const p = poolDesRahmens();
    const client = await p.connect();
    const stand: TxStand = { client, offen: true, db: ich, pool: p, innerster: null, kontext: '' };
    let kaputt: Error | undefined;
    // Reisst die Verbindung mitten in der Transaktion ab, meldet der Client das
    // als 'error'-Ereignis; ohne Zuhörer beendete es den ganzen Prozess.
    const abriss = (e: Error) => {
      kaputt = e;
    };
    client.on('error', abriss);
    try {
      // Der Kontext im selben Roundtrip wie BEGIN; kontextAbgleich() folgt danach Wechseln.
      stand.kontext = kontextSql();
      await client.query(stand.kontext ? `BEGIN; ${stand.kontext}` : 'BEGIN');
      const result = await laufendeTx.run(stand, () => fn(txSchnittstelle(stand)));
      await commitBegleiter.getStore()?.(txSchnittstelle(stand));
      stand.offen = false;
      await client.query('COMMIT');
      return result;
    } catch (e) {
      stand.offen = false;
      // Scheitert auch das ROLLBACK, ist die Verbindung kaputt: Sie darf nicht
      // in den Pool zurück, und gemeldet wird der Fehler, der es ausgelöst hat.
      try {
        await client.query('ROLLBACK');
      } catch (r) {
        kaputt = r instanceof Error ? r : new Error(String(r));
      }
      throw e;
    } finally {
      client.off('error', abriss);
      client.release(kaputt);
    }
  }

  /** Eine EIGENE Verbindung, die NICHT aus dem Pool kommt. */
  async function eigeneVerbindung() {
    const c = new Client({ ...k.verbindung });
    await c.connect();
    return c;
  }

  const dieBasis = () => initSchema(eigeneVerbindung, o.erststart);

  return {
    pool,
    systemPool,
    systemrahmenWirkt: async () =>
      (
        await systemPool.query<{ frei: boolean }>(
          `SELECT r.rolsuper OR r.rolbypassrls OR pg_has_role(current_user, c.relowner, 'USAGE') AS frei
             FROM pg_roles r, pg_class c WHERE r.rolname = current_user AND c.oid = 'public.sets'::regclass`,
        )
      ).rows[0]?.frei === true,
    all,
    get,
    run,
    exec,
    transaction,
    initSchema: dieBasis,
    initSchemaOnce: () => initSchemaOnce(pool, dieBasis),
    eigeneVerbindung,
    mitCommitBegleiter,
    benachrichtigung: new Benachrichtigung(k.verbindung, (sql, p) => run(sql, p)),
    darfSchemaAendern: async () => (await get<{ d: boolean }>(DARF_SCHEMA_AENDERN))?.d === true,
    inTransaktion: () => offeneTx() !== null,
    getPoolStats: () => ({
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      active: pool.totalCount - pool.idleCount,
    }),
    datenbankAntwortet: () =>
      pool.query('SELECT 1').then(
        () => true,
        (e: unknown) => {
          meldeFehler('health:ready', e);
          return false;
        },
      ),
    // Gefragt ist die Rolle der Anfragen, auch wenn der Start im Systemrahmen fragt.
    alsSuperuserVerbunden: async () =>
      !!(await pool.query<{ s: boolean }>('SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user')).rows[0]
        ?.s,
  };
}
