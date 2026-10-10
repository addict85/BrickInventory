/**
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

  // ── Zwischenstand, und er ist der Kern der Sache ─────────────────────────
  //
  // VOR den Migrationen sind die beiden Spalten da. Diese Zusicherung ist
  // nicht Zierrat: Wäre sie rot, liefe Migration 0007 ins Leere und der erste
  // Start einer frischen Installation wäre kaputt — genau der Fehler, der beim
  // Schreiben von 0032 gemessen wurde („column \"purchase_price\" does not
  // exist"). Und sie ist der Selbstnachweis für die Prüfung weiter unten:
  // Ohne sie könnte dort auch eine leere Tabelle grün aussehen.
  const vorher = await spaltenVon('sets');
  for (const sp of ['purchase_price', 'condition']) {
    assert.ok(vorher.includes(sp),
      `sets.${sp} fehlt schon vor den Migrationen. Migration 0007 schreibt ` +
      `ALTER COLUMN ${sp} … und bricht damit ab; db/schema.sql bzw. ` +
      'spaltenMigrationen() müssen die Spalte anlegen.');
  }

  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  const nachher = await spaltenVon('sets');
  assert.ok(nachher.includes('quantity') && nachher.includes('set_number'),
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

test('Migration 0032 löscht nur, wenn jede Set-Zeile eine Erfassung hat',
  { concurrency: 1 }, async (t) => {

  try { await db.run('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  // ── Warum dieser Test der wichtigere ist ─────────────────────────────────
  //
  // Schritt 1 der Migration trägt für jede Set-Zeile ohne Erfassung eine nach,
  // Schritt 2 zählt nach und bricht ab, wenn eine übrig bleibt, Schritt 3
  // löscht die Spalten. Ohne Schritt 2 wäre das Löschen ein Datenverlust mit
  // Ansage: Eine Set-Zeile ohne Erfassung hätte danach weder Kaufpreis noch
  // Zustand, und beides liesse sich aus nichts mehr herleiten.
  //
  // Geprüft werden deshalb DREI Läufe auf derselben Lage (ein Set mit
  // Kaufpreis 444.40, Zustand U, ohne Erfassung):
  //
  //   1. ganze Datei          → trägt nach, löscht, Kaufpreis ist in der Erfassung
  //   2. ohne Schritt 1       → Schritt 2 bricht ab, die Spalten bleiben
  //   3. ohne Schritt 1 und 2 → läuft durch, die Spalten sind weg, 444.40 ist weg
  //
  // Lauf 2 ist die Zusage, Lauf 3 die GEGENPROBE dazu: Er zeigt, dass Schritt 2
  // tatsächlich das ist, was den Verlust verhindert — und nicht etwa Postgres,
  // ein Fremdschlüssel oder ein Zufall der Reihenfolge.
  //
  // Schritt 1 weglassen ist dabei keine künstliche Lage: Es stellt genau das
  // her, was passiert, wenn der Nachtrag eine Zeile nicht erreicht — und ob er
  // das je tut, ist exakt die Frage, auf die Schritt 2 die Antwort nicht
  // schuldig bleiben darf.

  const datei = path.join(ROOT, 'db', 'migrations',
    '0032-kaufpreis-und-zustand-nur-in-erfassungen.sql');
  const skript = fs.readFileSync(datei, 'utf8');

  // Die zwei Abschnitte wörtlich aus der Datei schneiden — nicht nachgebaut.
  // Verschwinden oder verschieben sie sich, meldet das eine der Zusicherungen.
  const nachtrag = skript.slice(skript.indexOf('DO $nachtrag$'),
                                skript.indexOf('END $nachtrag$;') + 15);
  const riegel   = skript.slice(skript.indexOf('DO $$'), skript.indexOf('END $$;') + 7);
  assert.match(nachtrag, /INSERT INTO set_acquisitions/,
    'Schritt 1 (der Nachtrag) steht nicht mehr als DO $nachtrag$-Block in der Migration');
  assert.match(riegel, /RAISE EXCEPTION '% Set-Zeilen haben keine Erfassung/,
    'Schritt 2 (der Riegel) steht nicht mehr in der Migration');
  assert.ok(skript.indexOf('DO $nachtrag$') < skript.indexOf('DO $$'),
    'Der Riegel muss NACH dem Nachtrag stehen, sonst prüft er die alte Lage');

  const migDir = path.join(ROOT, 'db', 'migrations');

  /**
   * Frische Datenbank, alle Migrationen VOR 0032, eine Set-Zeile ohne
   * Erfassung — und dann das übergebene Skript.
   * @returns {Promise<string|null>} Fehlermeldung von Postgres, sonst null
   */
  const lauf = async (sql) => {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      // Wie db/migrate.ts: anwenden UND vermerken. Ohne den Vermerk hielte
      // ein spaeterer runMigrations()-Aufruf dieselben Dateien fuer offen.
      await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      for (const f of fs.readdirSync(migDir).filter(x => x.endsWith('.sql')).sort()) {
        if (f.startsWith('0032')) break;
        await c.query(fs.readFileSync(path.join(migDir, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      }
      await c.query(`INSERT INTO users (username,password_hash) VALUES ('ohneerf','x')`);
      await c.query(`INSERT INTO sets (user_id,set_number,name,quantity,purchase_price,condition)
                     SELECT id,'10179-1','Falcon',1,444.40,'U' FROM users WHERE username='ohneerf'`);
      // Wie die echte Migration: eine Transaktion je Datei (db/migrate.ts).
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('COMMIT');
        return null;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        return e.message;
      }
    } finally { c.release(); }
  };

  // ── Lauf 1: die ganze Datei ──────────────────────────────────────────────
  assert.equal(await lauf(skript), null,
    'Die Migration muss auf dieser Lage durchlaufen — Schritt 1 trägt die ' +
    'fehlende Erfassung ja gerade nach');
  assert.deepEqual(
    (await spaltenVon('sets')).filter(c => ['purchase_price', 'condition'].includes(c)), [],
    'Die Spalten sind nach dem vollständigen Lauf noch da');
  const erf = await db.get(
    `SELECT purchase_price, condition, quantity FROM set_acquisitions WHERE set_number='10179-1'`);
  assert.ok(erf, 'Schritt 1 hat für die Set-Zeile keine Erfassung nachgetragen');
  assert.equal(Number(erf.purchase_price), 444.40,
    'Der Kaufpreis der sets-Zeile ist beim Nachtragen verloren gegangen');
  assert.equal(erf.condition, 'U', 'Der Zustand der sets-Zeile ist verloren gegangen');
  assert.equal(Number(erf.quantity), 1, 'Die Menge ist beim Nachtragen verloren gegangen');

  // ── Lauf 2: ohne Schritt 1 — der Riegel muss greifen ─────────────────────
  const ohneNachtrag = skript.replace(nachtrag, '');
  assert.notEqual(ohneNachtrag, skript, 'Schritt 1 wurde nicht herausgeschnitten');
  const meldung = await lauf(ohneNachtrag);
  assert.match(String(meldung), /1 Set-Zeilen haben keine Erfassung/,
    `Der Riegel hat nicht gegriffen. Postgres sagte: ${meldung}`);
  // Und nichts ist gelöscht: Die Datei lief in EINER Transaktion.
  const nachAbbruch = await spaltenVon('sets');
  for (const sp of ['purchase_price', 'condition']) {
    assert.ok(nachAbbruch.includes(sp),
      `sets.${sp} ist trotz Abbruch weg — dann rollt die Transaktion nicht zurück`);
  }
  const preisDa = await db.get(
    `SELECT purchase_price FROM sets WHERE set_number='10179-1'`);
  assert.equal(Number(preisDa.purchase_price), 444.40,
    'Der Kaufpreis ist trotz Abbruch verschwunden');

  // ── Lauf 3: GEGENPROBE, ohne Schritt 1 UND ohne Schritt 2 ────────────────
  const ohneBeides = ohneNachtrag.replace(riegel, '');
  assert.notEqual(ohneBeides, ohneNachtrag, 'Schritt 2 wurde nicht herausgeschnitten');
  assert.equal(await lauf(ohneBeides), null,
    'Ohne den Riegel muss die Datei durchlaufen — sonst beweist Lauf 2 nichts');
  assert.deepEqual(
    (await spaltenVon('sets')).filter(c => ['purchase_price', 'condition'].includes(c)), [],
    'Ohne den Riegel müssten die Spalten weg sein');
  assert.equal(
    await db.get(`SELECT COUNT(*)::int AS n FROM set_acquisitions WHERE set_number='10179-1'`)
      .then(r => r.n),
    0,
    'Ohne Schritt 1 darf es keine Erfassung geben — sonst ist die Lage nicht die gedachte');
  // Damit ist gemessen, was Schritt 2 verhindert: 444.40 existiert nirgends mehr.
});
