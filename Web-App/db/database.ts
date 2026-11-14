/** Der Zugang zu PostgreSQL: Pool, Abfragen, Transaktionen. Stand der Transaktion in
 * transaktion.ts, Wiederholung in wiederholung.ts, Erststart in schemaStart.ts. */

import { Pool, types as pgTypes, Client } from 'pg';
import type { PoolConfig, QueryResult } from 'pg';
import { Benachrichtigung, type Signale } from './pgNotify';
import type { DbSchnittstelle } from './typen';
import { fehlerCode, meldeFehler, setzeTransaktionsWaechter } from '../src/infra/fehler';
import { konfig, datenbankVerbindung, systemVerbindung } from '../src/infra/konfig';
import { queryWithRetry, istLesend } from './wiederholung';
import { inTransaktionsPfad, zeilenKontext } from '../src/infra/kontoKontext';
import {
  laufendeTx,
  kontextSql,
  txAbfragen,
  commitBegleiter,
  mitCommitBegleiter,
  innereTransaktion,
  NebenDerTransaktion,
  TRANSAKTIONS_WAECHTER,
  UngebundeneAbfrage,
  type TxGriffVon,
  type TxStand,
} from './transaktion';
import { initSchema, initSchemaOnce, DARF_SCHEMA_AENDERN, type Erststart } from './schemaStart';
import { sperreBestaende, type Bestandssperre } from './txLock';

export { queryWithRetry, istLesend } from './wiederholung';
export {
  mitCommitBegleiter,
  TransaktionBeendet,
  NebenDerTransaktion,
  UngebundeneAbfrage,
  GleichzeitigerSicherungspunkt,
} from './transaktion';
export type { Erststart } from './schemaStart';

// Alle Abhängigkeiten stehen hier oben: Ein require() im Rumpf versteckt sie
// und liefert `any`.

/** NUMERIC als Zahl: Gerechnet wird in Zehntausendsteln (src/infra/geld.ts). Bis 2^53/10^4 trifft
 * Math.round(n × 10^4) den Wert genau (NUMERIC(12,4) reicht bis 10^8); darüber wirft er, statt still zu runden. */
export function numericAlsZahl(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  if (Math.abs(n) >= GENAU_BIS) throw new RangeError(`NUMERIC ${v} ist in Zehntausendsteln nicht mehr genau`);
  return n;
}
const GENAU_BIS = Number.MAX_SAFE_INTEGER / 10_000;
pgTypes.setTypeParser(pgTypes.builtins.NUMERIC, numericAlsZahl);

// Höchstens zwei Prozesse (web und jobs) mit je 15 Verbindungen: weit unter
// max_connections, mit Luft für Werkzeuge und den CSV-Importprozess.
const VORGABE_POOL = 15;

/** Was eine Verbindung braucht; der Prozess liest es einmal und reicht es weiter. */
export interface DbKonfig {
  verbindung: PoolConfig;
  pool: PoolConfig;
  /** Die Systemrolle für den Systemrahmen; ohne sie läuft er über `verbindung`. */
  system?: PoolConfig | null;
  /** In Tests wirft ein Ersatzwert in einer Transaktion auch ausserhalb der Datenbank (src/infra/fehler.ts). */
  streng?: boolean;
  /** Die Zeitzone des Erfassungstags, beim Start in die Datenbank geschrieben (schemaStart.ts). */
  erfassungZeitzone?: string;
}

/** Was der Rumpf einer Transaktion bekommt: ihre Abfragen und einen Zugang `db` über ihrer
 * Verbindung, aus dem der Kontext `t` entsteht. */
export interface TxGriff extends TxGriffVon<Db> {}

