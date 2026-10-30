/**
 * PostgreSQL database layer
 * Provides a synchronous-style interface compatible with the existing
 * better-sqlite3 usage throughout the codebase.
 * Ausführlich: docs/begruendungen/db/database.ts.md#abschnitt
 */

import { Pool, types as pgTypes } from 'pg';
import { runMigrations, sichereNutzerdaten, abgeloestesEntfernen } from './migrate';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Client } from 'pg';
import { LOCKS } from '../utils/lockNamespaces';
import { fehlerCode, meldeUndWeiter, logAndContinue } from '../utils/httpError';

// Warum diese acht jetzt oben stehen
// Sie standen als require() in den Funktionsruempfen. Node haelt Module im
// Cache, die Laufzeitkosten waren also gering — der Preis war ein anderer: Die
// Abhaengigkeiten dieser Datei standen nicht an ihrem Kopf, und ein require() …
// Ausführlich: docs/begruendungen/db/database.ts.md#abschnitt-2

// NUMERIC kommt als Zahl zurück, nicht als Zeichenkette
// Seit db/migrations/0007 liegen alle Geldbeträge als NUMERIC in der Datenbank
// statt als REAL — sonst rechnet Postgres in 32-Bit-Gleitkomma, und die Summe
// aus 1000 Beträgen à 0.07 ergibt 69.99974 statt 70.00.
// Ausführlich: docs/begruendungen/db/database.ts.md#abschnitt-3
pgTypes.setTypeParser(pgTypes.builtins.NUMERIC, (v: any) => (v === null ? null : parseFloat(v)));

// ── Connection pool ───────────────────────────────────────────────────────────
// Jeder Worker hat einen eigenen Pool; zusammen müssen sie unter
// max_connections bleiben, mit Luft für Werkzeuge.
const { workerZahl, poolJeWorker } = require('../utils/workerZahl') as typeof import('../utils/workerZahl');
const MAX_PER_WORKER = poolJeWorker(workerZahl());

const POOL_CONFIG = {
  max:                    parseInt(process.env.PG_POOL_MAX    || String(MAX_PER_WORKER)),
  min:                    parseInt(process.env.PG_POOL_MIN    || '2'),
  idleTimeoutMillis:      parseInt(process.env.PG_IDLE_MS     || '30000'),
  connectionTimeoutMillis:parseInt(process.env.PG_CONN_MS     || '30000'),
  // Über die Verbindungsoptionen statt je Anfrage: statement_timeout, und die
  // Zeitzone, in der der Trigger erfassung_tag() den Tag eines Kaufs bildet.
  options:                `-c statement_timeout=${parseInt(process.env.PG_STMT_MS || '30000')}`
                        + ` -c brickinventory.zeitzone=${(require('../utils/konfig') as typeof import('../utils/konfig')).erfassungsZeitzone()}`,
  keepAlive:              true,
  keepAliveInitialDelayMillis: 10000,
};

const baseConfig = (require('../utils/konfig') as typeof import('../utils/konfig')).datenbankVerbindung();

const pool = new Pool({ ...baseConfig, ...POOL_CONFIG });

// ── Pool event logging ────────────────────────────────────────────────────────
pool.on('error', (err, _client) => {
  console.error('[db-pool] idle client error:', err.message);
});

pool.on('connect', (_client) => {
  // statement_timeout is set via pool options below — no extra query needed
});

// Optional: log pool exhaustion warnings (fires when all connections are in use)
let _poolWarnTimer: any = null;
pool.on('acquire', () => {
  const {   waitingCount } = pool;
  if (waitingCount > 0 && !_poolWarnTimer) {
    _poolWarnTimer = setTimeout(() => {
      // Pool pressure warning suppressed — too noisy during bulk imports
      _poolWarnTimer = null;
    }, 500);
  }
});

// ── Query helper with retry on transient errors ───────────────────────────────
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

