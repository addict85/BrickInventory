/**
 * Schema migrations with numbered files.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ClientBase } from 'pg';
import { reportError, errorMessage, logAndContinue } from '../src/infra/error';
import type { DbInterface } from './types';

/** How long a migration waits for a lock and how often it tries. */
export interface LockPeriod {
  fristMs: number;
  versuche: number;
}

/** If another process holds a table (web process in the middle of a request,
 * open psql session), the migration service would hang silently without a deadline. With a deadline
 * it names the reason, tries again and gives up after the attempts. */
export const LOCK_PERIOD: LockPeriod = { fristMs: 30_000, versuche: 3 };

async function withLockPeriod<T>(was: string, frist: LockPeriod, work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (e) {
      if ((e as { code?: string }).code !== '55P03') throw e;
      const grund =
        `${was}: nach ${frist.fristMs / 1000} s keine Sperre erhalten – eine andere Verbindung hält die ` +
        'Tabelle (welche, zeigt pg_stat_activity).';
      if (attempt >= frist.versuche) throw new Error(`${grund} Aufgegeben nach ${attempt} Versuchen.`);
      console.warn(`  ⏳ ${grund} Versuch ${attempt + 1}/${frist.versuche} …`);
    }
  }
}

/** All migrations not yet applied; `client` is a connection of its own, not the pool. */
async function runMigrations(
  client: ClientBase,
  { sichern = false, sperre = LOCK_PERIOD }: { sichern?: boolean; sperre?: LockPeriod } = {},
): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS pruefsumme TEXT');

  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return [];

  // Sort lexicographically — hence the four-digit number in the file name.
  // Gaps (0002, 0028) are intended: a dropped migration does not pass its number on.
  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  if (!files.length) return [];

  const { rows }: { rows: Applied[] } = await client.query('SELECT name, pruefsumme FROM schema_migrations');
  const done = new Set(rows.map(r => r.name));
  await checkApplied(client, dir, rows);

  const open = files.filter(f => !done.has(f));
  if (open.length && sichern) await secureUserData(client, open, sperre);

  const applied: string[] = [];
  for (const file of open) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // One transaction per file: all or nothing.
    try {
      await withLockPeriod(`Migration ${file}`, sperre, async () => {
        await client.query('BEGIN');
        try {
          // The pool's 30 s apply to requests, not to rebuilding a
          // large table; an abort in the middle would mean a restart loop.
          await client.query('SET LOCAL statement_timeout = 0');
          await client.query(`SET LOCAL lock_timeout = ${Math.trunc(sperre.fristMs)}`);
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name, pruefsumme) VALUES ($1, $2)', [file, checksum(sql)]);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK').catch(logAndContinue('migration:query'));
          throw e;
        }
      });
    } catch (e) {
      // Rethrow on purpose: startup aborts. A server that keeps running on a
      // half-migrated schema produces follow-up errors that
      // nobody traces back to this place anymore.
      throw new Error(`Migration ${file} fehlgeschlagen: ${(e as Error).message}`);
    }
    applied.push(file);
    console.log(`  ✅ Migration angewandt: ${file}`);
  }
  return applied;
}

interface Applied {
  name: string;
  pruefsumme: string | null;
}

/** SHA-256 of the content; line endings do not count (a Windows checkout is the same migration). */
function checksum(sql: string): string {
  return crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** An applied migration must not change, otherwise there would be two
 * schemas under one name. If the sum is missing (older row), it is
 * filled in once. */
async function checkApplied(client: ClientBase, dir: string, rows: Applied[]): Promise<void> {
  const changed: string[] = [];
  for (const r of rows) {
    const file = path.join(dir, r.name);
    if (!fs.existsSync(file)) continue;
    const actual = checksum(fs.readFileSync(file, 'utf8'));
    if (r.pruefsumme === null)
      await client.query('UPDATE schema_migrations SET pruefsumme = $2 WHERE name = $1', [r.name, actual]);
    else if (r.pruefsumme !== actual) changed.push(r.name);
  }
  if (changed.length)
    throw new Error(
      `Schon angewandte Migration(en) nachträglich geändert: ${changed.join(', ')}. ` +
        'Den alten Inhalt wiederherstellen und die Änderung als neue Migration anlegen.',
    );
}

const BACKUPS_KEPT = 3;
/** Nobody needs a copy longer than this to undo a failed update;
 * after that it would only be a place where deleted accounts live on. */
export const BACKUP_DEADLINE_DAYS = 30;
const BACKUP_SCHEMA = '^vor_migration_[0-9]{17}$';

type Querier = Pick<DbInterface, 'all' | 'run'>;
const viaClient = (c: ClientBase): Querier => ({
  all: async <T>(q: string, p?: unknown[]) => (await c.query(q, p)).rows as T[],
  run: async (q: string, p?: unknown[]) => ({ changes: (await c.query(q, p)).rowCount ?? 0 }),
});

/** Copies older than `tage` (the date is in the schema name, UTC). The runtime role
 * does not own them and may not drop them; it empties them so no
 * deleted account lives on in them, and the next run of the migration
 * service removes the empty schema. @returns dropped or emptied schemas */
export async function cleanOldBackupsOn(c: Querier, days = BACKUP_DEADLINE_DAYS): Promise<number> {
  const rows = await c.all<{ nspname: string; eigen: boolean }>(
    `
    SELECT nspname, pg_has_role(nspowner, 'USAGE') AS eigen FROM pg_namespace WHERE nspname ~ '${BACKUP_SCHEMA}'
       AND to_timestamp(substr(nspname, 15, 14), 'YYYYMMDDHH24MISS') AT TIME ZONE 'UTC'
           < NOW() - make_interval(days => $1)`,
    [days],
  );
  let n = 0;
  for (const { nspname, eigen } of rows) {
    if (eigen) {
      await c.run(`DROP SCHEMA "${nspname}" CASCADE`);
      n++;
      continue;
    }
    let emptied = 0;
    for (const { relname } of await c.all<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relnamespace = $1::regnamespace AND relkind = 'r'`,
      [nspname],
    ))
      emptied += (await c.run(`DELETE FROM "${nspname}"."${relname.replace(/"/g, '""')}"`)).changes;
    if (emptied) n++;
  }
  return n;
}

