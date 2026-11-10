/** Der Zugang zu PostgreSQL: Pool, Abfragen, Transaktionen, Erststart.
 * Ausführlich: docs/begruendungen/db/database.ts.md#ueberblick */

import { Pool, types as pgTypes, Client } from 'pg';
import type { PoolClient, PoolConfig } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { runMigrations } from './migrate';
import type { DbSchnittstelle } from './typen';
import fs from 'node:fs';
import path from 'node:path';
import { LOCKS } from '../src/infra/lockNamespaces';
import { fehlerCode, meldeFehler, logAndContinue, setzeTransaktionsWaechter } from '../src/infra/fehler';
import { konfig, datenbankVerbindung } from '../src/infra/konfig';

// Alle Abhängigkeiten stehen hier oben: Ein require() im Rumpf versteckt sie
// und liefert `any`. Ausführlich: docs/begruendungen/db/database.ts.md#importe-am-kopf

// NUMERIC als Zahl: NUMERIC(12,4) bleibt weit unter 2^53, gerechnet wird in
// src/infra/geld.ts in Zehntausendsteln.
// Ausführlich: docs/begruendungen/db/database.ts.md#numeric-als-zahl
pgTypes.setTypeParser(pgTypes.builtins.NUMERIC, (v: string | null) => (v === null ? null : parseFloat(v)));

// Höchstens zwei Prozesse (web und jobs) mit je 15 Verbindungen: weit unter
// max_connections, mit Luft für Werkzeuge und den CSV-Importprozess.
const VORGABE_POOL = 15;

/** Was eine Verbindung braucht; der Prozess liest es einmal und reicht es weiter. */
export interface DbKonfig {
  verbindung: PoolConfig;
  pool: PoolConfig;
}

