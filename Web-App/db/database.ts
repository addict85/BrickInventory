/**
 * PostgreSQL database layer
 *
 * Provides a synchronous-style interface compatible with the existing
 * better-sqlite3 usage throughout the codebase.
 *
 * Since pg is async but the rest of the code uses sync patterns,
 * we use a connection pool with a sync-compatible wrapper via
 * a shared client approach for transactional operations.
 *
 * Environment variables:
 *   PGHOST     (default: postgres)
 *   PGPORT     (default: 5432)
 *   PGUSER     (default: brickmanager)
 *   PGPASSWORD (default: brickmanager)
 *   PGDATABASE (default: brickmanager)
 *   DATABASE_URL (overrides all above if set)
 */

import { Pool, types as pgTypes } from 'pg';
import { runMigrations } from './migrate';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Client } from 'pg';
import { LOCKS } from '../utils/lockNamespaces';
import { initImageMisses } from '../utils/imageMisses';
import { initImageQueue } from '../jobs/imageQueue';
import { fehlerCode } from '../utils/httpError';

// ── Warum diese acht jetzt oben stehen (Nachtrag 155) ────────────────────────
//
// Sie standen als require() in den Funktionsruempfen. Node haelt Module im
// Cache, die Laufzeitkosten waren also gering — der Preis war ein anderer: Die
// Abhaengigkeiten dieser Datei standen nicht an ihrem Kopf, und ein require()
// ohne Typdeklaration liefert `any`. In der Datei, die Schema, Migrationen und
// das Admin-Startpasswort verantwortet, ist das die falsche Stelle zum Sparen.
//
// NICHT gehoben: ../utils/partsSummary (Ladezyklus, Begruendung an der Stelle
// selbst) und ../package.json — das ist keine Abhaengigkeit des Moduls,
// sondern ein Lesevorgang mit Rueckfall.

// ── NUMERIC kommt als Zahl zurück, nicht als Zeichenkette ───────────────────
//
// Seit db/migrations/0007 liegen alle Geldbeträge als NUMERIC in der Datenbank
// statt als REAL — sonst rechnet Postgres in 32-Bit-Gleitkomma, und die Summe
// aus 1000 Beträgen à 0.07 ergibt 69.99974 statt 70.00.
//
// Der pg-Treiber liefert NUMERIC standardmässig als ZEICHENKETTE, weil der
// Typ mehr Stellen darstellen kann als eine JavaScript-Zahl. Ohne diesen
// Parser würde aus `preis * menge` schlagartig eine Zeichenketten-Multiplikation
// an hunderten Stellen — und wo bisher `0` stand, stünde `"0.0000"`, was in
// einer if-Abfrage wahr ist. Genau diese Sorte stiller Fehler soll die
// Umstellung nicht eintauschen.
//
// Deshalb: NUMERIC wird beim Lesen zu einer JavaScript-Zahl. Der Gewinn bleibt
// vollständig erhalten, denn er liegt beim SPEICHERN und beim RECHNEN IN DER
// DATENBANK — dort ist jetzt alles exakt dezimal. Eine JavaScript-Zahl trägt
// gut 15 signifikante Stellen; Beträge in dieser Anwendung brauchen höchstens
// zehn.
pgTypes.setTypeParser(pgTypes.builtins.NUMERIC, (v: any) => (v === null ? null : parseFloat(v)));

// ── Connection pool ───────────────────────────────────────────────────────────
// With clustering, each worker has its own pool.
// Total connections = workers × max_per_worker must stay under PG max_connections (100).
// With 4 workers × 10 connections = 40, leaving headroom for admin tools.
const NUM_WORKERS = parseInt(String(process.env.WEB_WORKERS || require('os').cpus().length));
const MAX_PER_WORKER = Math.max(5, Math.min(15, Math.floor(80 / Math.max(1, NUM_WORKERS))));

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

const baseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host:     process.env.PGHOST     || 'postgres',
      port:     parseInt(process.env.PGPORT || '5432'),
      user:     process.env.PGUSER     || 'brickinventory',
      password: process.env.PGPASSWORD || 'brickinventory_secret',
      database: process.env.PGDATABASE || 'brickinventory',
    };

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
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
]);

/**
 * Eine Abfrage mit Wiederholung bei transienten Fehlern ausführen.
 *
 * Generisch typisiert, damit der Rückgabetyp der übergebenen Funktion
 * durchgereicht wird. Ohne das leitete TypeScript unter strictNullChecks an
 * vielen Aufrufstellen `never` ab — und meldete dann Folgefehler der Art
 * "Property 'name' does not exist on type 'never'", die wie ein Problem der
 * Aufrufstelle aussehen, aber alle hierher zurückführten.
 *
 * @template T
 * @param {() => Promise<T>} queryFn
 * @param {number} maxRetries
 * @returns {Promise<T>}
 */
async function queryWithRetry<T>(queryFn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (err) {
      lastErr = err;
      // `?? ''` statt eines Nicht-Null-Ausrufezeichens: Ein Fehler ohne Code
      // ist eben nicht wiederholbar, und der leere String faellt sauber
      // durch die Menge — genau das Verhalten von vorher, nur ohne `any`.
      if (!RETRYABLE_CODES.has(fehlerCode(err) ?? '') || attempt === maxRetries) throw err;
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
 *
 * Rückgabetyp bewusst `any[]` und nicht generisch: Die Aufrufstellen greifen
 * auf Spalten zu, deren Namen erst im SQL stehen. Ein generischer Parameter
 * würde an jeder der rund 400 Aufrufstellen eine Typangabe verlangen, ohne dass
 * jemand sie pflegt — und eine gepflegte Lüge ist schlechter als ein ehrliches
 * any. Wichtig ist, dass es NICHT `never` oder `unknown` ist (siehe
 * queryWithRetry).
 */
/**
 * Die Abfrage-Schnittstelle, die dieses Modul anbietet — einmal als Typ.
 *
 * ── Warum benannt statt inline (Nachtrag 155) ────────────────────────────────
 * transaction() reicht dem Rueckruf ein Objekt mit genau diesen vier Methoden.
 * Beide Seiten hatten bisher keinen Typ: Der Rueckruf-Parameter war implizit
 * `any`, damit war jeder Aufruf darin ungeprueft — auch `tx.gett(...)` waere
 * durchgegangen und erst zur Laufzeit als "is not a function" aufgeschlagen.
 * Als Typ steht die Zusage einmal geschrieben, und die transaktionsgebundene
 * Fassung muss sie einhalten.
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
  });
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
  });
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
  });
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

// ── SQL dialect translation (entfernt) ────────────────────────────────────────
// Hier stand eine SQLite→PostgreSQL-Übersetzung aus der Migrationszeit. Sie ist
// ersatzlos entfallen, weil sie zwei Klassen stiller Fehler produziert hat:
//
//   1. Sie hat an JEDES INSERT ohne ON CONFLICT automatisch
//      " ON CONFLICT DO NOTHING" angehängt. Damit wurden Unique-Verletzungen
//      global verschluckt: `POST /api/auth/users` meldete `success: true`,
//      obwohl kein Nutzer angelegt wurde, und der 23505-Zweig im catch war
//      toter Code. Ausserdem war deshalb "INSERT … RETURNING" verboten, was
//      db.run()s lastID dauerhaft auf null festgenagelt hat.
//   2. Sie hat JEDES Fragezeichen durch $n ersetzt — auch in String-Literalen
//      ("LIKE '%?%'") und in den JSONB-Operatoren ?, ?| und ?&. Bei
//      csv_import_jobs.results (JSONB) ist das keine Theorie.
//
// Voraussetzung für die Entfernung (geprüft): es gibt in der Codebasis kein
// "INSERT OR IGNORE/REPLACE", kein datetime(), kein GLOB und keinen einzigen
// ?-Platzhalter mehr — alle Queries sind bereits nativ PostgreSQL mit
// $n-Platzhaltern. Jedes INSERT, das idempotent sein soll, trägt sein
// ON CONFLICT jetzt sichtbar an der Aufrufstelle.
//
// Die Funktion selbst ist jetzt ebenfalls weg. Sie blieb zuletzt als
// Identitätsfunktion bestehen ("könnte mal ein Hook für Query-Timing werden") —
// das kostete auf jedem Query-Pfad einen Aufruf und suggerierte beim Lesen,
// dass hier noch etwas übersetzt wird. Ein Hook lässt sich einbauen, wenn er
// gebraucht wird; bis dahin ist das Nichts ehrlicher.


/**
 * Das Grundschema von der Platte lesen.
 *
 * Einmal je Prozess: Beim Start rufen mehrere Arbeitsprozesse initSchema(),
 * und die Datei ändert sich zur Laufzeit nicht.
 *
 * Der Pfad geht über __dirname, NICHT über APP_ROOT.
 *
 * Mein erster Versuch nahm APP_ROOT und wäre im Container gescheitert: Das
 * Laufzeit-Image enthält nur dist/ — die Quellen bleiben im Build-Stage
 * zurück. `${APP_ROOT}/db/schema.sql` gibt es dort also gar nicht.
 *
 * Dass die Datei überhaupt in dist/ landet, besorgt scripts/build-ts.js: Es
 * kopiert .sql-Dateien ausdrücklich mit (ASSET_EXT) — eine Vorkehrung, die
 * dieses Projekt schon einmal teuer gelernt hat. db/migrate.ts macht es aus
 * demselben Grund genauso.
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
 *
 * ── Warum in Etappen (Nachtrag 148) ─────────────────────────────────────────
 * Die Funktion war 408 Zeilen lang und tat fünf verschiedene Dinge
 * hintereinander. Wer eine davon suchte, las die anderen vier mit; und die
 * REIHENFOLGE — die hier eine echte Bedingung ist und nicht nur Gewohnheit —
 * stand nur als Kommentar mitten im Rumpf.
 *
 * Jetzt steht sie als Liste. Die Regel dahinter: Erst alle Tabellen und
 * Spalten, dann die Indizes. Ein Index auf eine Spalte, die eine spätere
 * ALTER-Migration erst anlegt, scheitert bei einer Neuinstallation mit
 * "column does not exist".
 */
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
  // ── Ein Preiseintrag je Set, Zustand, Währung und TAG ───────────────────────
  //
  // Zwei Schreibwege (jobs/priceJob.ts beim Abruf, utils/financeCalc.ts) tragen
  // `ON CONFLICT DO NOTHING` — die Tabelle hatte aber nur den Primärschlüssel
  // auf id. Ohne passenden Unique-Index kann die Klausel nie greifen: Sie liest
  // sich wie ein Schutz gegen Dubletten und ist keiner. Jede Preisabfrage legte
  // eine weitere Zeile an, und die Portfolio-Kurve liest sie alle.
  //
  // Der Index macht die Klausel wahr. `recorded_at::date` wäre nicht
  // unveränderlich (hängt an der Zeitzone der Sitzung) und dürfte nicht in
  // einen Index — deshalb ausdrücklich in UTC.
  //
  // Vorhandene Dubletten müssen vorher weg, sonst scheitert das Anlegen. Es
  // gewinnt der jüngste Eintrag des Tages; genau den hätte die Auswertung auch
  // genommen.
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
  // ── Migrations: add columns to existing tables ──────────────────────────────
  // sets table migrations
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
  await pool.query(
    "UPDATE users SET is_active=1, email_verified=1 WHERE is_admin=1"
  ).catch(()=>{});
  await pool.query(
    "UPDATE users SET is_active=COALESCE(is_active,1), email_verified=COALESCE(email_verified,0)"
  ).catch(()=>{});

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
      used_at    TIMESTAMPTZ
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_qr_login_expires ON qr_login_tokens(expires_at)');

  // api_tokens: Ablaufdatum indizieren — purgeExpiredTokens() räumt darüber auf.
  await pool.query('CREATE INDEX IF NOT EXISTS idx_api_tokens_expires ON api_tokens(expires_at) WHERE expires_at IS NOT NULL')
    .catch(e => console.warn('[db] idx_api_tokens_expires:', e.message));
  // Gegenstück für die zweite Aufräumregel: Tokens OHNE Ablaufdatum (App und
  // QR-Login), die seit TOKEN_IDLE_DAYS ungenutzt sind. Die Tabelle ist klein,
  // aber die beiden Regeln sollen dieselbe Unterstützung haben.
  await pool.query('CREATE INDEX IF NOT EXISTS idx_api_tokens_idle ON api_tokens(last_used) WHERE expires_at IS NULL')
    .catch(e => console.warn('[db] idx_api_tokens_idle:', e.message));

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
  //
  // VORHER: Immer 'admin' / 'admin'. Das ist kein Startwert, den man später
  // ändert, sondern ein öffentlich bekanntes Credential — jede erreichbare
  // Installation, deren Betreiber den Login-Screen nicht sofort besucht, ist
  // damit sofort übernehmbar (Shodan-Scans nach genau diesem Muster sind
  // Alltag). Jetzt: ADMIN_PASSWORD aus der Umgebung, falls gesetzt (für
  // automatisierte Deployments); sonst ein zufälliges Passwort, das NUR beim
  // allerersten Start in die Logs geschrieben wird und dessen Konto als
  // "muss geändert werden" markiert ist (must_change_password s.o.).
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
      // ── NICHT über console.log ──────────────────────────────────────────
      //
      // „NUR JETZT sichtbar" stimmte nicht mehr: Der Log-Abfänger in server.ts
      // schreibt JEDE Konsolenzeile nach app_logs, und der Admin-Log-Viewer
      // (GET /api/v1/admin/logs) gab das Passwort 48 Stunden lang im Klartext
      // wieder aus — mitsamt jedem Datenbank-Backup aus diesem Zeitraum.
      //
      // Direkt auf stdout geschrieben, geht die Zeile am Abfänger vorbei und
      // steht nur dort, wo sie hingehört: im Container-Log des ersten Starts.
      // Ein Filter im Abfänger wäre die Alternative gewesen — der hinge dann
      // an einer Zeichenkette, die jemand später umformuliert.
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
    .catch(e => console.error('[db] fig_number trim:', e.message));

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
  // Backfill: existing manual parts/minifigs get one acquisition row if none exists
  await pool.query(`
    INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at)
    SELECT p.user_id, p.part_number, COALESCE(p.color_id,0), p.quantity,
           COALESCE(p.unit_price, p.purchase_price), COALESCE(p.condition,'N'), p.added_at
    FROM parts p
    WHERE p.source='manual'
    AND NOT EXISTS (
      SELECT 1 FROM part_acquisitions a
      WHERE a.user_id=p.user_id AND a.part_number=p.part_number AND a.color_id=COALESCE(p.color_id,0)
    )
  `).catch(()=>{});
  await pool.query(`
    INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, created_at)
    SELECT m.user_id, m.fig_number, m.quantity,
           COALESCE(m.unit_price, m.purchase_price), COALESCE(m.condition,'N'), m.added_at
    FROM minifigs m
    WHERE m.source='manual'
    AND NOT EXISTS (
      SELECT 1 FROM minifig_acquisitions a
      WHERE a.user_id=m.user_id AND a.fig_number=m.fig_number
    )
  `).catch(()=>{});
  console.log('  ✅ part_acquisitions + minifig_acquisitions erstellt/migriert');

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
  const partsCondExists = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name='parts' AND column_name='condition'",
  ).then(r => r.rows.length > 0).catch(() => false);
  if (!partsCondExists) {
    await pool.query("ALTER TABLE parts ADD COLUMN condition TEXT DEFAULT 'N'");
    console.log('  ✅ Migration: parts.condition hinzugefügt');
  }

  // Migration: condition column for minifigs (manual minifigs)
  const mfCondExists = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name='minifigs' AND column_name='condition'",
  ).then(r => r.rows.length > 0).catch(() => false);
  if (!mfCondExists) {
    await pool.query("ALTER TABLE minifigs ADD COLUMN condition TEXT DEFAULT 'N'");
    console.log('  ✅ Migration: minifigs.condition hinzugefügt');
  }

  // Migration: bestehende Sets ohne Kaufpreis-Historie bekommen genau eine
  // Acquisition-Zeile (Menge/Preis/Datum vom Set) — Finanzsummen bleiben identisch.
  await pool.query(`
    INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, created_at)
    SELECT s.user_id, s.set_number, s.quantity, s.purchase_price, COALESCE(s.added_at, NOW())
    FROM sets s
    WHERE NOT EXISTS (
      SELECT 1 FROM set_acquisitions a
      WHERE a.user_id = s.user_id AND a.set_number = s.set_number
    )`).catch(e => console.error('[db] acquisitions backfill:', e.message));
}

