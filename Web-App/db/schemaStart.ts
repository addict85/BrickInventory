/** First start and migrations at startup: base into an empty database, open
 * migrations under a lock, checks for the runtime role. */
import fs from 'node:fs';
import path from 'node:path';
import type { Client, Pool } from 'pg';
import { runMigrations, openMigrations } from './migrate';
import { LOCKS } from '../src/infra/lockNamespaces';
import { logAndContinue } from '../src/infra/error';

/** What happens after loading the base into an empty database (the first
 * account). The database layer knows no accounts; whoever creates the access passes it along. */
export type FirstStart = () => Promise<void>;

// The oldest migration an existing database may build on: db/base.sql
// and all migrations after it only know schemas from here on. Anything older first
// installs a version that still includes the earlier startup stages (UPGRADE.md).
const MINIMUM_VERSION = '0050-teilezaehler-nur-bestehende-konten.sql';

/** An EMPTY database gets db/base.sql (an image of the migrations), then
 * only the newer migrations; an existing one stays untouched.
 * true if the base was loaded. */
export async function initSchema(ownConnection: () => Promise<Client>, firstStart?: FirstStart): Promise<boolean> {
  const c = await ownConnection();
  try {
    const leer = !(await c.query("SELECT to_regclass('public.users') AS t")).rows[0].t;
    if (!leer) return false;
    // A connection of its own, because the base sets session values (SET …) that
    // would otherwise stick to a pool connection.
    await c.query('BEGIN');
    await c.query(fs.readFileSync(path.join(__dirname, 'base.sql'), 'utf8'));
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch((r: Error) => console.warn('[schema] ROLLBACK gescheitert:', r.message));
    throw e;
  } finally {
    await c.end().catch((r: Error) => console.warn('[schema] Verbindung schliessen:', r.message));
  }
  if (firstStart) await firstStart();
  else console.warn('⚠️  [schema] Leere Datenbank ohne Erststart: kein erstes Konto angelegt.');
  console.log('✅ PostgreSQL schema ready');
  return true;
}

// First start and migrations under an advisory lock (LOCKS.SCHEMA_INIT):
// if web and jobs start at once, exactly one migrates; the other waits.
// The runtime role (compose.yaml) may not change the schema: it only checks
// whether the migration service is done, instead of failing at CREATE.
/** `systemPool` writes the time zone when the runtime role only checks: it may only read global_settings (0117). */
export async function initSchemaOnce(
  pool: Pool,
  initSchema: () => Promise<boolean>,
  timeZone: string,
  systemPool: Pool = pool,
): Promise<void> {
  const client = await pool.connect();
  try {
    // Waiting for the other process is intended here, even longer than lock_timeout
    // and statement_timeout: a long migration there would abort the start (57014).
    await client.query('SET lock_timeout = 0');
    await client.query('SET statement_timeout = 0');
    await client.query(`SELECT pg_advisory_lock(${LOCKS.SCHEMA_INIT})`);
    await client.query('RESET statement_timeout');
    if (!(await maySchemaChangeOn(client))) return await checkOnlyStatus(client, timeZone, systemPool);
    const fresh = await initSchema();
    if (!fresh) await checkMinimumVersion(client);
    // Before open migrations a copy of the user data — not for a
    // freshly created, empty database.
    const applied = await runMigrations(client, { sichern: !fresh });
    await writeEntryTimeZone(client, timeZone);
    if (applied.length) console.log(`✅ ${applied.length} Migration(en) angewandt`);
    else if (!fresh) console.log('✅ Schema aktuell — keine offenen Migrationen');
  } finally {
    // Cleanup after the actual result: its error counts, not one from here.
    for (const sql of [
      `SELECT pg_advisory_unlock(${LOCKS.SCHEMA_INIT})`,
      'RESET lock_timeout',
      'RESET statement_timeout',
    ])
      await client.query(sql).catch(logAndContinue(`db:aufräumen ${sql}`));
    client.release();
  }
}

/** The configured time zone for the trigger acquisition_day() (migration
 * 0078) — in the database, so every connection computes the same day. */
async function writeEntryTimeZone(client: import('pg').ClientBase, timeZone: string): Promise<void> {
  await client.query(
    `INSERT INTO global_settings (key, value) VALUES ('erfassung_zeitzone', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     WHERE global_settings.value IS DISTINCT FROM EXCLUDED.value`,
    [timeZone],
  );
}

export const MAY_SCHEMA_CHANGE = `SELECT has_schema_privilege('public', 'CREATE') AS d`;
async function maySchemaChangeOn(client: import('pg').ClientBase): Promise<boolean> {
  return (await client.query<{ d: boolean }>(MAY_SCHEMA_CHANGE)).rows[0]?.d === true;
}

/** For the runtime role: an empty or unmigrated schema stops the start
 * instead of requests hitting missing columns. */
async function checkOnlyStatus(client: import('pg').ClientBase, timeZone: string, systemPool: Pool): Promise<void> {
  const leer = !(await client.query("SELECT to_regclass('public.users') AS t")).rows[0].t;
  const open = leer ? [] : await openMigrations(client);
  if (leer || open.length)
    throw new Error(
      `${leer ? 'Die Datenbank ist leer' : `Migrationen offen: ${open.join(', ')}`}. Diese Rolle darf das Schema nicht ändern; ` +
        'Grundschema und Migrationen spielt der Dienst migration als Migrationsrolle ein (UPGRADE.md#migrationsrolle).',
    );
  // Usually the migration service has already written the same value; otherwise the system role.
  const da = await client.query("SELECT value FROM global_settings WHERE key = 'erfassung_zeitzone'");
  if (da.rows[0]?.value !== timeZone) {
    const sys = await systemPool.connect();
    try {
      await writeEntryTimeZone(sys, timeZone);
    } finally {
      sys.release();
    }
  }
  console.log('✅ Schema aktuell (eingespielt vom Dienst migration)');
}

/** An existing database without a migration from MINIMUM_VERSION on stops the start
 * before a migration touches it: the newer ones assume tables that are
 * missing there and would otherwise write half a schema. */
async function checkMinimumVersion(client: import('pg').ClientBase): Promise<void> {
  const { rows } = await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS da`);
  const newEnough =
    rows[0].da &&
    (await client.query('SELECT 1 FROM schema_migrations WHERE name >= $1 LIMIT 1', [MINIMUM_VERSION])).rows.length > 0;
  if (!newEnough)
    throw new Error(
      `Die Datenbank ist älter als Migration ${MINIMUM_VERSION}. Zuerst auf eine Fassung vor dem ` +
        'Entfernen der früheren Startstufen aktualisieren, dann auf diese (UPGRADE.md#stichtag-0050).',
    );
}
