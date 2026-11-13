/** Der Zugang zu PostgreSQL: Pool, Abfragen, Transaktionen, Erststart. */

import { Pool, types as pgTypes, Client } from 'pg';
import type { PoolClient, PoolConfig, QueryResult } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { runMigrations, offeneMigrationen } from './migrate';
import { Benachrichtigung } from './pgNotify';
import type { DbSchnittstelle } from './typen';
import fs from 'node:fs';
import path from 'node:path';
import { LOCKS } from '../src/infra/lockNamespaces';
import { fehlerCode, meldeFehler, logAndContinue, setzeTransaktionsWaechter } from '../src/infra/fehler';
import { konfig, datenbankVerbindung, systemVerbindung } from '../src/infra/konfig';
import { zeilenKontext } from '../src/infra/kontoKontext';

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

const RETRYABLE_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '57P03', // cannot_connect_now (PG starting up)
  '08001', // sqlclient_unable_to_establish_sqlconnection
]);
/**
 * Bricht die Verbindung MITTEN in der Anfrage ab, ist offen, ob sie schon
 * festgeschrieben war. Ein Lesezugriff darf noch einmal, ein Schreibzugriff
 * nicht — sonst steht die Zeile doppelt da.
 */
const NUR_LESEND_WIEDERHOLBAR = new Set(['08006']);

/** Nur ein reines SELECT gilt als lesend; INSERT … RETURNING über get() nicht. */
export function istLesend(sql: string): boolean {
  const s = sql.replace(/--[^\n]*/g, '').trim();
  return /^(SELECT|WITH)\b/i.test(s) && !/\b(INSERT|UPDATE|DELETE|MERGE)\b|\bFOR\s+(UPDATE|SHARE)\b/i.test(s);
}

