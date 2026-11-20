/**
 * Schema-Migrationen mit nummerierten Dateien.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ClientBase } from 'pg';
import { reportError, fehlertext, logAndContinue } from '../src/infra/fehler';
import type { DbInterface } from './typen';

/** Wie lange eine Migration auf eine Sperre wartet und wie oft sie es versucht. */
export interface Sperrfrist {
  fristMs: number;
  versuche: number;
}

/** Hält ein anderer Prozess eine Tabelle (Web-Prozess mitten in einer Anfrage,
 * offene psql-Sitzung), hinge der Dienst migration ohne Frist still. Mit Frist
 * nennt er den Grund, versucht es erneut und gibt nach den Versuchen auf. */
export const LOCK_PERIOD: Sperrfrist = { fristMs: 30_000, versuche: 3 };

async function withLockPeriod<T>(was: string, frist: Sperrfrist, work: () => Promise<T>): Promise<T> {
  for (let versuch = 1; ; versuch++) {
    try {
      return await work();
    } catch (e) {
      if ((e as { code?: string }).code !== '55P03') throw e;
      const grund =
        `${was}: nach ${frist.fristMs / 1000} s keine Sperre erhalten – eine andere Verbindung hält die ` +
        'Tabelle (welche, zeigt pg_stat_activity).';
      if (versuch >= frist.versuche) throw new Error(`${grund} Aufgegeben nach ${versuch} Versuchen.`);
      console.warn(`  ⏳ ${grund} Versuch ${versuch + 1}/${frist.versuche} …`);
    }
  }
}