export function dbKonfigAusUmgebung(): DbKonfig {
  const K = konfig();
  return {
    verbindung: datenbankVerbindung(),
    system: systemVerbindung(),
    streng: K.nodeEnv === 'test',
    erfassungZeitzone: K.erfassungZeitzone,
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
  /** Bestandssperren, vor dem Rumpf genommen (sperreBestaende, txLock.ts); sie halten bis
   * zum Ende der äussersten Transaktion. */
  sperren?: readonly Bestandssperre[];
}
const TX_KONFLIKT = new Set(['40P01', '40001']);
const TX_NEUVERSUCHE = 2;

export interface Db extends DbSchnittstelle {
  readonly pool: Pool;
  /** Der Pool der Systemrolle, ohne eigene Rolle derselbe wie `pool`. */
  readonly systemPool: Pool;
  /** Ob der Systemrahmen den Zeilenschutz wirklich aufhebt (BYPASSRLS, Eigentum oder Superuser). */
  systemrahmenWirkt(): Promise<boolean>;
  /** LISTEN/NOTIFY dieses Zugangs (db/pgNotify.ts); horcht erst beim ersten listen(). In einer
   * Transaktion sendet sie über deren Verbindung: Das Signal gilt mit dem COMMIT. */
  readonly benachrichtigung: Signale;
  transaction<T>(fn: (tx: TxGriff) => Promise<T>, o?: TxOptionen): Promise<T>;
  /** Ob dieser Zugang an einer Transaktion hängt oder dieser Aufrufpfad eine offen hält. */
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

/** Pool der Laufzeitrolle und, wenn konfiguriert, der Systemrolle. */
function erzeugePools(k: DbKonfig): { pool: Pool; systemPool: Pool } {
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
  return { pool, systemPool };
}

/** Was abfrage() und einmaligeTransaktion() über ihren Zugang wissen müssen. */
interface Rahmen {
  ich: object;
  pool: Pool;
  systemPool: Pool;
  streng: boolean;
}

const poolDesRahmens = (r: Rahmen): Pool => (zeilenKontext().system ? r.systemPool : r.pool);

/** Eine Transaktion auf der Verbindung der anderen Rolle gilt nicht; wer mitten in
 * ihr den Rahmen wechselt, fragte über eine zweite Verbindung neben ihr (ohne ihren
 * Stand, womöglich gegen ihre Sperren). Das ist ein Fehler: Rahmen vor der Transaktion wählen. */
function offeneTx(r: Rahmen): TxStand | null {
  const t = laufendeTx();
  return t?.offen && t.db === r.ich ? t : null;
}
function pruefeRahmen(r: Rahmen, t: TxStand): void {
  if (t.pool !== poolDesRahmens(r)) throw new NebenDerTransaktion(t.pool === r.systemPool);
}
/** Der ungebundene Zugang fragt nie in eine offene Transaktion dieses Pfads hinein. */
function wache(r: Rahmen): void {
  const t = offeneTx(r);
  if (!t) return;
  pruefeRahmen(r, t);
  throw new UngebundeneAbfrage();
}

/** Ausserhalb einer Transaktion: ohne Konto und Systemrahmen direkt über den
 * Pool, sonst in einer kurzen eigenen, damit set_config(…, true) gilt. Die drei
 * Teile gehen in der Pipeline zugleich hinaus; scheitert die Abfrage, beendet das
 * COMMIT die abgebrochene Transaktion als ROLLBACK. Zurück in den Pool geht die
 * Verbindung nur im Leerlauf, also ohne Kontext. */
async function abfrage(r: Rahmen, sql: string, params?: unknown[]): Promise<QueryResult> {
  wache(r);
  const kontext = kontextSql();
  const p = poolDesRahmens(r);
  if (!kontext) return p.query(sql, params);
  const client = await p.connect();
  let kaputt: Error | undefined;
  const abriss = (e: Error) => {
    kaputt = e;
  };
  client.on('error', abriss);
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
    client.off('error', abriss);
    client.release(kaputt);
  }
}

async function einmaligeTransaktion<T>(
  r: Rahmen,
  griff: (stand: TxStand) => TxGriff,
  fn: (tx: TxGriff) => Promise<T>,
): Promise<T> {
  const p = poolDesRahmens(r);
  const client = await p.connect();
  const stand: TxStand = { client, offen: true, db: r.ich, pool: p, innerster: null, kontext: '', streng: r.streng };
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
    const result = await inTransaktionsPfad(stand, () => fn(griff(stand)));
    await commitBegleiter()?.(griff(stand));
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
    client.off('error', abriss);
    client.release(kaputt);
  }
}

/** Die Sperren vor dem Rumpf, in derselben Transaktion. */
function mitSperren<T>(rumpf: (tx: TxGriff) => Promise<T>, sperren?: readonly Bestandssperre[]) {
  if (!sperren?.length) return rumpf;
  return async (tx: TxGriff) => {
    await sperreBestaende(tx, sperren);
    return rumpf(tx);
  };
}

