/**
 * PostgreSQL database layer
 * Provides a synchronous-style interface compatible with the existing
 * better-sqlite3 usage throughout the codebase.
 * Ausführlich: docs/begruendungen/db/database.ts.md#abschnitt
 */

import { Pool, types as pgTypes } from 'pg';
import { runMigrations, abgeloestesEntfernen } from './migrate';
import { logAndContinue } from '../utils/httpError';
import { APP_ROOT } from '../utils/appPaths';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Client } from 'pg';
import { LOCKS } from '../utils/lockNamespaces';
import { initImageMisses } from '../utils/imageMisses';
import { initImageQueue } from '../jobs/imageQueue';
import { fehlerCode } from '../utils/httpError';

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
  // Pass statement_timeout via PostgreSQL connection options (avoids client.query deprecation)
  options:                `-c statement_timeout=${parseInt(process.env.PG_STMT_MS || '30000')}`,
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
  all(sql: string, params?: any[]): Promise<any[]>;
  get(sql: string, params?: any[]): Promise<any>;
  run(sql: string, params?: any[]): Promise<{ changes: number | null; lastID: any }>;
  exec(sql: string): Promise<any>;
}

async function all(sql: string, params: any[] = []): Promise<any[]> {
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
async function get(sql: string, params: any[] = []): Promise<any> {
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
  try {
    await client.query('BEGIN');
    // Provide a client-bound db interface for the transaction
    const txDb: DbSchnittstelle = {
      all:  (sql: string, p?: any[]) => client.query(sql, p).then(r => r.rows),
      get:  (sql: string, p?: any[]) => client.query(sql, p).then(r => r.rows[0]),
      run:  (sql: string, p?: any[]) => client.query(sql, p).then(r => ({ changes: r.rowCount, lastID: (r.rows?.[0] as any)?.id })),
      exec: (sql: string)            => client.query(sql),
    };
    const result = await fn(txDb);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

//  SQL dialect translation (entfernt)
// Hier stand eine SQLite→PostgreSQL-Übersetzung aus der Migrationszeit. Sie ist
// ersatzlos entfallen, weil sie zwei Klassen stiller Fehler produziert hat:
// Ausführlich: docs/begruendungen/db/database.ts.md#abschnitt-5


/**
 * Das Grundschema von der Platte lesen.
 * Ausführlich: docs/begruendungen/db/database.ts.md#schemasql
 */
let _schemaSql: string | null = null;
function ladeSchema(): string {
  if (_schemaSql === null) {
    _schemaSql = fs.readFileSync(
      path.join(__dirname, 'schema.sql'), 'utf8') as string;
  }
  return _schemaSql;
}

// ── Schema initialisation ─────────────────────────────────────────────────────
/**
 * Das Schema anlegen und auf den aktuellen Stand bringen.
 * Ausführlich: docs/begruendungen/db/database.ts.md#abschnitt-6
 */
/**
 * Ein Schema-Schritt, der den Start NICHT abbrechen soll — aber gezaehlt wird.
 * Ausführlich: docs/begruendungen/db/database.ts.md#geschluckt
 */
let _geschluckt: string[] = [];

function schlucke(bereich: string) {
  return (e: any) => {
    const text = e?.message ?? String(e);
    _geschluckt.push(`${bereich}: ${text}`);
    console.error(`[db] ${bereich}:`, text);
  };
}

async function initSchema() {
  // Das Grundschema liegt als db/schema.sql daneben — reines SQL ohne
  // Einsetzungen, siehe die Begründung dort. Alles, was eine Bedingung
  // braucht, steht in den Etappen darunter.
  await pool.query(ladeSchema());

  await preisVerlaufEindeutigProTag();
  await spaltenMigrationen();
  await trigrammIndizes();
  await frueherZurLaufzeitAngelegt();
  await indizesUndZusammenfassung();   // MUSS zuletzt laufen, siehe dort

  console.log('✅ PostgreSQL schema ready');
}

/** Etappe 1 — ein Preiseintrag je Set, Zustand, Währung und Tag. */
async function preisVerlaufEindeutigProTag() {
  // Ein Preiseintrag je Set, Zustand, Währung und TAG
  // Zwei Schreibwege (jobs/priceJob.ts beim Abruf, utils/financeCalc.ts) tragen
  // `ON CONFLICT DO NOTHING` — die Tabelle hatte aber nur den Primärschlüssel
  // auf id. Ohne passenden Unique-Index kann die Klausel nie greifen: Sie liest …
  // Ausführlich: docs/begruendungen/db/database.ts.md#preisverlaufeindeutigprotag
  {
    const vorhanden = await pool.query(
      "SELECT 1 FROM pg_indexes WHERE tablename='price_history' AND indexname='idx_price_history_tag'");
    if (vorhanden.rows.length === 0) {
      const weg = await pool.query(`
        DELETE FROM price_history p
         USING price_history q
         WHERE p.set_number    = q.set_number
           AND p.condition     = q.condition
           AND p.currency_code = q.currency_code
           AND (p.recorded_at AT TIME ZONE 'UTC')::date = (q.recorded_at AT TIME ZONE 'UTC')::date
           AND (p.recorded_at < q.recorded_at OR (p.recorded_at = q.recorded_at AND p.id < q.id))`);
      if (weg.rowCount) console.log(`  ✅ Migration: ${weg.rowCount} doppelte Preis-Zeilen entfernt`);
      await pool.query(`
        CREATE UNIQUE INDEX idx_price_history_tag ON price_history
          (set_number, condition, currency_code, ((recorded_at AT TIME ZONE 'UTC')::date))`);
      console.log('  ✅ Migration: Tages-Eindeutigkeit für price_history');
    }
  }
}

/** Etappe 2 — Spalten, die bestehende Installationen noch nicht haben. */
async function spaltenMigrationen() {
  //  Migrations: add columns to existing tables
  // sets table migrations
  // Ausführlich: docs/begruendungen/db/database.ts.md#spaltenmigrationen-setsmigrations
  const setsMigrations = [
    { col: 'updated_at',     sql: "ALTER TABLE sets ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW()" },
    { col: 'purchase_price', sql: "ALTER TABLE sets ADD COLUMN purchase_price NUMERIC(12,4)" },
    { col: 'condition',      sql: "ALTER TABLE sets ADD COLUMN condition TEXT DEFAULT 'N'" },
  ];
  for (const m of setsMigrations) {
    const exists = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name='sets' AND column_name=$1",
      [m.col]
    );
    if (exists.rows.length === 0) {
      await pool.query(m.sql);
      console.log(`  ✅ Migration: sets.${m.col} hinzugefügt`);
    }
  }

  // Catalog table migrations — image_local may be missing on older installs
  for (const [tbl, col] of [
    ['set_parts_catalog',   'image_local'],
    ['set_minifigs_catalog','image_local'],
  ]) {
    const exists = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2",
      [tbl, col]
    );
    if (exists.rows.length === 0) {
      await pool.query(`ALTER TABLE ${tbl} ADD COLUMN ${col} TEXT`);
      console.log(`  ✅ Migration: ${tbl}.${col} hinzugefügt`);
    }
  }

  const userMigrations = [
    { col: 'email',               sql: "ALTER TABLE users ADD COLUMN email TEXT" },
    { col: 'first_name',          sql: "ALTER TABLE users ADD COLUMN first_name TEXT" },
    { col: 'last_name',           sql: "ALTER TABLE users ADD COLUMN last_name TEXT" },
    { col: 'is_active',           sql: "ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1" },
    { col: 'email_verified',      sql: "ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0" },
    { col: 'verification_token',  sql: "ALTER TABLE users ADD COLUMN verification_token TEXT" },
    { col: 'token_expires',       sql: "ALTER TABLE users ADD COLUMN token_expires TIMESTAMPTZ" },
    { col: 'reset_token',         sql: "ALTER TABLE users ADD COLUMN reset_token TEXT" },
    { col: 'reset_token_expires', sql: "ALTER TABLE users ADD COLUMN reset_token_expires TIMESTAMPTZ" },
    // Siehe "Default admin user" unten: markiert Konten, deren Passwort beim
    // Erstellen automatisch vergeben wurde (Default-Admin ohne ADMIN_PASSWORD).
    { col: 'must_change_password', sql: "ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0" },
  ];
  for (const m of userMigrations) {
    const exists = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name=$1",
      [m.col]
    );
    if (exists.rows.length === 0) {
      await pool.query(m.sql);
      console.log(`  ✅ Migration: users.${m.col} hinzugefügt`);
    }
  }

  // Make sure existing admin user is marked as active + verified
  // Mit Protokoll: Scheitert eine dieser beiden, bleibt ein Konto inaktiv oder
  // unbestaetigt und niemand kann sich anmelden — der Grund stuende nirgends.
  // Die Spaltenmigrationen darueber melden ihren Erfolg ebenfalls.
  // Ausführlich: docs/begruendungen/db/database.ts.md#spaltenmigrationen
  await pool.query(
    "UPDATE users SET is_active=1, email_verified=1 WHERE is_admin=1 " +
    "AND (is_active IS NULL OR email_verified IS NULL)"
  ).catch(logAndContinue('start:admin aktiv setzen'));
  await pool.query(
    "UPDATE users SET is_active=COALESCE(is_active,1), email_verified=COALESCE(email_verified,0)"
  ).catch(logAndContinue('start:konten-vorgaben'));

  // Add unique constraint on email if not exists (ignore error if already exists)
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL"
  ).catch(()=>{});

  // Default global settings
  await pool.query(`
    INSERT INTO global_settings (key, value) VALUES
      ('bricklink_consumer_key',     ''),
      ('bricklink_consumer_secret',  ''),
      ('bricklink_token',            ''),
      ('bricklink_token_secret',     ''),
      ('brickset_api_key',           ''),
      ('rebrickable_api_key',        ''),
      ('price_job_interval_minutes', '60'),
      ('registration_enabled',       '0'), -- disabled by default; admin enables after setup
      ('price_cache_ttl',             '24'),  -- 1 Tag Standard
      ('default_price_condition',     'N'),   -- N = Neu (New), U = Gebraucht (Used)
      ('api_limit_rebrickable',       '25000'),
      ('api_limit_bricklink',         '4000'),
      ('api_limit_brickset',          '100'),
      ('smtp_host',                  ''),
      ('smtp_port',                  '587'),
      ('smtp_user',                  ''),
      ('smtp_pass',                  ''),
      ('smtp_from',                  ''),
      ('smtp_secure',                '0')
    ON CONFLICT (key) DO NOTHING;
  `);

  // Bestandsinstallationen: Der INSERT oben greift wegen ON CONFLICT DO NOTHING
  // nicht mehr, ein alter Standardwert bliebe also stehen. Angehoben werden
  // nur die exakten früheren Standards — wer bewusst etwas anderes eingestellt
  // hat (auch einen kleineren Wert), behält es.
  //
  // '4000' ist der ursprüngliche Standard, '10000' ein Zwischenschritt. Beide
  // stehen hier, damit die Migration unabhängig davon greift, welche Version
  // zuletzt lief.
  await pool.query(`
    UPDATE global_settings SET value = '25000'
    WHERE key = 'api_limit_rebrickable' AND value IN ('4000', '10000')
  `);
}