/** Mit Wiederholung bei transienten Fehlern. */
export async function queryWithRetry<T>(queryFn: () => Promise<T>, lesend: boolean, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (err) {
      lastErr = err;
      // Ein Fehler ohne Code ist nicht wiederholbar.
      const code = fehlerCode(err) ?? '';
      const wiederholbar = RETRYABLE_CODES.has(code) || (lesend && NUR_LESEND_WIEDERHOLBAR.has(code));
      if (!wiederholbar || attempt === maxRetries) throw err;
      const wait = 50 * 2 ** attempt; // 50 ms, 100 ms
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
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

/** Was nach dem Einspielen der Basis in eine leere Datenbank geschieht (das erste
 * Konto). Die Datenbankschicht kennt keine Konten; wer den Zugang anlegt, gibt es mit. */
export type Erststart = () => Promise<void>;

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
  /** Siehe mitCommitBegleiter unten: gilt für die Transaktionen dieses Aufrufpfads. */
  mitCommitBegleiter<T>(begleiter: (tx: DbSchnittstelle) => Promise<void>, arbeit: () => T): T;
  initSchema(): Promise<boolean>;
  initSchemaOnce(): Promise<void>;
  /** Ob die Verbindung Schema-Objekte anlegen darf: Eigentümerin oder Superuser, nicht die Laufzeitrolle. */
  darfSchemaAendern(): Promise<boolean>;
}

/** Die laufende Transaktion dieses Aufrufpfads: all/get/run/exec gehen dann
 * über ihre Verbindung, auch aus Repositories ohne tx-Parameter. Sonst läse
 * ein Dienst mitten in der Transaktion über eine zweite Verbindung ausserhalb
 * ihres Stands. `offen` schützt vor Nachzüglern nach COMMIT. */
type TxStand = {
  client: PoolClient;
  offen: boolean;
  db: object;
  pool: Pool;
  innerster: string | null;
  kontext: string;
};
const laufendeTx = new AsyncLocalStorage<TxStand>();
/** Der Sicherungspunkt, in dem dieser Aufrufpfad gerade läuft. */
const laufenderPunkt = new AsyncLocalStorage<{ stand: TxStand; name: string }>();

/** Für den Zeilenschutz (Migration 0111): wer gerade fragt, nur bis zum Ende
 * der Transaktion. Ein Wert auf Sitzungsebene bliebe an der Pool-Verbindung
 * hängen und gälte in der nächsten Anfrage eines anderen Kontos. Die Konto-ID
 * ist eine geprüfte ganze Zahl und darf deshalb ins SQL. Den Systemrahmen
 * trägt die Rolle der Verbindung (Migration 0112), keine Einstellung. */
function kontextSql(): string {
  const { system, konto } = zeilenKontext();
  if (system || konto === null) return '';
  return `SELECT set_config('app.konto', '${konto}', true)`;
}
const KONTEXT_LEER = "SELECT set_config('app.konto', '', true)";

/** Wechselt das Konto mitten in der Transaktion (imNamenVon), folgt die Einstellung. */
async function kontextAbgleich(stand: TxStand): Promise<void> {
  const soll = kontextSql();
  if (soll === stand.kontext) return;
  await stand.client.query(soll || KONTEXT_LEER);
  stand.kontext = soll;
}

function txSchnittstelle(stand: TxStand): DbSchnittstelle {
  const q = async (sql: string, p?: unknown[]) => {
    nochOffen(stand);
    await kontextAbgleich(stand);
    return stand.client.query(sql, p);
  };
  return {
    all: <T = unknown>(sql: string, p?: unknown[]) => q(sql, p).then(r => r.rows as T[]),
    get: <T = unknown>(sql: string, p?: unknown[]) => q(sql, p).then(r => r.rows[0] as T | undefined),
    run: (sql: string, p?: unknown[]) => q(sql, p).then(r => ({ changes: r.rowCount ?? 0 })),
    exec: (sql: string) => q(sql).then(() => undefined),
  };
}

/** Läuft vor dem COMMIT jeder äussersten Transaktion dieses Aufrufpfads mit,
 * in ihr: Was er schreibt, gilt genau dann, wenn ihre Wirkung gilt. */
type CommitBegleiter = (tx: DbSchnittstelle) => Promise<void>;
const commitBegleiter = new AsyncLocalStorage<CommitBegleiter>();
export function mitCommitBegleiter<T>(begleiter: CommitBegleiter, arbeit: () => T): T {
  return commitBegleiter.run(begleiter, arbeit);
}

/** Die Verbindung einer beendeten Transaktion ist schon zurück im Pool: Ein Nachzügler
 * (Promise.all bricht beim ersten Fehler ab, die anderen laufen weiter) verdürbe dort
 * die Transaktion eines Fremden. */
export class TransaktionBeendet extends Error {
  constructor() {
    super('Abfrage nach dem Ende ihrer Transaktion (Nachzügler aus Promise.all?)');
  }
}
function nochOffen(stand: TxStand): void {
  if (!stand.offen) throw new TransaktionBeendet();
}

export class GleichzeitigerSicherungspunkt extends Error {
  constructor(offen: string) {
    super(
      `Innere Transaktion, während ${offen} derselben Transaktion noch läuft (Promise.all über ` +
        'db.transaction?): Sicherungspunkte einer Verbindung sind ein Stapel, nacheinander ausführen.',
    );
  }
}

/** Innerhalb einer Transaktion ein Sicherungspunkt: Scheitert der innere Teil
 * und fängt der Aufrufer das, bleibt die äussere Transaktion benutzbar. Zwei
 * gleichzeitige teilten sich eine Verbindung; das ROLLBACK TO des einen nähme
 * die Arbeit des anderen mit. Deshalb muss jeder im innersten offenen beginnen. */
function innereTransaktion<T>(stand: TxStand, nummer: number, fn: (tx: DbSchnittstelle) => Promise<T>): Promise<T> {
  const p = laufenderPunkt.getStore();
  const rahmen = p?.stand === stand ? p.name : null;
  if (stand.innerster !== rahmen) return Promise.reject(new GleichzeitigerSicherungspunkt(stand.innerster ?? ''));
  const name = `sp_${nummer}`;
  stand.innerster = name;
  return laufenderPunkt.run({ stand, name }, async () => {
    const { client } = stand;
    // ROLLBACK TO nimmt auch ein set_config() aus dem Sicherungspunkt zurück.
    const kontextVorher = stand.kontext;
    try {
      nochOffen(stand);
      await client.query(`SAVEPOINT ${name}`);
      try {
        const r = await fn(txSchnittstelle(stand));
        nochOffen(stand);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return r;
      } catch (e) {
        if (!stand.offen) throw e;
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        stand.kontext = kontextVorher;
        if (e !== null && typeof e === 'object') vomSicherungspunktAufgefangen.add(e);
        throw e;
      }
    } finally {
      stand.innerster = rahmen;
    }
  });
}

/** Nach ROLLBACK TO SAVEPOINT ist die Transaktion wieder benutzbar: Wer diesen
 * Fehler auffängt und einen Ersatz liefert, verdeckt nichts. */
const vomSicherungspunktAufgefangen = new WeakSet<object>();
setzeTransaktionsWaechter({
  verdirbt: e =>
    laufendeTx.getStore()?.offen === true &&
    !(e !== null && typeof e === 'object' && vomSicherungspunktAufgefangen.has(e)),
  streng: () => konfig().nodeEnv === 'test',
});

// SQL geht unverändert an PostgreSQL.

// Die älteste Migration, auf der eine bestehende Datenbank aufsetzen darf: db/basis.sql
// und alle Migrationen danach kennen nur Schemas ab hier. Was älter ist, holt
// zuerst eine Fassung nach, die die früheren Startstufen noch mitbringt (UPGRADE.md).
const MINDESTSTAND = '0050-teilezaehler-nur-bestehende-konten.sql';

/** Ein Zugang zur Datenbank mit eigenem Pool. Der Pool entsteht hier, nicht
 * beim Import: Wer die Adresse kennt, ruft die Fabrik. */
export function erzeugeDb(k: DbKonfig, o: { erststart?: Erststart } = {}): Db {
  const pool = new Pool({ ...k.verbindung, ...k.pool });
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
  /** Eine Transaktion auf der Verbindung der anderen Rolle gilt nicht: Wer mitten
   * in einer Konto-Transaktion den Systemrahmen betritt, fragt neben ihr. */
  const txStand = (): TxStand | null => {
    const t = laufendeTx.getStore();
    return t?.offen && t.db === ich && t.pool === poolDesRahmens() ? t : null;
  };
  const txClient = (): PoolClient | null => txStand()?.client ?? null;

  /** Ausserhalb einer Transaktion: ohne Konto und Systemrahmen direkt über den
   * Pool, sonst in einer kurzen eigenen, damit set_config(…, true) gilt. */
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
      await client.query(`BEGIN; ${kontext}`);
      const r = await client.query(sql, params);
      await client.query('COMMIT');
      return r;
    } catch (e) {
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
      await client.query('BEGIN');
      await kontextAbgleich(stand);
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

  /** Eine LEERE Datenbank bekommt db/basis.sql (Abbild der Migrationen), danach
   * nur die jüngeren Migrationen; eine bestehende bleibt unberührt.
   * true, wenn die Basis eingespielt wurde. */
  async function initSchema(): Promise<boolean> {
    const c = await eigeneVerbindung();
    try {
      const leer = !(await c.query("SELECT to_regclass('public.users') AS t")).rows[0].t;
      if (!leer) return false;
      // Eigene Verbindung, weil die Basis Sitzungswerte setzt (SET …), die
      // sonst an einer Pool-Verbindung hängen blieben.
      await c.query('BEGIN');
      await c.query(fs.readFileSync(path.join(__dirname, 'basis.sql'), 'utf8'));
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch((r: Error) => console.warn('[schema] ROLLBACK gescheitert:', r.message));
      throw e;
    } finally {
      await c.end().catch((r: Error) => console.warn('[schema] Verbindung schliessen:', r.message));
    }
    if (o.erststart) await o.erststart();
    else console.warn('⚠️  [schema] Leere Datenbank ohne Erststart: kein erstes Konto angelegt.');
    console.log('✅ PostgreSQL schema ready');
    return true;
  }

  // Erststart und Migrationen unter einem Advisory-Lock (LOCKS.SCHEMA_INIT):
  // Starten web und jobs zugleich, migriert genau einer; der andere wartet.
  // Die Laufzeitrolle (compose.yaml) darf kein Schema ändern: Sie prüft nur,
  // ob der Dienst migration fertig ist, statt an CREATE zu scheitern.
  async function initSchemaOnce() {
    const client = await pool.connect();
    try {
      // Warten auf den anderen Prozess ist hier gewollt, auch länger als lock_timeout
      // und statement_timeout: Eine lange Migration dort bräche den Start (57014) ab.
      await client.query('SET lock_timeout = 0');
      await client.query('SET statement_timeout = 0');
      await client.query(`SELECT pg_advisory_lock(${LOCKS.SCHEMA_INIT})`);
      await client.query('RESET statement_timeout');
      if (!(await darfSchemaAendernAuf(client))) return await nurStandPruefen(client);
      const neu = await initSchema();
      if (!neu) await pruefeMindeststand(client);
      // Vor offenen Migrationen eine Kopie der Nutzerdaten — nicht bei einer
      // eben angelegten, leeren Datenbank.
      const applied = await runMigrations(client, { sichern: !neu });
      await schreibeErfassungsZeitzone(client);
      if (applied.length) console.log(`✅ ${applied.length} Migration(en) angewandt`);
      else if (!neu) console.log('✅ Schema aktuell — keine offenen Migrationen');
    } finally {
      await client
        .query(`SELECT pg_advisory_unlock(${LOCKS.SCHEMA_INIT})`)
        .catch(logAndContinue('db:pg_advisory_unlock'));
      await client.query('RESET lock_timeout').catch(logAndContinue('db:lock_timeout'));
      await client.query('RESET statement_timeout').catch(logAndContinue('db:statement_timeout'));
      client.release();
    }
  }

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
    initSchema,
    initSchemaOnce,
    eigeneVerbindung,
    mitCommitBegleiter,
    benachrichtigung: new Benachrichtigung(k.verbindung, (sql, p) => run(sql, p)),
    darfSchemaAendern: async () => (await get<{ d: boolean }>(DARF_SCHEMA_AENDERN))?.d === true,
    inTransaktion: () => txClient() !== null,
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

/** Die konfigurierte Zeitzone für den Trigger erfassung_tag() (Migration
 * 0078) — in der Datenbank, damit jede Verbindung denselben Tag rechnet. */
async function schreibeErfassungsZeitzone(client: import('pg').ClientBase): Promise<void> {
  await client.query(
    `INSERT INTO global_settings (key, value) VALUES ('erfassung_zeitzone', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     WHERE global_settings.value IS DISTINCT FROM EXCLUDED.value`,
    [konfig().erfassungZeitzone],
  );
}

const DARF_SCHEMA_AENDERN = `SELECT has_schema_privilege('public', 'CREATE') AS d`;
async function darfSchemaAendernAuf(client: import('pg').ClientBase): Promise<boolean> {
  return (await client.query<{ d: boolean }>(DARF_SCHEMA_AENDERN)).rows[0]?.d === true;
}

/** Für die Laufzeitrolle: Ein leeres oder nicht migriertes Schema hält den Start
 * an, statt dass Anfragen auf fehlende Spalten treffen. */
async function nurStandPruefen(client: import('pg').ClientBase): Promise<void> {
  const leer = !(await client.query("SELECT to_regclass('public.users') AS t")).rows[0].t;
  const offen = leer ? [] : await offeneMigrationen(client);
  if (leer || offen.length)
    throw new Error(
      `${leer ? 'Die Datenbank ist leer' : `Migrationen offen: ${offen.join(', ')}`}. Diese Rolle darf das Schema nicht ändern; ` +
        'Grundschema und Migrationen spielt der Dienst migration als Migrationsrolle ein (UPGRADE.md#migrationsrolle).',
    );
  await schreibeErfassungsZeitzone(client);
  console.log('✅ Schema aktuell (eingespielt vom Dienst migration)');
}

/** Eine bestehende Datenbank ohne Migration ab MINDESTSTAND hält den Start an,
 * bevor eine Migration sie anfasst: Die jüngeren setzen Tabellen voraus, die
 * dort fehlen, und schrieben sonst ein halbes Schema. */
async function pruefeMindeststand(client: import('pg').ClientBase): Promise<void> {
  const { rows } = await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS da`);
  const neuGenug =
    rows[0].da &&
    (await client.query('SELECT 1 FROM schema_migrations WHERE name >= $1 LIMIT 1', [MINDESTSTAND])).rows.length > 0;
  if (!neuGenug)
    throw new Error(
      `Die Datenbank ist älter als Migration ${MINDESTSTAND}. Zuerst auf eine Fassung vor dem ` +
        'Entfernen der früheren Startstufen aktualisieren, dann auf diese (UPGRADE.md#stichtag-0050).',
    );
}
