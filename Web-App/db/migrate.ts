/**
 * Schema-Migrationen mit nummerierten Dateien.
 * Ausführlich: docs/begruendungen/db/migrate.ts.md#abschnitt
 */
import fs from 'fs';
import path from 'path';

/**
 * Alle noch nicht angewandten Migrationen ausführen.
 * Ausführlich: docs/begruendungen/db/migrate.ts.md#runmigrations
 * @param {any} client Eine DEDIZIERTE pg-Verbindung (nicht der Pool), damit
 * @returns {Promise<string[]>} Namen der neu angewandten Migrationen
 */
async function runMigrations(client: any): Promise<string[]> {
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

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // Eine Transaktion je Datei: entweder ganz oder gar nicht.
    await client.query('BEGIN');
    try {
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

export { runMigrations };