/**
 * Eine Abfrage mit Wiederholung bei transienten Fehlern ausführen.
 * Ausführlich: docs/begruendungen/db/database.ts.md#querywithretry
 * @template T
 * @param {() => Promise<T>} queryFn
 * @param {number} maxRetries
 * @returns {Promise<T>}
 */
export async function queryWithRetry<T>(queryFn: () => Promise<T>, lesend: boolean, maxRetries = 2): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (err) {
      lastErr = err;
      // `?? ''` statt eines Nicht-Null-Ausrufezeichens: Ein Fehler ohne Code
      // ist eben nicht wiederholbar, und der leere String faellt sauber
      // durch die Menge — genau das Verhalten von vorher, nur ohne `any`.
      const code = fehlerCode(err) ?? '';
      const wiederholbar = RETRYABLE_CODES.has(code) || (lesend && NUR_LESEND_WIEDERHOLBAR.has(code));
      if (!wiederholbar || attempt === maxRetries) throw err;
      const wait = 50 * Math.pow(2, attempt); // 50 ms, 100 ms
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ── Pool stats (for /api/finance/cache-stats and health endpoints) ────────────
function getPoolStats() {
  return {
    total:   pool.totalCount,
    idle:    pool.idleCount,
    waiting: pool.waitingCount,
    active:  pool.totalCount - pool.idleCount,
  };
}


// ── Sync-compatible wrapper ───────────────────────────────────────────────────
// All methods are async but named to mirror better-sqlite3's API.
// Callers that use db.prepare().get()/.all()/.run() must now await them,
// but since we rewrote all callers to be async anyway, this works.

/**
 * Execute a query and return all rows.
 * Replaces: db.prepare(sql).all(...params)
 */
/**
 * Alle Zeilen einer Abfrage.
 * Ausführlich: docs/begruendungen/db/database.ts.md#abschnitt-4
 */
/**
 * Die Abfrage-Schnittstelle, die dieses Modul anbietet — einmal als Typ.
 * Ausführlich: docs/begruendungen/db/database.ts.md#dbschnittstelle
 */
export interface DbSchnittstelle {
  /** T beschreibt die Zeile; ohne Angabe bleibt sie untypisiert (Altbestand). */
  all<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: any[]): Promise<{ changes: number | null; lastID: any }>;
  exec(sql: string): Promise<any>;
}

async function all<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return queryWithRetry(async () => {
    const { rows } = await pool.query(sql, params);
    return rows;
  }, istLesend(sql));
}

/**
 * Execute a query and return the first row (or undefined).
 * Replaces: db.prepare(sql).get(...params)
 */
/** Erste Zeile einer Abfrage, oder undefined. Zum Typ siehe all(). */
async function get<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return queryWithRetry(async () => {
    const { rows } = await pool.query(sql, params);
    return rows[0];
  }, istLesend(sql));
}

/**
 * Execute a query and return { changes, lastID }.
 * Replaces: db.prepare(sql).run(...params)
 */
/** Schreibende Abfrage: Anzahl betroffener Zeilen und ggf. die neue id. */
async function run(sql: string, params: any[] = []): Promise<{ changes: number; lastID: any }> {
  return queryWithRetry(async () => {
    const result = await pool.query(sql, params);
    return {
      changes: result.rowCount || 0,
      lastID:  (result.rows?.[0] as any)?.id ?? null,
    };
  }, false);
}

/**
 * Execute raw SQL (for schema/migrations).
 * Replaces: db.exec(sql)
 */
async function exec(sql: string): Promise<any> {
  await pool.query(sql);
}

/**
 * Run multiple statements in a transaction.
 * Replaces: db.transaction(fn)()
 */