/**
 * Etappe 5 — Indizes und die vorberechnete Teile-Zusammenfassung.
 *
 * ZULETZT, und das ist keine Stilfrage: Erst wenn alle Tabellen stehen und
 * alle ALTER-Migrationen durchgelaufen sind, referenziert ein Index garantiert
 * nur vorhandene Spalten. Sonst scheitert eine Neuinstallation an
 * "relation/column does not exist", sobald jemand weiter oben eine Spalte
 * ergänzt.
 */
async function indizesUndZusammenfassung() {
  // ── Indizes ZULETZT anlegen ───────────────────────────────────────────────
  // Bewusst ganz am Ende, nachdem ALLE Tabellen erstellt UND alle ALTER-Migra-
  // tionen durchgelaufen sind. So referenziert ein Index garantiert nur bereits
  // existierende Spalten/Tabellen — das verhindert "relation/column does not
  // exist" bei Neuinstallationen, selbst wenn später ALTERs ergänzt werden.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_part_acq_user_part ON part_acquisitions(user_id, part_number, color_id)`).catch(e => console.error('[db] idx_part_acq:', e.message));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_minifig_acq_user_fig ON minifig_acquisitions(user_id, fig_number)`).catch(e => console.error('[db] idx_minifig_acq:', e.message));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rb_inv_setnum ON rb_inventories(set_num)`).catch(e => console.error('[db] idx_rb_inv_setnum:', e.message));
  // Kategorie-Filter/-Aggregation: beschleunigt GROUP BY category_name im
  // /categories-Endpoint und den Kategorie-Filter der Teileliste (beide je User).
  // rb_part_categories selbst braucht keinen Extra-Index: die Auflösung läuft über
  // den PRIMARY KEY (id), und die Tabelle ist mit ~65 Zeilen ohnehin winzig.
  // Gemeinsame Zähler für Brute-Force- und Missbrauchsschutz. Vorher lagen sie
  // im Prozessspeicher, womit bei N Cluster-Workern effektiv N×5 Versuche
  // möglich waren (utils/loginLimiter.ts).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rate_limit_attempts (
      key      TEXT PRIMARY KEY,
      count    INTEGER     NOT NULL DEFAULT 1,
      first_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(e => console.error('[db] rate_limit_attempts:', e.message));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rate_limit_first_at ON rate_limit_attempts(first_at)`).catch(() => {});


  await pool.query(`CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(user_id, category_name)`).catch(e => console.error('[db] idx_parts_category:', e.message));
  // Funktionaler Index auf genau den Ausdruck, nach dem getParts() gruppiert.
  // Ohne ihn muss Postgres COALESCE(bl_part_number, part_number) für jede der
  // Zeilen neu berechnen. Gemessen an 380 Sets / 171'000 Zeilen halbiert er die
  // Zeit einer Seitenabfrage (372 ms → 190 ms).
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_parts_group ON parts(user_id, (COALESCE(bl_part_number, part_number)), color_id)`).catch(e => console.error('[db] idx_parts_group:', e.message));
  // Vorberechnete Teile-Zusammenfassung inkl. Trigger zur Entwertung.
  //
  // require() ABSICHTLICH hier unten, nicht oben: utils/partsSummary importiert
  // (ueber Umwege) auf db/database zurueck. Ein Top-Level-Import schloesse den
  // Ladezyklus, und dann waere eines der beiden Module beim Laden des anderen
  // noch halb leer — ein Fehler, der sich erst zur Laufzeit und nur manchmal
  // zeigt. Nachgeprueft mit einer Zyklus-Analyse ueber alle Top-Level-Importe
  // des Baums; im ganzen Projekt sind es 5 solche Stellen.
  await require('../utils/partsSummary').initPartsSummary(pool).catch((e: any) => console.error('[db] parts_summary:', e.message));
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
// Replaces INSERT OR REPLACE patterns with proper PostgreSQL upserts