/** Alle noch nicht angewandten Migrationen; `client` ist eine eigene Verbindung, nicht der Pool. */
async function runMigrations(
  client: ClientBase,
  { sichern = false, sperre = LOCK_PERIOD }: { sichern?: boolean; sperre?: Sperrfrist } = {},
): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS pruefsumme TEXT');

  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return [];

  // Lexikografisch sortieren — deshalb die vierstellige Nummer im Dateinamen.
  // Lücken (0002, 0028) sind gewollt: Eine entfallene Migration gibt ihre Nummer nicht weiter.
  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  if (!files.length) return [];

  const { rows }: { rows: Applied[] } = await client.query('SELECT name, pruefsumme FROM schema_migrations');
  const done = new Set(rows.map(r => r.name));
  await checkApplied(client, dir, rows);

  const offen = files.filter(f => !done.has(f));
  if (offen.length && sichern) await secureUserData(client, offen, sperre);

  const applied: string[] = [];
  for (const file of offen) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // Eine Transaktion je Datei: entweder ganz oder gar nicht.
    try {
      await withLockPeriod(`Migration ${file}`, sperre, async () => {
        await client.query('BEGIN');
        try {
          // Die 30 s des Pools gelten für Anfragen, nicht für den Umbau einer
          // grossen Tabelle; ein Abbruch mittendrin hiesse Neustart in Schleife.
          await client.query('SET LOCAL statement_timeout = 0');
          await client.query(`SET LOCAL lock_timeout = ${Math.trunc(sperre.fristMs)}`);
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name, pruefsumme) VALUES ($1, $2)', [
            file,
            pruefsumme(sql),
          ]);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK').catch(logAndContinue('migration:query'));
          throw e;
        }
      });
    } catch (e) {
      // Bewusst weiterwerfen: Der Start bricht ab. Ein Server, der auf einem
      // halb migrierten Schema weiterläuft, produziert Folgefehler, die
      // niemand mehr auf diese Stelle zurückführt.
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

/** SHA-256 des Inhalts; Zeilenenden zählen nicht (ein Windows-Checkout ist dieselbe Migration). */
function pruefsumme(sql: string): string {
  return crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** Eine angewandte Migration darf sich nicht ändern, sonst gäbe es zwei
 * Schemas unter einem Namen. Fehlt die Summe (ältere Zeile), wird sie
 * einmal nachgetragen. */
async function checkApplied(client: ClientBase, dir: string, rows: Applied[]): Promise<void> {
  const geaendert: string[] = [];
  for (const r of rows) {
    const datei = path.join(dir, r.name);
    if (!fs.existsSync(datei)) continue;
    const ist = pruefsumme(fs.readFileSync(datei, 'utf8'));
    if (r.pruefsumme === null)
      await client.query('UPDATE schema_migrations SET pruefsumme = $2 WHERE name = $1', [r.name, ist]);
    else if (r.pruefsumme !== ist) geaendert.push(r.name);
  }
  if (geaendert.length)
    throw new Error(
      `Schon angewandte Migration(en) nachträglich geändert: ${geaendert.join(', ')}. ` +
        'Den alten Inhalt wiederherstellen und die Änderung als neue Migration anlegen.',
    );
}

const SICHERUNGEN_BEHALTEN = 3;
/** Länger braucht niemand eine Kopie, um ein misslungenes Update zurückzunehmen;
 * danach wäre sie nur ein Ort, an dem gelöschte Konten weiterleben. */
export const BACKUP_DEADLINE_DAYS = 30;
const SICHERUNG_SCHEMA = '^vor_migration_[0-9]{17}$';

type Abfrager = Pick<DbInterface, 'all' | 'run'>;
const viaClient = (c: ClientBase): Abfrager => ({
  all: async <T>(q: string, p?: unknown[]) => (await c.query(q, p)).rows as T[],
  run: async (q: string, p?: unknown[]) => ({ changes: (await c.query(q, p)).rowCount ?? 0 }),
});

/** Kopien älter als `tage` (Datum steht im Schemanamen, UTC). Die Laufzeitrolle
 * besitzt sie nicht und darf sie nicht löschen; sie leert sie, damit kein
 * gelöschtes Konto darin weiterlebt, und der nächste Lauf des Dienstes
 * migration räumt das leere Schema weg. @returns gelöschte oder geleerte Schemas */
export async function cleanOldBackupsOn(c: Abfrager, tage = BACKUP_DEADLINE_DAYS): Promise<number> {
  const rows = await c.all<{ nspname: string; eigen: boolean }>(
    `
    SELECT nspname, pg_has_role(nspowner, 'USAGE') AS eigen FROM pg_namespace WHERE nspname ~ '${SICHERUNG_SCHEMA}'
       AND to_timestamp(substr(nspname, 15, 14), 'YYYYMMDDHH24MISS') AT TIME ZONE 'UTC'
           < NOW() - make_interval(days => $1)`,
    [tage],
  );
  let n = 0;
  for (const { nspname, eigen } of rows) {
    if (eigen) {
      await c.run(`DROP SCHEMA "${nspname}" CASCADE`);
      n++;
      continue;
    }
    let geleert = 0;
    for (const { relname } of await c.all<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relnamespace = $1::regnamespace AND relkind = 'r'`,
      [nspname],
    ))
      geleert += (await c.run(`DELETE FROM "${nspname}"."${relname.replace(/"/g, '""')}"`)).changes;
    if (geleert) n++;
  }
  return n;
}

/** Migrationsdateien, die in schema_migrations fehlen; ohne die Tabelle alle. */
export async function openMigrations(client: ClientBase): Promise<string[]> {
  const dir = path.join(__dirname, 'migrations');
  const dateien = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter(f => f.endsWith('.sql'))
        .sort()
    : [];
  if (!(await client.query(`SELECT to_regclass('public.schema_migrations') AS t`)).rows[0].t) return dateien;
  const fertig = new Set(
    (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(z => z.name),
  );
  return dateien.filter(f => !fertig.has(f));
}

/** Ein gelöschtes Konto auch aus den Kopien, in der Transaktion des Löschens, damit keine Kopie
 * das Konto überlebt. Über die Funktion der Eigentümerin (Migration 0119): Die Web-Systemrolle
 * darf die Kopien selbst nicht lesen. */
export async function removeAccountFromBackups(c: Abfrager, uid: number): Promise<number> {
  return (await c.all<{ n: number }>('SELECT konto_aus_sicherungen_loeschen($1) AS n', [uid]))[0]?.n ?? 0;
}

/** Vor offenen Migrationen die Nutzerdaten (users, Tabellen mit user_id oder
 * Fremdschlüssel auf users) in ein eigenes Schema kopieren: Der Container hat
 * kein pg_dump, und eine umformende Migration ist ohne Kopie nicht
 * umkehrbar. Drei Sicherungen bleiben; Wiederherstellen steht im README. */
async function secureUserData(client: ClientBase, offen: string[], sperre = LOCK_PERIOD): Promise<string> {
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
          // Die Kopie trägt keine Policy des Originals: ohne Policy sieht die Laufzeitrolle keine Zeile.
          await client.query(`ALTER TABLE ${schema}.${t} ENABLE ROW LEVEL SECURITY`);
        }
        await client.query(`COMMENT ON SCHEMA ${schema} IS ${client.escapeLiteral(`vor ${offen.join(', ')}`)}`);
        await client.query('COMMIT');
      } catch (e: unknown) {
        await client.query('ROLLBACK').catch((r: unknown) => reportError('migration:sicherung', r));
        throw e;
      }
    });
  } catch (e: unknown) {
    throw new Error(`Sicherung vor den Migrationen fehlgeschlagen: ${fehlertext(e)}`);
  }
  const alt = await client.query<{ nspname: string }>(`
    SELECT nspname FROM pg_namespace WHERE nspname ~ '^vor_migration_[0-9]+$'
     ORDER BY nspname DESC OFFSET ${SICHERUNGEN_BEHALTEN}`);
  for (const { nspname } of alt.rows) await client.query(`DROP SCHEMA ${client.escapeIdentifier(nspname)} CASCADE`);
  await cleanOldBackupsOn(viaClient(client));
  console.log(`  💾 ${rows.length} Tabellen mit Nutzerdaten nach ${schema} gesichert`);
  return schema;
}

export { runMigrations, secureUserData };