export function dbKonfigAusUmgebung(): DbKonfig {
  const K = konfig();
  return {
    verbindung: datenbankVerbindung(),
    pool: {
      max:                    K.pgPoolMax ?? VORGABE_POOL,
      min:                    K.pgPoolMin,
      idleTimeoutMillis:      K.pgIdleMs,
      connectionTimeoutMillis:K.pgConnMs,
      // Über die Verbindungsoptionen statt je Anfrage. Die Zeitzone des
      // Erfassungstags steht in der Datenbank (schreibeErfassungsZeitzone).
      options:                `-c statement_timeout=${K.pgStmtMs} -c idle_in_transaction_session_timeout=${K.pgLeerlaufTxMs} -c lock_timeout=${K.pgSperreMs}`,
      keepAlive:              true,
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

/** Mit Wiederholung bei transienten Fehlern.
 * Ausführlich: docs/begruendungen/db/database.ts.md#querywithretry */
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

// Benannt, damit tx-Rückrufe geprüft werden. Ausführlich: docs/begruendungen/db/database.ts.md#dbschnittstelle
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
 * Konto). Die Datenbankschicht kennt keine Konten; der Prozess setzt es beim Start. */
type Erststart = () => Promise<void>;
let _erststart: Erststart | null = null;
export function setzeErststart(fn: Erststart | null): void { _erststart = fn; }

export interface Db extends DbSchnittstelle {
  readonly pool: Pool;
  transaction<T>(fn: (tx: DbSchnittstelle) => Promise<T>, o?: TxOptionen): Promise<T>;
  inTransaktion(): boolean;
  getPoolStats(): { total: number; idle: number; waiting: number; active: number };
  datenbankAntwortet(): Promise<boolean>;
  alsSuperuserVerbunden(): Promise<boolean>;
  eigeneVerbindung(): Promise<Client>;
  initSchema(): Promise<boolean>;
  initSchemaOnce(): Promise<void>;
}

/** Die laufende Transaktion dieses Aufrufpfads: all/get/run/exec gehen dann
 * über ihre Verbindung, auch aus Repositories ohne tx-Parameter. Sonst läse
 * ein Dienst mitten in der Transaktion über eine zweite Verbindung ausserhalb
 * ihres Stands. `offen` schützt vor Nachzüglern nach COMMIT. */
const laufendeTx = new AsyncLocalStorage<{ client: PoolClient; offen: boolean; db: object }>();

function txSchnittstelle(client: PoolClient): DbSchnittstelle {
  return {
    all:  <T = unknown>(sql: string, p?: unknown[]) => client.query(sql, p).then(r => r.rows as T[]),
    get:  <T = unknown>(sql: string, p?: unknown[]) => client.query(sql, p).then(r => r.rows[0] as T | undefined),
    run:  (sql: string, p?: unknown[]) => client.query(sql, p).then(r => ({ changes: r.rowCount ?? 0 })),
    exec: (sql: string)            => client.query(sql).then(() => undefined),
  };
}

/** Innerhalb einer Transaktion ein Sicherungspunkt: Scheitert der innere Teil
 * und fängt der Aufrufer das, bleibt die äussere Transaktion benutzbar. */
let _sicherungspunkt = 0;
async function innereTransaktion<T>(client: PoolClient, fn: (tx: DbSchnittstelle) => Promise<T>): Promise<T> {
  const name = `sp_${++_sicherungspunkt}`;
  await client.query(`SAVEPOINT ${name}`);
  try {
    const r = await fn(txSchnittstelle(client));
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return r;
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    if (e !== null && typeof e === 'object') vomSicherungspunktAufgefangen.add(e);
    throw e;
  }
}

/** Nach ROLLBACK TO SAVEPOINT ist die Transaktion wieder benutzbar: Wer diesen
 * Fehler auffängt und einen Ersatz liefert, verdeckt nichts. */
const vomSicherungspunktAufgefangen = new WeakSet<object>();
setzeTransaktionsWaechter({
  verdirbt: (e) => laufendeTx.getStore()?.offen === true
    && !(e !== null && typeof e === 'object' && vomSicherungspunktAufgefangen.has(e)),
  streng: () => konfig().nodeEnv === 'test',
});

// SQL geht unverändert an PostgreSQL. Ausführlich: docs/begruendungen/db/database.ts.md#sql-unuebersetzt

// Die älteste Migration, auf der eine bestehende Datenbank aufsetzen darf: db/basis.sql
// und alle Migrationen danach kennen nur Schemas ab hier. Was älter ist, holt
// zuerst eine Fassung nach, die die früheren Startstufen noch mitbringt (UPGRADE.md).
const MINDESTSTAND = '0050-teilezaehler-nur-bestehende-konten.sql';

/** Ein Zugang zur Datenbank mit eigenem Pool. Der Pool entsteht hier, nicht
 * beim Import: Wer die Adresse kennt, ruft die Fabrik. */
export function erzeugeDb(k: DbKonfig): Db {
  const pool = new Pool({ ...k.verbindung, ...k.pool });
  // Ohne Lauscher brächte der Abriss einer ruhenden Verbindung den Prozess zu Fall.
  pool.on('error', (err) => {
    console.error('[db-pool] idle client error:', err.message);
  });
  const ich = {};
  const txClient = (): PoolClient | null => { const t = laufendeTx.getStore(); return t?.offen && t.db === ich ? t.client : null; };

  /** Alle Zeilen einer Abfrage. T ist ungeprüft: Der Aufrufer sagt, welche
   * Spalten sein SQL liefert; ohne Angabe bleibt es `unknown`. */
  async function all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const c = txClient();
    if (c) return (await c.query(sql, params)).rows as T[];
    return queryWithRetry(async () => (await pool.query(sql, params)).rows, istLesend(sql));
  }
  async function get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await all<T>(sql, params))[0];
  }
  /** Wer die neue id braucht, schreibt RETURNING und liest mit get(). */
  async function run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const c = txClient();
    if (c) return { changes: (await c.query(sql, params)).rowCount || 0 };
    return queryWithRetry(async () => ({ changes: (await pool.query(sql, params)).rowCount || 0 }), false);
  }
  async function exec(sql: string): Promise<void> {
    await (txClient() ?? pool).query(sql);
  }

  async function transaction<T>(fn: (tx: DbSchnittstelle) => Promise<T>, o: TxOptionen = {}): Promise<T> {
    const aussen = txClient();
    if (aussen) return innereTransaktion(aussen, fn);
    for (let versuch = 0; ; versuch++) {
      try { return await einmaligeTransaktion(fn); }
      catch (e) {
        if (!o.wiederholeBeiKonflikt || versuch >= TX_NEUVERSUCHE || !TX_KONFLIKT.has(fehlerCode(e) ?? '')) throw e;
        // Versetzt, damit die Gegenspieler nicht im Gleichschritt wieder aufeinandertreffen.
        await new Promise(r => setTimeout(r, 25 * (versuch + 1) + Math.random() * 50));
      }
    }
  }

  async function einmaligeTransaktion<T>(fn: (tx: DbSchnittstelle) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    const stand = { client, offen: true, db: ich };
    let kaputt: Error | undefined;
    // Reisst die Verbindung mitten in der Transaktion ab, meldet der Client das
    // als 'error'-Ereignis; ohne Zuhörer beendete es den ganzen Prozess.
    const abriss = (e: Error) => { kaputt = e; };
    client.on('error', abriss);
    try {
      await client.query('BEGIN');
      const result = await laufendeTx.run(stand, () => fn(txSchnittstelle(client)));
      stand.offen = false;
      await client.query('COMMIT');
      return result;
    } catch (e) {
      stand.offen = false;
      // Scheitert auch das ROLLBACK, ist die Verbindung kaputt: Sie darf nicht
      // in den Pool zurück, und gemeldet wird der Fehler, der es ausgelöst hat.
      try { await client.query('ROLLBACK'); }
      catch (r) { kaputt = r instanceof Error ? r : new Error(String(r)); }
      throw e;
    } finally {
      client.off('error', abriss);
      client.release(kaputt);
    }
  }

  /** Eine EIGENE Verbindung, die NICHT aus dem Pool kommt.
   * Ausführlich: docs/begruendungen/db/database.ts.md#eigeneverbindung */
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
    if (_erststart) await _erststart();
    else console.warn('⚠️  [schema] Leere Datenbank ohne Erststart: kein erstes Konto angelegt.');
    console.log('✅ PostgreSQL schema ready');
    return true;
  }

  // Erststart und Migrationen unter einem Advisory-Lock (LOCKS.SCHEMA_INIT):
  // Starten web und jobs zugleich, migriert genau einer; der andere wartet.
  async function initSchemaOnce() {
    const client = await pool.connect();
    try {
      // Warten auf den anderen Prozess ist hier gewollt, auch länger als lock_timeout
      // und statement_timeout: Eine lange Migration dort bräche den Start (57014) ab.
      await client.query('SET lock_timeout = 0');
      await client.query('SET statement_timeout = 0');
      await client.query(`SELECT pg_advisory_lock(${LOCKS.SCHEMA_INIT})`);
      await client.query('RESET statement_timeout');
      const neu = await initSchema();
      if (!neu) await pruefeMindeststand(client);
      // Vor offenen Migrationen eine Kopie der Nutzerdaten — nicht bei einer
      // eben angelegten, leeren Datenbank.
      const applied = await runMigrations(client, { sichern: !neu });
      await schreibeErfassungsZeitzone(client);
      if (applied.length) console.log(`✅ ${applied.length} Migration(en) angewandt`);
      else if (!neu) console.log('✅ Schema aktuell — keine offenen Migrationen');
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${LOCKS.SCHEMA_INIT})`).catch(logAndContinue('db:pg_advisory_unlock'));
      await client.query('RESET lock_timeout').catch(logAndContinue('db:lock_timeout'));
      await client.query('RESET statement_timeout').catch(logAndContinue('db:statement_timeout'));
      client.release();
    }
  }

  return {
    pool, all, get, run, exec, transaction, initSchema, initSchemaOnce, eigeneVerbindung,
    inTransaktion: () => txClient() !== null,
    getPoolStats: () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount,
      active: pool.totalCount - pool.idleCount }),
    datenbankAntwortet: () => pool.query('SELECT 1').then(() => true, (e: unknown) => { meldeFehler('health:ready', e); return false; }),
    alsSuperuserVerbunden: async () => !!(await get<{ s: boolean }>('SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user'))?.s,
  };
}

/** Die konfigurierte Zeitzone für den Trigger erfassung_tag() (Migration
 * 0078) — in der Datenbank, damit jede Verbindung denselben Tag rechnet. */
async function schreibeErfassungsZeitzone(client: import('pg').ClientBase): Promise<void> {
  await client.query(
    `INSERT INTO global_settings (key, value) VALUES ('erfassung_zeitzone', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     WHERE global_settings.value IS DISTINCT FROM EXCLUDED.value`, [konfig().erfassungZeitzone]);
}

/** Eine bestehende Datenbank ohne Migration ab MINDESTSTAND hält den Start an,
 * bevor eine Migration sie anfasst: Die jüngeren setzen Tabellen voraus, die
 * dort fehlen, und schrieben sonst ein halbes Schema. */
async function pruefeMindeststand(client: import('pg').ClientBase): Promise<void> {
  const { rows } = await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS da`);
  const neuGenug = rows[0].da
    && (await client.query('SELECT 1 FROM schema_migrations WHERE name >= $1 LIMIT 1', [MINDESTSTAND])).rows.length > 0;
  if (!neuGenug) throw new Error(
    `Die Datenbank ist älter als Migration ${MINDESTSTAND}. Zuerst auf eine Fassung vor dem `
    + 'Entfernen der früheren Startstufen aktualisieren, dann auf diese (UPGRADE.md, Abschnitt 45).');
}

