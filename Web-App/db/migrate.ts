/**
 * Schema-Migrationen mit nummerierten Dateien.
 * Ausführlich: docs/begruendungen/db/migrate.ts.md#abschnitt
 */
import fs from 'fs';
import path from 'path';
import { meldeUndWeiter, fehlertext } from '../utils/httpError';

/**
 * Alle noch nicht angewandten Migrationen ausführen.
 * Ausführlich: docs/begruendungen/db/migrate.ts.md#runmigrations
 * @param {any} client Eine DEDIZIERTE pg-Verbindung (nicht der Pool), damit
 * @returns {Promise<string[]>} Namen der neu angewandten Migrationen
 */
async function runMigrations(client: any, { sichern = false }: { sichern?: boolean } = {}): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return [];

  // Lexikografisch sortieren — deshalb die vierstellige Nummer im Dateinamen.
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  if (!files.length) return [];

  const { rows } = await client.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r: any) => r.name));

  const offen = files.filter(f => !done.has(f));
  if (offen.length && sichern) await sichereNutzerdaten(client, offen);

  const applied: string[] = [];
  for (const file of offen) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // Eine Transaktion je Datei: entweder ganz oder gar nicht.
    await client.query('BEGIN');
    try {
      // Die 30 s des Pools gelten für Anfragen, nicht für den Umbau einer
      // grossen Tabelle; ein Abbruch mittendrin hiesse Neustart in Schleife.
      await client.query('SET LOCAL statement_timeout = 0');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
      console.log(`  ✅ Migration angewandt: ${file}`);
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      // Bewusst weiterwerfen: Der Start bricht ab. Ein Server, der auf einem
      // halb migrierten Schema weiterläuft, produziert Folgefehler, die
      // niemand mehr auf diese Stelle zurückführt.
      throw new Error(`Migration ${file} fehlgeschlagen: ${e.message}`);
    }
  }
  return applied;
}

const SICHERUNGEN_BEHALTEN = 3;

/**
 * Vor offenen Migrationen die Tabellen mit Nutzerdaten (users und alles mit
 * user_id) in ein eigenes Schema kopieren. Der Container hat kein pg_dump, und
 * eine Migration, die Daten umformt, lässt sich ohne Kopie nicht zurücknehmen.
 * Die drei jüngsten Sicherungen bleiben; Wiederherstellen steht im README.
 */
async function sichereNutzerdaten(client: import('pg').ClientBase, offen: string[]): Promise<string> {
  const schema = `vor_migration_${new Date().toISOString().replace(/\D/g, '').slice(0, 17)}`;
  const { rows } = await client.query<{ name: string }>(`
    SELECT DISTINCT c.table_name AS name
      FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       AND (c.column_name = 'user_id' OR c.table_name = 'users')
     ORDER BY 1`);
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL statement_timeout = 0');
    await client.query(`CREATE SCHEMA ${schema}`);
    for (const { name } of rows) {
      const t = client.escapeIdentifier(name);
      await client.query(`CREATE TABLE ${schema}.${t} AS TABLE public.${t}`);
    }
    await client.query(`COMMENT ON SCHEMA ${schema} IS ${client.escapeLiteral(`vor ${offen.join(', ')}`)}`);
    await client.query('COMMIT');
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch((r: unknown) => meldeUndWeiter('migration:sicherung', r));
    throw new Error(`Sicherung vor den Migrationen fehlgeschlagen: ${fehlertext(e)}`);
  }
  const alt = await client.query<{ nspname: string }>(`
    SELECT nspname FROM pg_namespace WHERE nspname ~ '^vor_migration_[0-9]+$'
     ORDER BY nspname DESC OFFSET ${SICHERUNGEN_BEHALTEN}`);
  for (const { nspname } of alt.rows) await client.query(`DROP SCHEMA ${client.escapeIdentifier(nspname)} CASCADE`);
  console.log(`  💾 ${rows.length} Tabellen mit Nutzerdaten nach ${schema} gesichert`);
  return schema;
}

export { runMigrations, sichereNutzerdaten };