async function mitWiederholung<T>(einmal: () => Promise<T>, o: TxOptionen): Promise<T> {
  for (let versuch = 0; ; versuch++) {
    try {
      return await einmal();
    } catch (e) {
      if (!o.wiederholeBeiKonflikt || versuch >= TX_NEUVERSUCHE || !TX_KONFLIKT.has(fehlerCode(e) ?? '')) throw e;
      // Versetzt, damit die Gegenspieler nicht im Gleichschritt wieder aufeinandertreffen.
      await new Promise(res => setTimeout(res, 25 * (versuch + 1) + Math.random() * 50));
    }
  }
}

/** Der Griff einer Transaktion oder eines ihrer Sicherungspunkte (`punkt`): Abfragen über
 * ihre Verbindung und ein Zugang darüber; eine Transaktion in ihm wird ein Sicherungspunkt. */
function griff(
  r: Rahmen,
  zugang: Db,
  zaehler: { sicherungspunkte: number },
  stand: TxStand,
  punkt: string | null,
): TxGriff {
  const q = txAbfragen(stand, () => pruefeRahmen(r, stand));
  const tdb: Db = {
    ...zugang,
    ...q,
    transaction: (fn, o = {}) =>
      innereTransaktion(stand, punkt, ++zaehler.sicherungspunkte, name =>
        mitSperren(fn, o.sperren)(griff(r, zugang, zaehler, stand, name)),
      ),
    benachrichtigung: zugang.benachrichtigung.ueber(q.run),
    inTransaktion: () => true,
  };
  return { ...q, db: tdb };
}

/** Ein Zugang zur Datenbank mit eigenem Pool. Der Pool entsteht hier, nicht
 * beim Import: Wer die Adresse kennt, ruft die Fabrik. */
export function erzeugeDb(k: DbKonfig, o: { erststart?: Erststart } = {}): Db {
  // Erst mit einem Zugang gibt es Transaktionen; ein Import allein ändert infra/ nicht.
  setzeTransaktionsWaechter(TRANSAKTIONS_WAECHTER);
  const { pool, systemPool } = erzeugePools(k);
  const r: Rahmen = { ich: {}, pool, systemPool, streng: k.streng === true };
  const zaehler = { sicherungspunkte: 0 };

  /** Alle Zeilen einer Abfrage. T ist ungeprüft: Der Aufrufer sagt, welche
   * Spalten sein SQL liefert; ohne Angabe bleibt es `unknown`. */
  async function all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    wache(r);
    return queryWithRetry(async () => (await abfrage(r, sql, params)).rows, istLesend(sql));
  }
  async function get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await all<T>(sql, params))[0];
  }
  /** Wer die neue id braucht, schreibt RETURNING und liest mit get(). */
  async function run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    wache(r);
    return queryWithRetry(async () => ({ changes: (await abfrage(r, sql, params)).rowCount || 0 }), false);
  }
  async function transaction<T>(rumpf: (tx: TxGriff) => Promise<T>, opt: TxOptionen = {}): Promise<T> {
    wache(r);
    return mitWiederholung(
      () => einmaligeTransaktion(r, stand => griff(r, zugang, zaehler, stand, null), mitSperren(rumpf, opt.sperren)),
      opt,
    );
  }

  /** Eine EIGENE Verbindung, die NICHT aus dem Pool kommt. */
  async function eigeneVerbindung() {
    const c = new Client({ ...k.verbindung });
    await c.connect();
    return c;
  }
  const dieBasis = () => initSchema(eigeneVerbindung, o.erststart);

  const zugang: Db = {
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
    exec: async (sql: string) => {
      await abfrage(r, sql);
    },
    transaction,
    initSchema: dieBasis,
    initSchemaOnce: () =>
      initSchemaOnce(
        pool,
        dieBasis,
        k.erfassungZeitzone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
      ),
    eigeneVerbindung,
    mitCommitBegleiter,
    benachrichtigung: new Benachrichtigung(k.verbindung, (sql, p) => run(sql, p)),
    darfSchemaAendern: async () => (await get<{ d: boolean }>(DARF_SCHEMA_AENDERN))?.d === true,
    inTransaktion: () => offeneTx(r) !== null,
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
  return zugang;
}
