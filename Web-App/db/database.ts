/** Der Zugang zu PostgreSQL: Pool, Abfragen, Transaktionen, Erststart.
 * Ausführlich: docs/begruendungen/db/database.ts.md#ueberblick */

import { Pool, types as pgTypes, Client } from 'pg';
import type { PoolClient } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { runMigrations, sichereNutzerdaten, abgeloestesEntfernen } from './migrate';
import type { DbSchnittstelle } from './typen';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { LOCKS } from '../src/infra/lockNamespaces';
import { fehlerCode, meldeFehler, logAndContinue } from '../src/infra/fehler';
import { konfig, datenbankVerbindung } from '../src/infra/konfig';
import { passwortMangel } from '../src/infra/passwortRegel';

// Alle Abhängigkeiten stehen hier oben: Ein require() im Rumpf versteckt sie
// und liefert `any`. Ausführlich: docs/begruendungen/db/database.ts.md#importe-am-kopf

// NUMERIC als Zahl: NUMERIC(12,4) bleibt weit unter 2^53, gerechnet wird in
// src/infra/geld.ts in Zehntausendsteln.
// Ausführlich: docs/begruendungen/db/database.ts.md#numeric-als-zahl
pgTypes.setTypeParser(pgTypes.builtins.NUMERIC, (v: string | null) => (v === null ? null : parseFloat(v)));

// ── Connection pool ───────────────────────────────────────────────────────────
// Höchstens zwei Prozesse (web und jobs) mit je 15 Verbindungen: weit unter
// max_connections, mit Luft für Werkzeuge und den CSV-Importprozess.
const VORGABE_POOL = 15;

const K = konfig();
const POOL_CONFIG = {
  max:                    K.pgPoolMax ?? VORGABE_POOL,
  min:                    K.pgPoolMin,
  idleTimeoutMillis:      K.pgIdleMs,
  connectionTimeoutMillis:K.pgConnMs,
  // Über die Verbindungsoptionen statt je Anfrage. Die Zeitzone des
  // Erfassungstags steht in der Datenbank (schreibeErfassungsZeitzone).
  options:                `-c statement_timeout=${K.pgStmtMs} -c idle_in_transaction_session_timeout=${K.pgLeerlaufTxMs} -c lock_timeout=${K.pgSperreMs}`,
  keepAlive:              true,
  keepAliveInitialDelayMillis: 10000,
};

const baseConfig = datenbankVerbindung();

const pool = new Pool({ ...baseConfig, ...POOL_CONFIG });

// Ohne Lauscher brächte der Abriss einer ruhenden Verbindung den Prozess zu Fall.
pool.on('error', (err) => {
  console.error('[db-pool] idle client error:', err.message);
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
      const wait = 50 * Math.pow(2, attempt); // 50 ms, 100 ms
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// Für den Gesundheits-Endpunkt.
function getPoolStats() {
  return {
    total:   pool.totalCount,
    idle:    pool.idleCount,
    waiting: pool.waitingCount,
    active:  pool.totalCount - pool.idleCount,
  };
}

/** Für /api/v1/health/ready: eine Abfrage ohne Tabelle, die nur die Verbindung prüft. */
async function alsSuperuserVerbunden(): Promise<boolean> {
  return !!(await get<{ s: boolean }>('SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user'))?.s;
}

async function datenbankAntwortet(): Promise<boolean> {
  return pool.query('SELECT 1').then(() => true, (e: unknown) => { meldeFehler('health:ready', e); return false; });
}


// Ausführlich: docs/begruendungen/db/database.ts.md#dbschnittstelle
/** Eine Zeile mit den Spalten, die der Aufrufer liest; weitere reisen als `unknown` mit. */
export type Zeile<T extends object = object> = T & Record<string, unknown>;

export type { DbSchnittstelle };

/** Die laufende Transaktion dieses Aufrufpfads: all/get/run/exec gehen dann
 * über ihre Verbindung, auch aus Repositories ohne tx-Parameter. Sonst läse
 * ein Dienst mitten in der Transaktion über eine zweite Verbindung ausserhalb
 * ihres Stands. `offen` schützt vor Nachzüglern nach COMMIT. */
const laufendeTx = new AsyncLocalStorage<{ client: PoolClient; offen: boolean }>();
const txClient = (): PoolClient | null => { const t = laufendeTx.getStore(); return t?.offen ? t.client : null; };

/** Ob dieser Aufrufpfad in einer Transaktion läuft (für Tests und Wächter). */
export function inTransaktion(): boolean { return txClient() !== null; }

/** Alle Zeilen einer Abfrage. T ist ungeprüft: Der Aufrufer sagt, welche
 * Spalten sein SQL liefert; ohne Angabe bleibt es `unknown`. */
async function all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = txClient();
  if (c) return (await c.query(sql, params)).rows as T[];
  return queryWithRetry(async () => {
    const { rows } = await pool.query(sql, params);
    return rows;
  }, istLesend(sql));
}

/** Erste Zeile einer Abfrage, oder undefined. T wie bei all(). */
async function get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await all<T>(sql, params))[0];
}