/** Etappe 3 — Trigramm-Indizes für die Katalogsuche (optional, pg_trgm). */
async function trigrammIndizes() {
  // ── Trigramm-Indizes für die Volltextsuche im Katalog ──────────────────────
  // Getrennt vom grossen Schema-Block, weil CREATE EXTENSION fehlschlagen kann
  // (fehlende Rechte bei manchen gehosteten Postgres-Angeboten). Das darf den
  // Start nicht verhindern — ohne die Erweiterung ist die Suche langsamer,
  // aber korrekt.
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_rb_sets_name_trgm    ON rb_sets    USING GIN (name gin_trgm_ops)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_rb_sets_setnum_trgm  ON rb_sets    USING GIN (set_num gin_trgm_ops)');
    console.log('  ✅ Trigramm-Indizes für die Katalogsuche vorhanden');
  } catch (e: any) {
    console.warn(`  ⚠️  pg_trgm nicht verfügbar (${e.message}) — Katalogsuche läuft ohne Index (Seq-Scan).`);
  }
}

/** Etappe 4 — Tabellen und Datenkorrekturen, die früher zur Laufzeit liefen. */
async function frueherZurLaufzeitAngelegt() {
  // ── Tabellen, die früher zur LAUFZEIT angelegt wurden ──────────────────────
  //
  // csv_import_jobs entstand per ensureJobTable() bei jedem Aufruf des
  // CSV-Status-Endpunkts, qr_login_tokens per ensureQrTable() bei jedem
  // QR-Token. DDL im Request-Pfad ist aus zwei Gründen unschön: Sie kostet bei
  // jeder Anfrage einen Katalog-Zugriff, und sie verteilt das Schema über die
  // Codebasis, sodass niemand mehr an einer Stelle sehen kann, wie die
  // Datenbank aussieht. Beide gehören hierher.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS csv_import_jobs (
      user_id    INTEGER PRIMARY KEY,
      status     TEXT    NOT NULL DEFAULT 'running',
      total      INTEGER NOT NULL DEFAULT 0,
      done       INTEGER NOT NULL DEFAULT 0,
      current    TEXT,
      results    JSONB   NOT NULL DEFAULT '[]',
      error      TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qr_login_tokens (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      -- Die vom Erzeuger gewaehlte Laufzeit des SPAETEREN Geraete-Tokens, in
      -- Tagen. Sie reist mit der Nonce, weil POST /qr-login unangemeldet
      -- erreichbar ist — siehe db/migrations/0016-token-laufzeit.sql.
      -- Auf gewachsenen Datenbanken zieht die Migration sie nach; dieses
      -- CREATE TABLE IF NOT EXISTS tut dort naemlich nichts.
      token_days INTEGER
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_qr_login_expires ON qr_login_tokens(expires_at)');

  // api_tokens.sliding und die beiden Indizes stehen in einer MIGRATION
  // Zwei Gruende, beide stehen als Warnung schon in dieser Datei:
  //   1. initSchema() laeuft NUR bei einer Versionsaenderung — steht in
  //      schema_meta bereits die Fassung dieses Deployments, wird der ganze …
  // Ausführlich: docs/begruendungen/db/database.ts.md#abschnitt-7

  // Einmalige Bereinigung: Klartext-Tokens aus der Zeit vor dem Hashing.
  //
  // validateToken() hatte dafür einen Legacy-Fallback, der bei jedem
  // fehlgeschlagenen Hash-Lookup ein zweites Mal mit dem Klartext suchte. Der
  // Fallback ist entfernt (er hielt die Klartext-Speicherung dauerhaft
  // gültig); stattdessen fliegen Alt-Zeilen hier einmalig raus. Sie sind am
  // Format erkennbar: hashToken() liefert immer 64 Hex-Zeichen.
  const legacy = await pool.query(
    "DELETE FROM api_tokens WHERE token !~ '^[0-9a-f]{64}$'"
  ).catch(() => null);
  if (legacy?.rowCount) {
    console.log(`  ✅ ${legacy.rowCount} Klartext-Token entfernt (bitte in der App neu erzeugen)`);
  }

  // Default admin user
  // Ausführlich: docs/begruendungen/db/database.ts.md#frueherzurlaufzeitangelegt
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
    const hash = bcrypt.hashSync(plainPassword, 10);
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

  // Datenbereinigung: Whitespace-Varianten in Figurennummern normalisieren
  // (verhinderte die Gruppierung identischer Figuren in der Übersicht)
  await pool.query(`UPDATE minifigs SET fig_number = TRIM(fig_number)
                    WHERE fig_number <> TRIM(fig_number)`)
    .catch(schlucke('fig_number trim'));

  // Part and minifig acquisition tables (per-purchase tracking like set_acquisitions)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS part_acquisitions (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL,
      part_number TEXT    NOT NULL,
      color_id    INTEGER NOT NULL DEFAULT 0,
      quantity    INTEGER NOT NULL DEFAULT 1,
      unit_price  NUMERIC(12,4),
      condition   TEXT    DEFAULT 'N',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS minifig_acquisitions (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL,
      fig_number  TEXT    NOT NULL,
      quantity    INTEGER NOT NULL DEFAULT 1,
      unit_price  NUMERIC(12,4),
      condition   TEXT    DEFAULT 'N',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )`);

  // Migration: condition column for set_acquisitions
  const acqCondExists = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name='set_acquisitions' AND column_name='condition'",
  ).then(r => r.rows.length > 0).catch(() => false);
  if (!acqCondExists) {
    await pool.query("ALTER TABLE set_acquisitions ADD COLUMN condition TEXT DEFAULT 'N'");
    console.log('  ✅ Migration: set_acquisitions.condition hinzugefügt');
  }

  // Migration: added_at column for parts
  const partsAddedAtExists = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name='parts' AND column_name='added_at'",
  ).then(r => r.rows.length > 0).catch(() => false);
  if (!partsAddedAtExists) {
    await pool.query("ALTER TABLE parts ADD COLUMN added_at TIMESTAMPTZ DEFAULT NOW()");
  }

  // Migration: condition column for parts (manual parts)
  // Steht hier weiter, obwohl Migration 0035 die Spalte loescht — und das ist
  // kein Versehen, sondern dieselbe Begruendung wie bei sets.purchase_price
  // (siehe spaltenMigrationen weiter oben): Diese Funktion legt den …
  // Ausführlich: docs/begruendungen/db/database.ts.md#frueherzurlaufzeitangelegt-partscondexists
  const partsCondExists = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name='parts' AND column_name='condition'",
  ).then(r => r.rows.length > 0).catch(() => false);
  if (!partsCondExists) {
    await pool.query("ALTER TABLE parts ADD COLUMN condition TEXT DEFAULT 'N'");
    console.log('  ✅ Migration: parts.condition hinzugefügt');
  }

  // Dasselbe fuer die Minifiguren — siehe die Begruendung direkt darueber.
  const mfCondExists = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name='minifigs' AND column_name='condition'",
  ).then(r => r.rows.length > 0).catch(() => false);
  if (!mfCondExists) {
    await pool.query("ALTER TABLE minifigs ADD COLUMN condition TEXT DEFAULT 'N'");
    console.log('  ✅ Migration: minifigs.condition hinzugefügt');
  }

  // Nachtragen: erst hier, NACH den Spaltenmigrationen
  // Diese beiden Bloecke standen weiter oben, VOR den ALTER TABLEs, die
  // parts.added_at und parts.condition anlegen. Auf jeder Datenbank, die
  // diese Spalten noch nicht hatte — also bei jedem Hochziehen von einem …
  // Ausführlich: docs/begruendungen/db/database.ts.md#frueherzurlaufzeitangelegt-2
  console.log('  ✅ part_acquisitions + minifig_acquisitions erstellt/migriert');

  // Wo er gebraucht wird, steht er jetzt richtig: Migration 0032 traegt die
  // fehlenden Erfassungen nach, einmalig, und prueft danach nach, dass keine
  // Set-Zeile ohne Erfassung uebrig ist — bevor sie die beiden Spalten loescht.
  // Ausführlich: docs/begruendungen/db/database.ts.md#abschnitt-8
}

/**
 * Etappe 5 — Indizes und die vorberechnete Teile-Zusammenfassung.
 * Ausführlich: docs/begruendungen/db/database.ts.md#indizesundzusammenfassung
 */
async function indizesUndZusammenfassung() {
  // ── Indizes ZULETZT anlegen ───────────────────────────────────────────────
  // Bewusst ganz am Ende, nachdem ALLE Tabellen erstellt UND alle ALTER-Migra-
  // tionen durchgelaufen sind. So referenziert ein Index garantiert nur bereits
  // existierende Spalten/Tabellen — das verhindert "relation/column does not
  // exist" bei Neuinstallationen, selbst wenn später ALTERs ergänzt werden.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rb_inv_setnum ON rb_inventories(set_num)`).catch(schlucke('idx_rb_inv_setnum'));

  // Drei Nachschläge im Anfragepfad, die keinen passenden Index hatten
  // Alle drei mit EXPLAIN (ANALYZE, BUFFERS) an je 100'000 Zeilen nachgemessen.
  // Ausführlich: docs/begruendungen/db/database.ts.md#indizesundzusammenfassung-2
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rate_limit_attempts (
      key      TEXT PRIMARY KEY,
      count    INTEGER     NOT NULL DEFAULT 1,
      first_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(schlucke('rate_limit_attempts'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rate_limit_first_at ON rate_limit_attempts(first_at)`).catch(() => {});


  // idx_parts_category stand hier
  // Der Index lag auf parts(user_id, category_name). Die Kategorie steht seit
  // Migration 0034 in part_catalog und haengt NICHT am Konto — der fuehrende
  // user_id waere dort sinnlos.
  // Ausführlich: docs/begruendungen/db/database.ts.md#indizesundzusammenfassung-3
  await require('../utils/partsSummary').initPartsSummary(pool).catch(schlucke('parts_summary'));
  // Tabelle für bekannte Bild-Fehlanzeigen (Nachtrag 98). Sie ersetzt zwei
  // Merker, die je Prozess im Arbeitsspeicher lagen — im Cluster hiess das:
  // dasselbe fehlende Bild einmal PRO Arbeitsprozess holen, nach jedem Neustart
  // erneut. In den alten Katalogjahrgängen, wo fast jedes Bild fehlt, war das
  // der Grossteil der Last.
  // Die Tabellen dazu legt db/migrations/0009-bild-tabellen.sql an — nicht
  // hier: initSchema() läuft nur bei einer Versionsänderung, und ein stiller
  // Fehlschlag hätte den Bild-Job dauerhaft abgeschaltet (siehe dort).
}

// ── Upsert helpers ────────────────────────────────────────────────────────────

// initSchemaOnce: wraps initSchema with a PostgreSQL advisory lock (55667788)
// so only one cluster worker runs migrations at a time.
// Other workers poll (non-blocking) until migrating worker is done.
// Falls back to direct execution after 30s timeout.
async function initSchemaOnce() {
  const LOCK_ID = LOCKS.SCHEMA_INIT;
  // Fassung dieses Deployments. Der postinstall-Hook (scripts/bump-version.js)
  // setzt sie bei jeder Installation neu — sie ändert sich also genau dann,
  // wenn auch neue Migrationen dazugekommen sein können.
  // Ausführlich: docs/begruendungen/db/database.ts.md#initschemaonce-appversion
  let appVersion = 'unknown';
  try {
    appVersion = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version || 'unknown';
  } catch (_) { /* Vermerk bleibt 'unknown' — er steuert nichts, siehe unten. */ }
  // Blockierender Advisory-Lock auf einer DEDIZIERTEN Verbindung: So führt im
  // Cluster immer nur EIN Worker die Schema-Migration gleichzeitig aus. Andere
  // Worker warten hier, bis der Lock frei ist, und rufen initSchema danach als
  // No-op auf (CREATE TABLE/INDEX IF NOT EXISTS finden alles vor).
  // Ausführlich: docs/begruendungen/db/database.ts.md#initschemaonce-client
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${LOCK_ID})`);

    // initSchema() ist der ERSTSTART, nicht der Weg fuer Aenderungen
    //  1. UNWAHR: appVersion war immer 'unknown' (siehe oben), der Vergleich
    //     also immer erfuellt. initSchema() lief seit Einfuehrung des Vermerks
    //     auf jeder bestehenden Datenbank NIE wieder — unabhaengig von Updates.
    // Ausführlich: docs/begruendungen/db/database.ts.md#initschemaonce
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        id              INTEGER PRIMARY KEY DEFAULT 1,
        applied_version TEXT NOT NULL,
        applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT schema_meta_single_row CHECK (id = 1)
      )`);

    const vermerk = await client.query('SELECT applied_version FROM schema_meta WHERE id = 1');
    // rowCount ist bei pg für Nicht-SELECT null — hier immer eine Zahl, aber
    // der Typ weiss das nicht.
    const schonAngelegt = (vermerk.rowCount ?? 0) > 0;
    const erzwungen = process.env.FORCE_SCHEMA_INIT === '1';

    if (schonAngelegt && !erzwungen) {
      // Kurze Meldung statt des kompletten Migrationsprotokolls je Worker.
      console.log(`✅ Schema angelegt (${vermerk.rows[0].applied_version}) — nur Migrationen`);
    } else {
      if (erzwungen && schonAngelegt) {
        console.warn('⚠️  FORCE_SCHEMA_INIT=1 — initSchema() laeuft auf einer bestehenden ' +
          'Datenbank. Spalten, die Migrationen geloescht haben, entstehen kurz neu und ' +
          'werden danach wieder entfernt. Daten fuellt es nur dort, wo sie fehlen.');
      }
      _geschluckt = [];
      await initSchema();
      // Nur vermerken, wenn NICHTS geschluckt wurde
      // Die Begruendung steht bei schlucke(). Kurz: Hier wurde die Fassung
      // bedingungslos vermerkt, und damit wurde ein einmaliger Fehlschlag zu
      // einem dauerhaften Zustand — initSchema() laeuft ja nur EINMAL, beim …
      // Ausführlich: docs/begruendungen/db/database.ts.md#initschemaonce-2
      if (_geschluckt.length) {
        console.error(`⚠️  ${_geschluckt.length} Schema-Schritt(e) fehlgeschlagen — Fassung ${appVersion} NICHT vermerkt, der naechste Start versucht es erneut:`);
        for (const zeile of _geschluckt) console.error(`    ${zeile}`);
      } else {
        await client.query(`
          INSERT INTO schema_meta (id, applied_version, applied_at) VALUES (1, $1, NOW())
          ON CONFLICT (id) DO UPDATE SET applied_version = $1, applied_at = NOW()`,
          [appVersion]);
      }
    }

    // Nummerierte Migrationen — laufen IMMER, auch wenn initSchema()
    // übersprungen wurde.
    // Ausführlich: docs/begruendungen/db/database.ts.md#applied

    const applied = await runMigrations(client, { sichern: schonAngelegt });
    if (applied.length) console.log(`✅ ${applied.length} Migration(en) angewandt`);
    if (erzwungen && schonAngelegt) await abgeloestesEntfernen(client);

    // ── Bild-Hilfsdienste: NACH den Migrationen, in JEDEM Arbeitsprozess ────
    //
    // Nach den Migrationen, weil sie die Tabellen brauchen (0009). In jedem
    // Arbeitsprozess, weil sie PROZESS-LOKAL sind: Der Merker für fehlende
    // Bilder lädt seinen Bestand in den Speicher, und der Puffer des Bild-Jobs
    // bekommt seinen Schreib-Takt. Stünden sie in initSchema(), liefen sie nur
    // in dem einen Worker, der gerade migriert — genau der Fehler, der drei
    // Viertel aller Notizen verschwinden liess.
    await initImageMisses()
      .catch(schlucke('image_misses'));
    await initImageQueue()
      .catch(schlucke('image_wanted'));
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${LOCK_ID})`).catch(() => {});
    client.release();
  }
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
