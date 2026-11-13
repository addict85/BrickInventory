/**
 * Seit db/basis.sql gibt es den Stand VOR dieser Migration nicht mehr: Die
 * Fälle zu Riegel, Nachtrag und Zwischenstand sind entfallen. Geprüft werden
 * der Endstand und die Lesewege.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testDaten();

// Nachlauf: aufgeraeumte Datenbank zuruecklassen
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  } catch (e) {
    // Nicht verschlucken: Bleibt die Datenbank kaputt, scheitern die
    // naechsten Dateien an etwas, das nichts mit ihnen zu tun hat.
    console.error('[sets-ohne-kaufpreisspalte] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

/** Spaltennamen einer Tabelle, aus dem Katalog. */
const spaltenVon = async tabelle =>
  (await db.all(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
    .map(r => r.column_name)
    .sort();

test('nach dem vollständigen Schemaaufbau hat sets keinen Kaufpreis und keinen Zustand', {
  concurrency: 1,
}, async t => {
  try {
    await db.run('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }

  // Von null: genau der Weg, den eine neue Installation nimmt.
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // Den Vorstand vor den Migrationen gibt es nicht mehr: Eine leere
  // Datenbank bekommt db/basis.sql. Geprüft wird der Endstand.
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  const nachher = await spaltenVon('sets');
  // `quantity` stand hier mit — bis Migration 0036 sie geloescht hat. Geprueft
  // wird jetzt `user_id` und `set_number`: Welches Konto haelt welches Set,
  // das ist, was von der Zeile bleibt. (Dass quantity WEG ist, prueft
  // test/setmenge-aus-erfassungen-db.test.js.)
  assert.ok(
    nachher.includes('user_id') && nachher.includes('set_number'),
    `Die Spaltenliste von sets sieht falsch aus: ${nachher.join(', ')}`,
  );
  for (const sp of ['purchase_price', 'condition']) {
    assert.ok(
      !nachher.includes(sp),
      `sets.${sp} ist nach allen Migrationen noch da — Migration 0032 hat nicht ` +
        'gelöscht, oder etwas legt die Spalte danach wieder an.',
    );
  }

  // Und sie sind nicht verschwunden, sondern umgezogen.
  const erfassung = await spaltenVon('set_acquisitions');
  for (const sp of ['purchase_price', 'condition', 'quantity', 'created_at']) {
    assert.ok(erfassung.includes(sp), `set_acquisitions.${sp} fehlt — dann gibt es den Kaufpreis nirgends mehr`);
  }
});