/** Migration files missing from schema_migrations; without the table all of them. */
export async function openMigrations(client: ClientBase): Promise<string[]> {
  const dir = path.join(__dirname, 'migrations');
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter(f => f.endsWith('.sql'))
        .sort()
    : [];
  if (!(await client.query(`SELECT to_regclass('public.schema_migrations') AS t`)).rows[0].t) return files;
  const finished = new Set(
    (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(z => z.name),
  );
  return files.filter(f => !finished.has(f));
}

/** A deleted account also from the copies, in the deleting transaction, so no copy
 * outlives the account. Through the owner's function (migration 0119): the web system role
 * may not read the copies itself. */
export async function removeAccountFromBackups(c: Querier, uid: number): Promise<number> {
  return (await c.all<{ n: number }>('SELECT konto_aus_sicherungen_loeschen($1) AS n', [uid]))[0]?.n ?? 0;
}

/** Before open migrations, copy the user data (users, tables with user_id or
 * a foreign key to users) into a schema of its own: the container has
 * no pg_dump, and a transforming migration cannot be undone without a copy.
 * Three backups are kept; restoring is described in the README. */
async function secureUserData(client: ClientBase, open: string[], sperre = LOCK_PERIOD): Promise<string> {
  const schema = `vor_migration_${new Date().toISOString().replace(/\D/g, '').slice(0, 17)}`;
  const { rows } = await client.query<{ name: string }>(`
    SELECT DISTINCT c.table_name AS name
      FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       AND (c.column_name = 'user_id' OR c.table_name = 'users')
    UNION
    SELECT r.relname FROM pg_constraint k
      JOIN pg_class r ON r.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE k.contype = 'f' AND k.confrelid = 'public.users'::regclass AND n.nspname = 'public'
     ORDER BY 1`);
  try {
    await withLockPeriod('Sicherung vor den Migrationen', sperre, async () => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL statement_timeout = 0');
        await client.query(`SET LOCAL lock_timeout = ${Math.trunc(sperre.fristMs)}`);
        await client.query(`CREATE SCHEMA ${schema}`);
        for (const { name } of rows) {
          const t = client.escapeIdentifier(name);
          await client.query(`CREATE TABLE ${schema}.${t} AS TABLE public.${t}`);
          // The copy carries no policy of the original: without a policy the runtime role sees no row.
          await client.query(`ALTER TABLE ${schema}.${t} ENABLE ROW LEVEL SECURITY`);
        }
        await client.query(`COMMENT ON SCHEMA ${schema} IS ${client.escapeLiteral(`vor ${open.join(', ')}`)}`);
        await client.query('COMMIT');
      } catch (e: unknown) {
        await client.query('ROLLBACK').catch((r: unknown) => reportError('migration:sicherung', r));
        throw e;
      }
    });
  } catch (e: unknown) {
    throw new Error(`Sicherung vor den Migrationen fehlgeschlagen: ${errorMessage(e)}`);
  }
  const alt = await client.query<{ nspname: string }>(`
    SELECT nspname FROM pg_namespace WHERE nspname ~ '^vor_migration_[0-9]+$'
     ORDER BY nspname DESC OFFSET ${BACKUPS_KEPT}`);
  for (const { nspname } of alt.rows) await client.query(`DROP SCHEMA ${client.escapeIdentifier(nspname)} CASCADE`);
  await cleanOldBackupsOn(viaClient(client));
  console.log(`  💾 ${rows.length} Tabellen mit Nutzerdaten nach ${schema} gesichert`);
  return schema;
}

export { runMigrations, secureUserData };
