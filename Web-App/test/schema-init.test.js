/**
 * Schema-Migration läuft einmal pro Deployment, nicht einmal pro Worker.
 *
 * Aufgefallen im Startprotokoll: Bei vier Cluster-Workern erschien
 * „PostgreSQL schema ready" viermal. Der Advisory-Lock in initSchemaOnce()
 * hat korrekt SERIALISIERT — aber danach lief initSchema() in jedem Worker
 * vollständig durch: 84 CREATE-/ALTER-Anweisungen plus Migrationen und
 * Backfills, nacheinander. Korrekt (alles IF NOT EXISTS), aber dreimal umsonst.
 *
 * Gemessen an einer leeren Datenbank: 1490 ms für den ersten Worker, danach
 * 1–2 ms statt jeweils erneut 1490 ms.
 *
 * Ausführen: npm test (Postgres nötig)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

test('der Vermerk hängt an der Deployment-Version', () => {
  const src = fs.readFileSync(path.join(ROOT, 'db', 'database.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async function initSchemaOnce'));
  assert.match(fn, /CREATE TABLE IF NOT EXISTS schema_meta/,
    'Ohne Vermerk kann kein Worker wissen, dass die Arbeit schon getan ist');
  assert.match(fn, /require\('\.\.\/package\.json'\)\.version/,
    'Die Version muss aus package.json kommen — sie wird bei jeder Installation neu gesetzt');
  assert.match(fn, /FORCE_SCHEMA_INIT/,
    'Es braucht einen Weg, die Migration zu erzwingen');
  // Die Serialisierung darf nicht verlorengegangen sein
  assert.match(fn, /pg_advisory_lock/,
    'CREATE TABLE IF NOT EXISTS ist unter Nebenläufigkeit nicht sicher — der Lock muss bleiben');
});

test('zweiter Aufruf überspringt, Versionswechsel läuft erneut', async (t) => {
  // Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
  process.env.DATABASE_URL = DB_URL;
  process.env.SESSION_SECRET = 'test';
  const db = _req('db/database.js');
  try {
    await db.get('SELECT 1');
  } catch {
    // REQUIRE_DB=1 (CI): Ein Überspringen ist hier KEIN akzeptabler Ausgang.
    // Vorher war die Suite in jeder Umgebung ohne Datenbank grün — also
    // ausgerechnet dort, wo niemand hinschaut. Wer die Datenbank erwartet,
    // bekommt jetzt einen Fehlschlag statt eines stillen Skips.
    if (process.env.REQUIRE_DB === '1') {
      throw new Error(`REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar: DATABASE_URL`);
    }
    // REQUIRE_DB=1 (in CI gesetzt) verbietet das Überspringen.
    //
    // Ohne diese Sperre war die Suite in jeder Umgebung ohne Postgres GRÜN —
    // inklusive CI, falls der Service-Container mal nicht hochkommt. Genau
    // die Tests, die am meisten absichern, hätten dann stillschweigend nichts
    // geprüft. Lieber ein lauter Fehlschlag.
    if (process.env.REQUIRE_DB === '1') {
      throw new Error(`REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.`);
    }
    t.skip('Test-DB nicht erreichbar');
    return;
  }

  await db.initSchemaOnce();
  const first = await db.get('SELECT applied_version FROM schema_meta WHERE id = 1');
  assert.ok(first?.applied_version, 'Nach dem ersten Lauf muss ein Vermerk stehen');

  // Zweiter Lauf: unverändert, muss deutlich schneller sein
  const t0 = Date.now();
  await db.initSchemaOnce();
  const skipped = Date.now() - t0;
  assert.ok(skipped < 500, `Zweiter Lauf dauerte ${skipped} ms — die Migration wurde nicht übersprungen`);

  // Versionswechsel simulieren: Vermerk verfälschen → muss wieder laufen
  await db.run("UPDATE schema_meta SET applied_version = 'alt' WHERE id = 1");
  await db.initSchemaOnce();
  const after = await db.get('SELECT applied_version FROM schema_meta WHERE id = 1');
  assert.notEqual(after.applied_version, 'alt',
    'Nach einem Versionswechsel muss die Migration erneut laufen und den Vermerk erneuern');
});

// Verbindungspool schliessen — sonst bleibt der Testprozess nach dem letzten
// Test hängen und der Läufer meldet die Datei als fehlgeschlagen, obwohl jede
// Prüfung grün war. Ohne erreichbare Datenbank fiel das nie auf: Dann wurde
// gar keine Verbindung geöffnet.
test('Verbindungen schliessen', async () => {
  // `_req` steht in dieser Datei INNERHALB eines Tests (der Bau nach dist/
  // läuft dort) und ist hier draussen nicht sichtbar — deshalb der eigene
  // Aufruf. Er baut nicht neu, die Hilfsfunktion merkt sich den Lauf.
  const req = require('./helpers/sources').buildAndRequire();
  await req('db/database.js').pool.end().catch(() => {});
});
