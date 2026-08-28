/**
 * Zwei gleichzeitige Katalog-Importe derselben Tabelle — gegen echte Datenbank.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 * Der Name der Schattentabelle (`<tabelle>_import`) leitet sich allein vom
 * Tabellennamen ab, ist also für ALLE Läufe derselbe. Zwei gleichzeitige
 * Importe derselben Tabelle sind erreichbar: Der Tageslauf ruft csvSync.run(),
 * und ein Admin kann parallel /admin/trigger-csv-sync auslösen — der Riegel
 * `_csvSyncRunning` in server.ts schützt nur den manuellen Weg gegen sich
 * selbst und liegt ohnehin im Speicher EINES Prozesses.
 *
 * Vor Nachtrag 29 scheiterte dann einer der beiden Läufe beim CREATE mit
 * „duplicate key value violates unique constraint pg_type_typname_nsp_index" —
 * einem Fehler, der nichts über die Ursache verrät. In csvSync.run() bricht
 * das den ganzen Durchgang ab, der Tagesmarker bleibt ungesetzt.
 *
 * Seither serialisiert eine Postgres-Beratungssperre je Tabelle: Der zweite
 * Lauf WARTET und läuft danach sauber durch. Verschiedene Tabellen dürfen
 * weiterhin parallel importiert werden.
 *
 * Geprüft wird VERHALTEN (beide Läufe gelingen, Endbestand vollständig), nicht
 * der Wortlaut des Codes. Gegenprobe (durchgeführt): pg_advisory_lock in
 * jobs/csvImportWorker.ts entfernt → der Test wird rot, ein Lauf scheitert mit
 * genau der Meldung oben.
 *
 * Voraussetzung: Test-DB (Inhalt wird verändert!) via TEST_DATABASE_URL.
 * Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('zwei gleichzeitige Importe derselben Tabelle kollidieren nicht',
  { concurrency: 1 }, async (t) => {

  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const { TASKS } = _req('jobs/csvImportWorker.js');
  const DATA_DIR = _req('utils/appPaths.js').DATA_DIR;

  await db.run(`CREATE TABLE IF NOT EXISTS rb_colors (
    id INTEGER PRIMARY KEY, name TEXT, rgb TEXT, is_trans TEXT, bl_color_id INTEGER)`);
  await db.run(`DROP TABLE IF EXISTS rb_colors_import`);
  await db.run(`DELETE FROM rb_colors`);

  // Gross genug, dass sich die beiden Läufe zeitlich überlappen — bei einer
  // Handvoll Zeilen wäre der erste fertig, bevor der zweite beginnt, und der
  // Test würde auch ohne Sperre grün.
  const ZEILEN = 30000;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const csv = ['id,name,rgb,is_trans'];
  for (let i = 1; i <= ZEILEN; i++) csv.push(`${i},farbe-${i},AABBCC,f`);
  fs.writeFileSync(path.join(DATA_DIR, 'colors.csv.tmp'), csv.join('\n') + '\n', 'utf8');

  try {
    const ergebnisse = await Promise.allSettled([TASKS.colors(), TASKS.colors()]);

    const gescheitert = ergebnisse.filter(r => r.status === 'rejected');
    assert.equal(gescheitert.length, 0,
      `beide Läufe müssen durchlaufen — gescheitert: ${gescheitert.map(r => r.reason.message).join(' | ')}`);

    for (const r of ergebnisse) {
      assert.equal(r.value, ZEILEN, 'jeder Lauf muss alle Zeilen gelesen haben');
    }

    // Der Endbestand entspricht genau EINEM Lauf — keine Mischung, nichts fehlt.
    const n = (await db.get('SELECT count(*)::int AS n FROM rb_colors')).n;
    assert.equal(n, ZEILEN, `Endbestand unvollständig: ${n} statt ${ZEILEN} Zeilen`);
  } finally {
    await db.run(`DROP TABLE IF EXISTS rb_colors_import`).catch(() => {});
    await db.run(`DELETE FROM rb_colors`).catch(() => {});
    fs.rmSync(path.join(DATA_DIR, 'colors.csv.tmp'), { force: true });
    await db.pool.end().catch(() => {});
  }
});