async function transaction<T>(fn: (tx: DbSchnittstelle) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let kaputt: Error | undefined;
  // Reisst die Verbindung mitten in der Transaktion ab, meldet der Client das
  // als 'error'-Ereignis; ohne Zuhörer beendete es den ganzen Prozess.
  const abriss = (e: Error) => { kaputt = e; };
  client.on('error', abriss);
  try {
    await client.query('BEGIN');
    // Provide a client-bound db interface for the transaction
    const txDb: DbSchnittstelle = {
      all:  <T = any>(sql: string, p?: unknown[]) => client.query(sql, p).then(r => r.rows as T[]),
      get:  <T = any>(sql: string, p?: unknown[]) => client.query(sql, p).then(r => r.rows[0] as T | undefined),
      run:  (sql: string, p?: any[]) => client.query(sql, p).then(r => ({ changes: r.rowCount, lastID: (r.rows?.[0] as any)?.id })),
      exec: (sql: string)            => client.query(sql),
    };
    const result = await fn(txDb);
    await client.query('COMMIT');
    return result;
  } catch (e) {
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

//  SQL dialect translation (entfernt)
// Hier stand eine SQLite→PostgreSQL-Übersetzung aus der Migrationszeit. Sie ist
// ersatzlos entfallen, weil sie zwei Klassen stiller Fehler produziert hat:
// Ausführlich: docs/begruendungen/db/database.ts.md#abschnitt-5


// Die letzte Migration, die es zusammen mit den alten Startstufen gab
// (307ee28). Eine Datenbank, die noch nicht so weit ist, ist ein Altbestand.
const ALTBESTAND_BIS = '0050-teilezaehler-nur-bestehende-konten.sql';

/**
 * Erststart: Eine LEERE Datenbank bekommt ihr Schema aus db/basis.sql, dem
 * erzeugten Abbild aller Migrationen bis zu seiner Entstehung (scripts/
 * schema-stand.js). Danach laufen nur die jüngeren Migrationen. Eine
 * bestehende Datenbank fasst diese Funktion nicht an — so gibt es für jede
 * Tabelle genau einen Weg: Basis plus Migrationen.
 * @returns true, wenn die Basis eingespielt wurde
 */
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
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end().catch(() => {});
  }
  await legeAdminAn();
  console.log('✅ PostgreSQL schema ready');
  return true;
}

/**
 * Das erste Konto einer neuen Installation.
 * Ausführlich: docs/begruendungen/db/database.ts.md#frueherzurlaufzeitangelegt
 */
async function legeAdminAn() {
  const { rows } = await pool.query('SELECT COUNT(*) as c FROM users');
  if (parseInt(rows[0].c) === 0) {
    // Erst in eine lokale Konstante lesen, dann daraus die Entscheidung
    // ableiten. Vorher stand die Bedingung als eigene Boolesche
    // (`!!process.env.ADMIN_PASSWORD`) daneben — fachlich richtig, aber
    // TypeScript kann ueber eine separate Variable nicht verengen und sah
    // weiterhin `string | undefined`. Sichtbar wurde das erst, als bcryptjs
    // oben importiert statt per require() geholt wurde: Solange hashSync `any`
    // war, prueft niemand sein Argument. Ein Fehler war es nicht — der Zweig
    // ist durch dieselbe Bedingung geschuetzt —, beweisbar war es aber auch nicht.
    const envPasswort = process.env.ADMIN_PASSWORD || '';
    const useEnvPassword = envPasswort !== '';
    const plainPassword = useEnvPassword
      ? envPasswort
      : crypto.randomBytes(15).toString('base64url'); // 20 Zeichen, URL-sicher
    // 12 wie BCRYPT_ROUNDS in utils/auth.ts: Mit weniger Runden antwortete ein
    // Fehlversuch gegen „admin“ messbar schneller und verriet das Konto.
    const hash = bcrypt.hashSync(plainPassword, 12);
    await pool.query(
      `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified, must_change_password)
       VALUES ('admin', $1, 1, 1, 1, $2)`,
      [hash, useEnvPassword ? 0 : 1]
    );
    if (useEnvPassword) {
      console.log('✅ Standard-Admin erstellt (Passwort aus ADMIN_PASSWORD).');
    } else {
      // NICHT über console.log
      // Direkt auf stdout geschrieben, geht die Zeile am Abfänger vorbei und
      // steht nur dort, wo sie hingehört: im Container-Log des ersten Starts.
      // Ein Filter im Abfänger wäre die Alternative gewesen — der hinge dann …
      // Ausführlich: docs/begruendungen/db/database.ts.md#frueherzurlaufzeitangelegt-banner
      const banner = [
        '╔══════════════════════════════════════════════════════════╗',
        '║  Standard-Admin erstellt — Passwort NUR JETZT sichtbar:    ║',
        `║    admin / ${plainPassword}`,
        '║  Bitte nach dem ersten Login sofort ändern                 ║',
        '║  (Einstellungen → Passwort ändern).                        ║',
        '╚══════════════════════════════════════════════════════════╝',
      ];
      process.stdout.write(banner.join('\n') + '\n');
    }
  }

}