/** Schreibende Abfrage: Anzahl betroffener Zeilen. Wer die neue id braucht,
 * schreibt RETURNING und liest mit get(). */
async function run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
  const c = txClient();
  if (c) return { changes: (await c.query(sql, params)).rowCount || 0 };
  return queryWithRetry(async () => ({ changes: (await pool.query(sql, params)).rowCount || 0 }), false);
}

/** Rohes SQL ohne Parameter, für Schema und Migrationen. */
async function exec(sql: string): Promise<void> {
  await (txClient() ?? pool).query(sql);
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
    throw e;
  }
}

function txSchnittstelle(client: PoolClient): DbSchnittstelle {
  return {
    all:  <T = unknown>(sql: string, p?: unknown[]) => client.query(sql, p).then(r => r.rows as T[]),
    get:  <T = unknown>(sql: string, p?: unknown[]) => client.query(sql, p).then(r => r.rows[0] as T | undefined),
    run:  (sql: string, p?: unknown[]) => client.query(sql, p).then(r => ({ changes: r.rowCount ?? 0 })),
    exec: (sql: string)            => client.query(sql).then(() => undefined),
  };
}

export interface TxOptionen {
  /** Bei Deadlock (40P01) oder Serialisierungsfehler (40001) die ganze Transaktion
   * bis zu zweimal neu beginnen. Nur für Rümpfe ohne Wirkung nach aussen (Netz,
   * Dateien, Mails): Sie laufen dann mehrfach. In einer äusseren Transaktion
   * ohne Wirkung; dort entscheidet deren Option. */
  wiederholeBeiKonflikt?: boolean;
}
const TX_KONFLIKT = new Set(['40P01', '40001']);
const TX_NEUVERSUCHE = 2;

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
  const stand = { client, offen: true };
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

// SQL geht unverändert an PostgreSQL: Die frühere SQLite-Übersetzung hängte
// still ON CONFLICT an und ersetzte ? auch in JSONB-Operatoren.
// Ausführlich: docs/begruendungen/db/database.ts.md#sql-unuebersetzt


// Die letzte Migration, die es zusammen mit den alten Startstufen gab
// (307ee28). Eine Datenbank, die noch nicht so weit ist, ist ein Altbestand.
const ALTBESTAND_BIS = '0050-teilezaehler-nur-bestehende-konten.sql';

