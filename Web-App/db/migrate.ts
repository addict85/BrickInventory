/**
 * Schema-Migrationen mit nummerierten Dateien.
 *
 * ── Was vorher fehlte ───────────────────────────────────────────────────────
 * initSchema() in db/database.ts ist ein rund 700 Zeilen langes Geflecht aus
 * `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS` und
 * Datenkorrekturen, das bei JEDEM Start vollständig durchläuft. Das
 * funktioniert, solange jede Anweisung für sich idempotent und von keiner
 * anderen abhängig ist — und genau da endet es:
 *
 *   • Es gibt keine Reihenfolge. Ein ALTER, das eine Spalte aus einem anderen
 *     ALTER braucht, funktioniert auf einer frischen Datenbank und scheitert
 *     auf einer alten (oder umgekehrt), je nachdem, wo man ihn einfügt.
 *   • Es gibt keinen Weg zurück. Eine fehlerhafte Änderung lässt sich nicht
 *     rückgängig machen, weil niemand weiss, was sie war.
 *   • Es gibt keine Schemaversion. `schema_meta` merkt sich die APP-Version des
 *     letzten Laufs — das beantwortet "lief initSchema schon?", nicht "welche
 *     Änderungen sind angewandt?".
 *
 * ── Wie es jetzt läuft ──────────────────────────────────────────────────────
 * Das Bestehende wird NICHT auseinandergerissen. initSchema() bleibt die
 * Grundlage (die "Baseline"): Sie stellt den Stand her, den jede Installation
 * heute hat. Alles DANACH kommt in nummerierte Dateien unter db/migrations/,
 * die genau einmal laufen und in schema_migrations vermerkt werden.
 *
 * Der Grund für diesen Zuschnitt: Die 700 Zeilen nachträglich in dreissig
 * Migrationen zu zerlegen hiesse, für jede bestehende Installation zu raten,
 * welche davon dort schon gelaufen sind. Das ist genau die Sorte Umbau, die
 * eine funktionierende Datenbank kaputtmacht. Ab hier vorwärts sauber zu sein
 * kostet nichts und löst das Problem für alles Künftige.
 *
 * ── Eine Migration schreiben ────────────────────────────────────────────────
 * Datei anlegen: db/migrations/0002-beschreibender-name.sql
 *
 *   -- Kommentar: warum diese Änderung nötig ist
 *   ALTER TABLE sets ADD COLUMN notes TEXT;
 *
 * Regeln:
 *   • Die Nummer bestimmt die Reihenfolge. Nie eine vergebene Nummer erneut
 *     benutzen und nie eine bereits ausgelieferte Datei nachträglich ändern —
 *     sie ist auf fremden Installationen schon gelaufen.
 *   • Jede Datei läuft in EINER Transaktion. Schlägt eine Anweisung fehl,
 *     wird die ganze Datei zurückgerollt und der Start bricht ab. Das ist
 *     Absicht: Ein halb migriertes Schema ist schlimmer als ein Server, der
 *     nicht hochkommt.
 *   • `IF NOT EXISTS` ist hier NICHT nötig — jede Datei läuft genau einmal.
 *     Wer es trotzdem schreibt, verschleiert nur, dass etwas doppelt lief.
 */
import fs from 'fs';
import path from 'path';

/**
 * Alle noch nicht angewandten Migrationen ausführen.
 *
 * Läuft innerhalb des Advisory-Locks von initSchemaOnce() — im Cluster ist
 * also immer nur ein Worker hier drin.
 *
 * @param {any} client Eine DEDIZIERTE pg-Verbindung (nicht der Pool), damit
 *                     Lock und Migration auf derselben Session liegen.
 * @returns {Promise<string[]>} Namen der neu angewandten Migrationen
 */
async function runMigrations(client): Promise<string[]> {
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
  const done = new Set(rows.map(r => r.name));

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

/**
 * Welche Migrationen sind angewandt? Für Diagnose und die Admin-Oberfläche.
 * @param {any} db Modul db/database
 * @returns {Promise<{name: string, applied_at: string}[]>}
 */
async function listMigrations(db): Promise<any[]> {
  return db.all('SELECT name, applied_at FROM schema_migrations ORDER BY name')
    .catch(() => []);
}

export { runMigrations, listMigrations };
