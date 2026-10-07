/**
 * initSchema() läuft einmal pro DATENBANK, nicht einmal pro Worker — und auch
 * nicht einmal pro Deployment.
 *
 * ── Woher diese Datei kommt ─────────────────────────────────────────────────
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
 * ── Was sich geändert hat, und warum ────────────────────────────────────────
 *
 * Diese Datei verlangte zweierlei, das jetzt NICHT mehr gilt:
 *
 *   1. „Die Version muss aus package.json kommen — sie wird bei jeder
 *      Installation neu gesetzt", geprüft über das Vorkommen von
 *      `require('../package.json').version`.
 *   2. „Nach einem Versionswechsel muss die Migration erneut laufen."
 *
 * Beides ist weg, und beides aus einem Grund, der nachgemessen ist:
 *
 *   • Zu 1: Aus dist/db/database.js löst Node `require('../package.json')` nach
 *     dist/package.json auf — eine Datei, die es nicht gibt. Nachgemessen im
 *     gebauten Baum: MODULE_NOT_FOUND. Die Version war damit IMMER 'unknown',
 *     der Vergleich immer erfüllt, und die Zusicherung prüfte nur, dass eine
 *     Zeile im Quelltext steht — nicht, dass sie wirkt.
 *   • Zu 2: Wäre sie gelaufen, wäre es schädlich. initSchema() enthält ein
 *     Dutzend datenverändernder Anweisungen, darunter
 *     `UPDATE users SET is_active=1, email_verified=1 WHERE is_admin=1` ohne
 *     jeden Riegel: Bei jedem Deployment hätte das ein abgeschaltetes
 *     Administratorkonto wieder freigeschaltet. Und die Nachträge für
 *     Erst-Erfassungen hätten Zeilen wieder angelegt, die jemand bewusst
 *     gelöscht hat.
 *
 * Der Riegel hängt deshalb jetzt daran, ob diese Datenbank überhaupt schon
 * einen Schemastand vermerkt hat. Jede Änderung danach gehört in eine
 * Migration. Das Verhalten der Prüfung „zweiter Aufruf überspringt" bleibt
 * unverändert — es war immer schon das, was wirklich passierte.
 *
 * Die neue Richtung wird in test/schema-erststart-db.test.js an der WIRKUNG
 * gemessen (ein Index, den nur initSchema() anlegt, bleibt weg bzw. kommt
 * zurück), nicht am Quelltext.
 *
 * Ausführen: npm test (Postgres nötig)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ohneKommentare } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

test('der Vermerk ist da, serialisiert, und steuert nicht mehr', () => {
  // Kommentare ausblenden: Der Absatz, der den alten Pfad ERKLAERT, nennt ihn
  // zwangslaeufig — und waere sonst selbst der Verstoss.
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'db', 'database.ts'), 'utf8'));
  const fn = src.slice(src.indexOf('async function initSchemaOnce'));
  assert.match(fn, /CREATE TABLE IF NOT EXISTS schema_meta/,
    'Ohne Vermerk kann kein Worker wissen, dass die Arbeit schon getan ist');
  // Die Fassung wird weiter vermerkt, steuert aber nichts mehr — sie ist eine
  // Auskunft für die Fehlersuche („welcher Stand hat dieses Schema angelegt?").
  // Verlangt wird nur, dass sie AUFFINDBAR ist: über APP_ROOT und nicht über
  // einen Pfad relativ zur Moduldatei, der aus dist/ heraus ins Leere zeigt.
  assert.match(fn, /APP_ROOT/,
    'Die Fassung muss über APP_ROOT gefunden werden (utils/appPaths.ts). Ein Pfad ' +
    'relativ zur Moduldatei zeigt aus dist/db/ heraus auf dist/package.json — die ' +
    'es nicht gibt, weshalb der Vermerk jahrelang "unknown" lautete.');
  assert.doesNotMatch(fn, /require\('\.\.\/package\.json'\)/,
    'Der alte, aus dist/ nicht auflösbare Pfad ist zurück.');
  assert.match(fn, /FORCE_SCHEMA_INIT/,
    'Es braucht einen Weg, die Migration zu erzwingen');
  // Die Serialisierung darf nicht verlorengegangen sein
  assert.match(fn, /pg_advisory_lock/,
    'CREATE TABLE IF NOT EXISTS ist unter Nebenläufigkeit nicht sicher — der Lock muss bleiben');
});

test('zweiter Aufruf überspringt — und ein fremder Vermerk auch', async (t) => {
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

  // Ein fremder Vermerk aendert NICHTS. Fruehere Fassungen liessen initSchema()
  // hier erneut laufen; genau das darf es nicht, siehe Dateikopf.
  await db.run("UPDATE schema_meta SET applied_version = 'alt' WHERE id = 1");
  const t1 = Date.now();
  await db.initSchemaOnce();
  const auchUebersprungen = Date.now() - t1;
  const after = await db.get('SELECT applied_version FROM schema_meta WHERE id = 1');
  assert.equal(after.applied_version, 'alt',
    'Ein fremder Vermerk hat initSchema() erneut laufen lassen. Auf einer bestehenden ' +
    'Datenbank traegt das geloeschte Erst-Erfassungen wieder ein und schaltet ' +
    'abgeschaltete Administratorkonten frei — siehe Dateikopf.');
  assert.ok(auchUebersprungen < 500,
    `Der Lauf mit fremdem Vermerk dauerte ${auchUebersprungen} ms — das sieht nach ` +
    `einem vollstaendigen initSchema() aus.`);
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
