/**
 * Seit db/basis.sql gibt es den Stand VOR dieser Migration nicht mehr: Die
 * Fälle zu Riegel, Nachtrag und Zwischenstand sind entfallen. Geprüft werden
 * der Endstand und die Lesewege.
 *
 * Kaufpreis und Zustand eines Sets stehen an GENAU EINEM Ort.
 *
 * ── Marcos Frage ────────────────────────────────────────────────────────────
 *
 *   „Wieso gibt es denn in der Tabelle Sets noch ein purchase_price und ein
 *    condition? Kaufpreise und Zustand können doch mehrere pro Set erfasst
 *    werden, müsste das nicht in einer eigenen Tabelle sein?"
 *
 * Sie war in einer eigenen Tabelle (`set_acquisitions`) — und gleichzeitig
 * weiterhin auf der sets-Zeile, als „Spiegel der neuesten Erfassung". Aus
 * diesem Nebeneinander sind drei gemeldete Fehler entstanden (Nachträge 51, 75
 * und der Android-Weg mit `resolvePrice: null`). Migration 0032 macht den
 * Schnitt.
 *
 * ── Was dieser Test prüft, und warum gegen eine FRISCHE Datenbank ───────────
 *
 * Die zwei Spalten stehen weiterhin in db/schema.sql und in
 * spaltenMigrationen() — sie MÜSSEN dort stehen, weil Migration 0007 ein
 * `ALTER COLUMN purchase_price TYPE NUMERIC` enthält und das auf einer
 * fehlenden Spalte hart abbricht. Erst Migration 0032 am Ende der Kette
 * löscht sie.
 *
 * Damit ist „die Spalte ist weg" eine Aussage über das ERGEBNIS der ganzen
 * Kette und nicht über eine einzelne Datei. Nur so geprüft hat die Prüfung
 * überhaupt eine Bedeutung: Auf der gemeinsamen Test-Datenbank ruft jede
 * Testdatei initSchema() auf, und das legt die Spalten jedes Mal wieder an
 * (0032 gilt dort längst als angewandt und läuft nicht erneut). Dieser Test
 * baut die Datenbank deshalb von null auf.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

// ── Nachlauf: aufgeraeumte Datenbank zuruecklassen ──────────────────────────
//
// Diese Datei baut die Datenbank mehrfach von null auf — die uebrigen
// Testdateien laufen danach weiter (node --test --test-concurrency=1, also
// hintereinander in Dateinamen-Reihenfolge) und finden sonst einen Zustand,
// den sie nicht erwarten.
//
// GEMESSEN, als dieser Nachlauf fehlte: Der naechste Testlauf brach mit
// „Migration 0023-merkliste.sql fehlgeschlagen: relation \"wanted\" already
// exists" ab. Grund: Der letzte Probelauf unten wendet die Migrationen von
// Hand an, ohne sie in schema_migrations zu vermerken — runMigrations() der
// naechsten Datei hielt sie deshalb fuer offen und legte alles ein zweites Mal
// an.
//
// Deshalb zwei Dinge: `lauf()` vermerkt jede angewandte Datei (wie
// db/migrate.ts), und hier wird am Ende EINMAL vollstaendig neu aufgebaut.
// Das Schliessen des Pools steht EINMAL je Datei und nicht je Test: Ein
// `t.after` im ersten Test schloss den Pool, bevor der zweite ihn brauchte.
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  } catch (e) {
    // Nicht verschlucken: Bleibt die Datenbank kaputt, scheitern die
    // naechsten Dateien an etwas, das nichts mit ihnen zu tun hat.
    console.error('[sets-ohne-kaufpreisspalte] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

/** Spaltennamen einer Tabelle, aus dem Katalog. */
const spaltenVon = async (tabelle) => (await db.all(
  `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
  .map(r => r.column_name).sort();

test('nach dem vollständigen Schemaaufbau hat sets keinen Kaufpreis und keinen Zustand',
  { concurrency: 1 }, async (t) => {

  try { await db.run('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  // Von null: genau der Weg, den eine neue Installation nimmt.
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // Den Vorstand vor den Migrationen gibt es nicht mehr: Eine leere
  // Datenbank bekommt db/basis.sql. Geprüft wird der Endstand.
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  const nachher = await spaltenVon('sets');
  // `quantity` stand hier mit — bis Migration 0036 sie geloescht hat. Geprueft
  // wird jetzt `user_id` und `set_number`: Welches Konto haelt welches Set,
  // das ist, was von der Zeile bleibt. (Dass quantity WEG ist, prueft
  // test/setmenge-aus-erfassungen-db.test.js.)
  assert.ok(nachher.includes('user_id') && nachher.includes('set_number'),
    `Die Spaltenliste von sets sieht falsch aus: ${nachher.join(', ')}`);
  for (const sp of ['purchase_price', 'condition']) {
    assert.ok(!nachher.includes(sp),
      `sets.${sp} ist nach allen Migrationen noch da — Migration 0032 hat nicht ` +
      'gelöscht, oder etwas legt die Spalte danach wieder an.');
  }

  // Und sie sind nicht verschwunden, sondern umgezogen.
  const erfassung = await spaltenVon('set_acquisitions');
  for (const sp of ['purchase_price', 'condition', 'quantity', 'created_at']) {
    assert.ok(erfassung.includes(sp),
      `set_acquisitions.${sp} fehlt — dann gibt es den Kaufpreis nirgends mehr`);
  }
});