/** Eine LEERE Datenbank bekommt db/basis.sql (Abbild der Migrationen, aus
 * scripts/schema-stand.js), danach nur die jüngeren Migrationen; eine
 * bestehende bleibt unberührt. So hat jede Tabelle genau einen Weg.
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
    // Aus einer Konstante entschieden, damit der Übersetzer verengen kann.
    const envPasswort = konfig().adminPasswort;
    // Dieselbe Regel wie jeder andere Weg; ein schwaches ADMIN_PASSWORD wird
    // durch ein zufälliges ersetzt, das beim ersten Login zu ändern ist.
    const mangel = envPasswort !== '' ? passwortMangel(envPasswort, 'admin') : null;
    if (mangel) console.warn(`⚠️  [start] ADMIN_PASSWORD wird nicht verwendet (${mangel}); ein zufälliges Startpasswort steht unten.`);
    const useEnvPassword = envPasswort !== '' && !mangel;
    const plainPassword = useEnvPassword
      ? envPasswort
      : crypto.randomBytes(15).toString('base64url'); // 20 Zeichen, URL-sicher
    // 12 wie BCRYPT_ROUNDS in src/konto/auth.ts: Mit weniger Runden antwortete ein
    // Fehlversuch gegen „admin“ messbar schneller und verriet das Konto.
    const hash = bcrypt.hashSync(plainPassword, 12);
    // '1' statt true: Auf einem Altbestand läuft das vor Migration 0085, dort
    // sind die Spalten noch Zahlen. '1' nimmt BOOLEAN wie INTEGER an.
    await pool.query(
      `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified, must_change_password)
       VALUES ('admin', $1, '1', '1', '1', $2)`,
      [hash, useEnvPassword ? '0' : '1']
    );
    if (useEnvPassword) {
      console.log('✅ Standard-Admin erstellt (Passwort aus ADMIN_PASSWORD).');
    } else {
      // Auf stdout statt console.log: am Protokoll-Abfänger vorbei, nur im Container-Log.
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
// (LOCKS.SCHEMA_INIT): Starten web und jobs zugleich, migriert genau einer;
// der andere wartet blockierend und findet danach alles vor.
async function initSchemaOnce() {
  const LOCK_ID = LOCKS.SCHEMA_INIT;
  const client = await pool.connect();
  try {
    // Warten auf den anderen Prozess ist hier gewollt, auch länger als lock_timeout
    // und statement_timeout: Eine lange Migration dort bräche den Start (57014) ab.
    await client.query('SET lock_timeout = 0');
    await client.query('SET statement_timeout = 0');
    await client.query(`SELECT pg_advisory_lock(${LOCK_ID})`);
    await client.query('RESET statement_timeout');
    const neu = await initSchema();
    const alt = !neu && await istAltbestand(client);
    if (alt) await ruesteAltbestandAuf(client);
    // Vor offenen Migrationen eine Kopie der Nutzerdaten — nicht bei einer
    // eben angelegten, leeren Datenbank.
    const applied = await runMigrations(client, { sichern: !neu && !alt });
    await schreibeErfassungsZeitzone(client);
    if (applied.length) console.log(`✅ ${applied.length} Migration(en) angewandt`);
    else if (!neu) console.log('✅ Schema aktuell — keine offenen Migrationen');
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${LOCK_ID})`).catch(logAndContinue('db:pg_advisory_unlock'));
    await client.query('RESET lock_timeout').catch(logAndContinue('db:lock_timeout'));
    await client.query('RESET statement_timeout').catch(logAndContinue('db:statement_timeout'));
    client.release();
  }
}

/**
 * Die konfigurierte Zeitzone für den Trigger erfassung_tag() (Migration
 * 0078) — in der Datenbank, damit jede Verbindung denselben Tag rechnet.
 */
async function schreibeErfassungsZeitzone(client: import('pg').ClientBase): Promise<void> {
  await client.query(
    `INSERT INTO global_settings (key, value) VALUES ('erfassung_zeitzone', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     WHERE global_settings.value IS DISTINCT FROM EXCLUDED.value`, [konfig().erfassungZeitzone]);
}

/** Bestehende Datenbank, deren jüngste Migration aus der Zeit vor ALTBESTAND_BIS stammt. */
async function istAltbestand(client: import('pg').ClientBase): Promise<boolean> {
  const { rows } = await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS da`);
  if (!rows[0].da) return true;
  const r = await client.query('SELECT 1 FROM schema_migrations WHERE name >= $1 LIMIT 1', [ALTBESTAND_BIS]);
  return r.rows.length === 0;
}

/** Ein Altbestand holt die früheren Startstufen, die Migrationen bis
 * ALTBESTAND_BIS und das Entfernen des Abgelösten nach — danach ist er eine
 * Datenbank wie jede andere und bekommt die jüngeren Migrationen. */
async function ruesteAltbestandAuf(client: import('pg').ClientBase): Promise<void> {
  console.log('🔧 Ältere Datenbank: die früheren Startstufen laufen einmal nach');
  await sichereNutzerdaten(client, ['altbestand/startstufen.sql']);
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL statement_timeout = 0');
    await client.query(fs.readFileSync(path.join(__dirname, 'altbestand', 'startstufen.sql'), 'utf8'));
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch((r: unknown) => meldeFehler('start:altbestand', r));
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

export { pool, all, get, run, exec, transaction, initSchema, initSchemaOnce, getPoolStats, datenbankAntwortet, alsSuperuserVerbunden, eigeneVerbindung };