// ── Kompatibilitätsweg: der Zugang des Prozesses ────────────────────────────
// Die meisten Module importieren noch die Funktionen unten statt einen Zugang
// übergeben zu bekommen; test/ratschen.test.js zählt sie. Der Pool entsteht beim
// ersten Gebrauch oder wenn der Prozess setzeStandardDb() ruft, nie beim Import.

let _standard: Db | null = null;

export function setzeStandardDb(d: Db): void {
  if (_standard && _standard !== d) throw new Error('Der Datenbankzugang des Prozesses ist schon gesetzt');
  _standard = d;
}

export function standardDb(): Db {
  if (!_standard) _standard = erzeugeDb(dbKonfigAusUmgebung());
  return _standard;
}

/** Der Pool des Prozesses; erst beim ersten Zugriff angelegt. */
const pool: Pool = new Proxy({} as Pool, {
  get(_ziel, k) {
    const p = standardDb().pool;
    const v: unknown = Reflect.get(p, k, p);
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(p) : v;
  },
  // Wer eine Methode ersetzt (Messung, Probe), meint den echten Pool.
  set: (_ziel, k, v) => Reflect.set(standardDb().pool, k, v),
});

const all = <T>(sql: string, params?: unknown[]): Promise<T[]> => standardDb().all<T>(sql, params);
const get = <T>(sql: string, params?: unknown[]): Promise<T | undefined> => standardDb().get<T>(sql, params);
const run = (sql: string, params?: unknown[]) => standardDb().run(sql, params);
const exec = (sql: string) => standardDb().exec(sql);
const transaction = <T>(fn: (tx: DbSchnittstelle) => Promise<T>, o?: TxOptionen) => standardDb().transaction(fn, o);
const initSchema = () => standardDb().initSchema();
const initSchemaOnce = () => standardDb().initSchemaOnce();
const getPoolStats = () => standardDb().getPoolStats();
const datenbankAntwortet = () => standardDb().datenbankAntwortet();
const alsSuperuserVerbunden = () => standardDb().alsSuperuserVerbunden();
const eigeneVerbindung = () => standardDb().eigeneVerbindung();

/** Ob dieser Aufrufpfad in einer Transaktion läuft (für Tests und Wächter). */
export function inTransaktion(): boolean { return standardDb().inTransaktion(); }

export { pool, all, get, run, exec, transaction, initSchema, initSchemaOnce, getPoolStats, datenbankAntwortet, alsSuperuserVerbunden, eigeneVerbindung };