// initSchemaOnce: Erststart und Migrationen unter einem Advisory-Lock
// (LOCKS.SCHEMA_INIT), damit im Cluster genau ein Worker das Schema anfasst.
// Die anderen warten blockierend und finden danach alles vor.
async function initSchemaOnce() {
  const LOCK_ID = LOCKS.SCHEMA_INIT;
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${LOCK_ID})`);
    const neu = await initSchema();
    const alt = !neu && await istAltbestand(client);
    if (alt) await ruesteAltbestandAuf(client);
    // Vor offenen Migrationen eine Kopie der Nutzerdaten — nicht bei einer
    // eben angelegten, leeren Datenbank.
    const applied = await runMigrations(client, { sichern: !neu && !alt });
    if (applied.length) console.log(`✅ ${applied.length} Migration(en) angewandt`);
    else if (!neu) console.log('✅ Schema aktuell — keine offenen Migrationen');
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${LOCK_ID})`).catch(logAndContinue('db:pg_advisory_unlock'));
    client.release();
  }
}

/** Bestehende Datenbank, deren jüngste Migration aus der Zeit vor ALTBESTAND_BIS stammt. */
async function istAltbestand(client: import('pg').ClientBase): Promise<boolean> {
  const { rows } = await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS da`);
  if (!rows[0].da) return true;
  const r = await client.query('SELECT 1 FROM schema_migrations WHERE name >= $1 LIMIT 1', [ALTBESTAND_BIS]);
  return r.rows.length === 0;
}

/**
 * Ein Altbestand bekommt, was früher der Start mit FORCE_SCHEMA_INIT=1 tat:
 * die letzten Startstufen samt ihrer Datenschritte, die Migrationen bis
 * ALTBESTAND_BIS und danach das Entfernen dessen, was diese schon abgelöst
 * hatten. Erst dann laufen die jüngeren Migrationen wie bei jeder Datenbank.
 */
async function ruesteAltbestandAuf(client: import('pg').ClientBase): Promise<void> {
  console.log('🔧 Ältere Datenbank: die früheren Startstufen laufen einmal nach');
  await sichereNutzerdaten(client, ['altbestand/startstufen.sql']);
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL statement_timeout = 0');
    await client.query(fs.readFileSync(path.join(__dirname, 'altbestand', 'startstufen.sql'), 'utf8'));
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch((r: unknown) => meldeUndWeiter('start:altbestand', r));
    throw new Error(`Startstufen für die ältere Datenbank fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  }
  await runMigrations(client, { bis: ALTBESTAND_BIS });
  const weg = await abgeloestesEntfernen(client, ALTBESTAND_BIS);
  console.log(`  ✅ Startstufen nachgeholt, ${weg} abgelöste Spalten/Tabellen entfernt`);
  await legeAdminAn();
}

/**
 * Eine EIGENE Verbindung, die NICHT aus dem Pool kommt.
 * Ausführlich: docs/begruendungen/db/database.ts.md#eigeneverbindung
 */
async function eigeneVerbindung() {
  const c = new Client({ ...baseConfig });
  await c.connect();
  return c;
}

export { pool, all, get, run, exec, transaction, initSchema, initSchemaOnce, getPoolStats, eigeneVerbindung };