/**
 * Upsert a row.
 * upsert(table, { col: val, ... }, conflictCols, updateCols)
 */
async function upsert(
  table: string,
  data: Record<string, any>,
  conflictCols: string[],
  updateCols?: string[] | null,
): Promise<{ changes: number | null }> {
  const keys   = Object.keys(data);
  const vals   = Object.values(data);
  const nums   = keys.map((_, i) => `$${i + 1}`);
  const update = (updateCols || keys.filter(k => !conflictCols.includes(k)))
    .map((k: string) => `${k} = EXCLUDED.${k}`)
    .join(', ');

  const sql = `
    INSERT INTO ${table} (${keys.join(', ')})
    VALUES (${nums.join(', ')})
    ON CONFLICT (${conflictCols.join(', ')})
    ${update ? `DO UPDATE SET ${update}` : 'DO NOTHING'}
  `;
  const result = await pool.query(sql, vals);
  return { changes: result.rowCount };
}

// initSchemaOnce: wraps initSchema with a PostgreSQL advisory lock (55667788)
// so only one cluster worker runs migrations at a time.
// Other workers poll (non-blocking) until migrating worker is done.
// Falls back to direct execution after 30s timeout.
async function initSchemaOnce() {
  const LOCK_ID = LOCKS.SCHEMA_INIT;
  // Fassung dieses Deployments. Der postinstall-Hook (scripts/bump-version.js)
  // setzt sie bei jeder Installation neu — sie ändert sich also genau dann,
  // wenn auch neue Migrationen dazugekommen sein können.
  let appVersion = 'unknown';
  try { appVersion = require('../package.json').version || 'unknown'; } catch (_) {}
  // Blockierender Advisory-Lock auf einer DEDIZIERTEN Verbindung: So führt im
  // Cluster immer nur EIN Worker die Schema-Migration gleichzeitig aus. Andere
  // Worker warten hier, bis der Lock frei ist, und rufen initSchema danach als
  // No-op auf (CREATE TABLE/INDEX IF NOT EXISTS finden alles vor).
  //
  // Wichtig: Lock und Unlock MÜSSEN auf derselben Session laufen — über den Pool
  // (pool.query) landet der Unlock sonst evtl. auf einer anderen Verbindung und
  // greift nicht. Ausserdem ist "CREATE TABLE IF NOT EXISTS" unter Nebenläufig-
  // keit NICHT sicher (zwei Worker → duplicate key in pg_type), was genau diese
  // Serialisierung verhindert. Stürzt der Lock-Halter ab, wird die Session (und
  // damit der Lock) automatisch freigegeben, sodass kein Worker dauerhaft hängt.
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${LOCK_ID})`);

    // Der Lock serialisiert nur — bisher lief initSchema() danach in JEDEM
    // Worker vollständig durch. Bei vier Workern also viermal alle 84
    // CREATE-/ALTER-Anweisungen plus Migrationen und Backfills, nacheinander.
    // Korrekt (alles ist IF NOT EXISTS), aber unnötig: Der erste Worker hat die
    // Arbeit bereits erledigt.
    //
    // Deshalb ein Vermerk in der DB. Steht dort die Fassung dieses Deployments,
    // ist nichts mehr zu tun. Nach einem Update ändert sich die Version und die
    // Migration läuft genau einmal erneut.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        id              INTEGER PRIMARY KEY DEFAULT 1,
        applied_version TEXT NOT NULL,
        applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT schema_meta_single_row CHECK (id = 1)
      )`);

    const done = await client.query(
      'SELECT applied_version FROM schema_meta WHERE id = 1 AND applied_version = $1',
      [appVersion]);

    // rowCount ist bei pg für Nicht-SELECT null — hier immer eine Zahl, aber
    // der Typ weiss das nicht.
    if ((done.rowCount ?? 0) > 0 && process.env.FORCE_SCHEMA_INIT !== '1') {
      // Kurze Meldung statt des kompletten Migrationsprotokolls je Worker.
      console.log(`✅ Schema aktuell (${appVersion}) — Migration übersprungen`);
    } else {
      await initSchema();
      await client.query(`
        INSERT INTO schema_meta (id, applied_version, applied_at) VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE SET applied_version = $1, applied_at = NOW()`,
        [appVersion]);
    }

    // Nummerierte Migrationen — laufen IMMER, auch wenn initSchema()
    // übersprungen wurde.
    //
    // Der Vermerk in schema_meta beantwortet nur "lief initSchema für diese
    // App-Version schon?". Neue Migrationen müssen davon unabhängig geprüft
    // werden: Sie haben ihre eigene Buchführung in schema_migrations und sind
    // die Stelle, an der ab jetzt jede Schemaänderung landet (siehe
    // db/migrate.ts). Läuft auf derselben Verbindung wie der Advisory-Lock,
    // also im Cluster serialisiert.

    const applied = await runMigrations(client);
    if (applied.length) console.log(`✅ ${applied.length} Migration(en) angewandt`);

    // ── Bild-Hilfsdienste: NACH den Migrationen, in JEDEM Arbeitsprozess ────
    //
    // Nach den Migrationen, weil sie die Tabellen brauchen (0009). In jedem
    // Arbeitsprozess, weil sie PROZESS-LOKAL sind: Der Merker für fehlende
    // Bilder lädt seinen Bestand in den Speicher, und der Puffer des Bild-Jobs
    // bekommt seinen Schreib-Takt. Stünden sie in initSchema(), liefen sie nur
    // in dem einen Worker, der gerade migriert — genau der Fehler, der drei
    // Viertel aller Notizen verschwinden liess.
    await initImageMisses()
      .catch((e: any) => console.error('[db] image_misses:', e.message));
    await initImageQueue()
      .catch((e: any) => console.error('[db] image_wanted:', e.message));
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${LOCK_ID})`).catch(() => {});
    client.release();
  }
}

/**
 * Eine EIGENE Verbindung, die NICHT aus dem Pool kommt.
 *
 * ── Wofür (Nachtrag 115) ────────────────────────────────────────────────────
 * Für Sitzungssperren, die über eine lange Arbeit gehalten werden müssen —
 * etwa während eine Vorschau berechnet wird.
 *
 * Aus dem Pool wäre das falsch: Der Pool ist auf 10–15 Verbindungen je
 * Arbeitsprozess ausgelegt und dafür da, ANFRAGEN zu bedienen. Wer eine davon
 * über Sekunden festhält, nimmt sie genau dort weg. Auf dem Primärprozess
 * halten Preis-Job, Anleitungs-Warteschlange und Teile-Anreicherung ohnehin
 * schon je eine — und dieser Prozess bedient nebenbei auch noch Anfragen.
 *
 * Genau daran ist es aufgelaufen: `timeout exceeded when trying to connect`
 * in getSets, während die Bildarbeit lief.
 */
async function eigeneVerbindung() {
  const c = new Client({ ...baseConfig });
  await c.connect();
  return c;
}

export { pool, all, get, run, exec, transaction, upsert, initSchema, initSchemaOnce, getPoolStats, eigeneVerbindung };
