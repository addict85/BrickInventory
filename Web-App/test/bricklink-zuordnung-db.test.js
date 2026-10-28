/**
 * Seit db/basis.sql gibt es den Stand VOR dieser Migration nicht mehr: Die
 * Fälle zu Riegel, Nachtrag und Zwischenstand sind entfallen. Geprüft werden
 * der Endstand und die Lesewege.
 *
 * Die BrickLink-Nummern stehen in EINER Zuordnungstabelle.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „ich würde mir für die bl_*_number Spalten eine Mapping-Tabelle vorstellen
 *    mit der Spalte RB_id und BL_id dort werden alle alle Minifiguren, Parts
 *    und Sets mit den Mappings abgelegt."
 *
 * Und auf die Rückfrage: „ja, eigene Tabelle mit Art-Unterscheidung ist
 * richtig."
 *
 * ── Was vorher wo stand (GEMESSEN) ──────────────────────────────────────────
 *
 *   rb_bl_mapping(part_num, bl_part_num)   katalogweit   die Zuordnung selbst
 *   parts.bl_part_number                   JE KONTO      Abschrift
 *   set_parts_catalog.bl_part_number       je Set+Teil   Abschrift
 *   minifigs.bl_fig_number                 JE KONTO      Abschrift
 *
 * Dass die drei Abschriften genau das waren, stand im Baum selbst:
 * utils/partsImport.ts trug eine Funktion syncBlPartNumbers(), deren ganze
 * Aufgabe das Kopieren von rb_bl_mapping in die beiden anderen war.
 *
 * ── Was dieser Test prüft ───────────────────────────────────────────────────
 *
 *   1. Nach der GANZEN Kette gibt es die drei Abschriften und rb_bl_mapping
 *      nicht mehr — und vorher gibt es sie, weil Migration 0037 sie LIEST.
 *   2. Der Nachtrag trägt alle vier Quellen zusammen, mit EINER Schreibweise
 *      für „keine abweichende Nummer".
 *   3. Der Riegel greift, wenn eine Nummer verloren ginge. Mit GEGENPROBE:
 *      ohne Riegel läuft dieselbe Lage durch und die Nummern sind weg.
 *   4. Der Riegel greift beim WIDERSPRUCH — zwei Konten, derselben Figur
 *      verschiedene Nummern gegeben. Dann entscheidet ein Mensch.
 *   5. Die Lesewege liefern die Nummer weiter, aus der Zuordnung. Mit
 *      GEGENPROBE: Ändert sich die Zuordnung, folgt die Antwort.
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
const { haeltFigur, haeltTeil } = require('./helpers/bestand');

// Dieselbe Begruendung wie in test/setmenge-aus-erfassungen-db.test.js: Diese
// Datei baut die Datenbank mehrfach von null auf.
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  } catch (e) {
    console.error('[bricklink-zuordnung] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const spaltenVon = async (tabelle) => (await db.all(
  `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
  .map(r => r.column_name).sort();

const tabelleDa = async (name) => !!(await db.get(
  `SELECT to_regclass($1) AS t`, [name]))?.t;

const dbDa = async (t) => {
  try { await db.run('SELECT 1'); return true; }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return false;
  }
};

const MIG_DIR = path.join(ROOT, 'db', 'migrations');
const DATEI   = path.join(MIG_DIR, '0037-bricklink-nummern-in-einer-zuordnung.sql');

test('nach der ganzen Kette stehen die Nummern nur in bl_zuordnung',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // Den Vorstand vor den Migrationen gibt es nicht mehr: Eine leere
  // Datenbank bekommt db/basis.sql. Geprüft wird der Endstand.
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  // ── Danach: die Abschriften sind weg ─────────────────────────────────────
  assert.ok(!(await spaltenVon('parts')).includes('bl_part_number'),
    'parts.bl_part_number ist nach allen Migrationen noch da');
  assert.ok(!(await spaltenVon('set_parts_catalog')).includes('bl_part_number'),
    'set_parts_catalog.bl_part_number ist nach allen Migrationen noch da');
  assert.ok(!(await spaltenVon('minifigs')).includes('bl_fig_number'),
    'minifigs.bl_fig_number ist nach allen Migrationen noch da');
  assert.ok(!(await tabelleDa('rb_bl_mapping')),
    'rb_bl_mapping gibt es noch — ihr Inhalt steht als Art part in bl_zuordnung');

  // ── Und die Zuordnung steht ──────────────────────────────────────────────
  const z = await spaltenVon('bl_zuordnung');
  assert.deepEqual(z, ['art', 'bl_id', 'fetched_at', 'rb_id'],
    `bl_zuordnung hat nicht die vorgesehenen Spalten: ${z.join(', ')}`);

  // Die Art ist eingeschränkt — ein Tippfehler soll nicht als vierte Art
  // durchgehen und dort still unsichtbare Zeilen anlegen.
  await assert.rejects(
    () => db.run(`INSERT INTO bl_zuordnung (art, rb_id) VALUES ('teil','x')`),
    /bl_zuordnung_art|check constraint/,
    'Eine erfundene Art wird angenommen — dann liegen Zeilen da, die keine ' +
    'Leseabfrage je findet');
  for (const art of ['part', 'fig', 'set']) {
    await db.run(`INSERT INTO bl_zuordnung (art, rb_id) VALUES ($1,'x') ` +
                 `ON CONFLICT DO NOTHING`, [art]);
  }
  assert.equal((await db.get(
    `SELECT COUNT(*)::int AS c FROM bl_zuordnung WHERE rb_id='x'`)).c, 3,
    'Nicht alle drei Arten sind erlaubt — Marcos Vorgabe nennt Minifiguren, ' +
    'Parts UND Sets');
  await db.run(`DELETE FROM bl_zuordnung WHERE rb_id='x'`);

  // Der Index fuer die Eindeutigkeitspruefung des Riegels.
  const idx = (await db.all(
    `SELECT indexname FROM pg_indexes WHERE tablename='bl_zuordnung'`)).map(r => r.indexname);
  assert.ok(idx.includes('idx_bl_zuordnung_bl'),
    `idx_bl_zuordnung_bl fehlt — gefunden: ${idx.join(', ')}`);
});

test('die Lesewege liefern die BrickLink-Nummer aus der Zuordnung',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c0 = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c0); } finally { c0.release(); }

  const u = await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('blleser','x') RETURNING id`);
  const uid = u.id;

  // Ein manuelles Teil und eine manuelle Figur, beide mit ABWEICHENDER
  // BrickLink-Nummer in der Zuordnung.
  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3070b','Tile 1x1')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3070b',0,'Schwarz') ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES ('fig-9','Testfigur')
                ON CONFLICT (fig_number) DO NOTHING`);
  // Bestandszeile UND Erfassung in einem — die Stückzahl steht seit
  // Migration 0038 nur noch dort.
  await haeltTeil(db, uid, '3070b', { menge: 5, colorId: 0, preis: 1.00 });
  await haeltFigur(db, uid, 'fig-9', { menge: 2, preis: 5.00 });
  await db.run(`INSERT INTO bl_zuordnung (art,rb_id,bl_id) VALUES
                ('part','3070b','3070'), ('fig','fig-9','sw9999')`);

  const H = _req('utils/handlers/parts.js');
  const M = _req('utils/handlers/minifigs.js');

  const teile = await H.getManualParts([uid], uid);
  const teil = (Array.isArray(teile) ? teile : teile.parts || []).find(p => p.part_number === '3070b');
  assert.ok(teil, `Das Teil fehlt in der Antwort: ${JSON.stringify(teile).slice(0, 300)}`);
  assert.equal(teil.bl_part_number, '3070',
    `bl_part_number kam als ${teil.bl_part_number} statt 3070 — die Liste liest die ` +
    'Nummer nicht aus bl_zuordnung');

  const figs = await M.getManualMinifigs([uid], uid);
  const fig = (Array.isArray(figs) ? figs : figs.minifigs || []).find(f => f.fig_number === 'fig-9');
  assert.ok(fig, `Die Figur fehlt in der Antwort: ${JSON.stringify(figs).slice(0, 300)}`);
  assert.equal(fig.bl_fig_number, 'sw9999',
    `bl_fig_number kam als ${fig.bl_fig_number} statt sw9999`);

  // ── GEGENPROBE: die Zuordnung ändern ─────────────────────────────────────
  //
  // Der Kern dieses Tests. Ohne ihn könnten die Werte oben zufällig stimmen —
  // etwa aus einer anderen Quelle, die gerade dasselbe sagt. Erst wenn die
  // Antwort einer Änderung FOLGT, ist bewiesen, woher sie kommt.
  await db.run(`UPDATE bl_zuordnung SET bl_id='3070neu' WHERE art='part' AND rb_id='3070b'`);
  await db.run(`UPDATE bl_zuordnung SET bl_id='sw0000'  WHERE art='fig'  AND rb_id='fig-9'`);

  const teile2 = await H.getManualParts([uid], uid);
  const teil2 = (Array.isArray(teile2) ? teile2 : teile2.parts || []).find(p => p.part_number === '3070b');
  assert.equal(teil2.bl_part_number, '3070neu',
    `Die Teileliste folgt der Zuordnung nicht: ${teil2.bl_part_number} statt 3070neu`);

  const figs2 = await M.getManualMinifigs([uid], uid);
  const fig2 = (Array.isArray(figs2) ? figs2 : figs2.minifigs || []).find(f => f.fig_number === 'fig-9');
  assert.equal(fig2.bl_fig_number, 'sw0000',
    `Die Figurenliste folgt der Zuordnung nicht: ${fig2.bl_fig_number} statt sw0000`);

  // ── Und OHNE Zuordnung gilt die Rebrickable-Nummer ───────────────────────
  //
  // Die Zuordnung hält nur die ABWEICHUNG fest. Kein Eintrag heisst „heisst
  // dort genauso" — und nicht „leer": Als Gruppierungsschlüssel fiele ein
  // NULL-Wert in seine eigene Gruppe, und jedes Teil ohne Zuordnung stünde
  // einzeln in der Liste.
  await db.run(`DELETE FROM bl_zuordnung WHERE art='part' AND rb_id='3070b'`);
  const teile3 = await H.getManualParts([uid], uid);
  const teil3 = (Array.isArray(teile3) ? teile3 : teile3.parts || []).find(p => p.part_number === '3070b');
  assert.equal(teil3.bl_part_number, '3070b',
    `Ohne Zuordnung muss die Rebrickable-Nummer herauskommen, nicht ${teil3.bl_part_number}`);
});

test('niemand schreibt eine BrickLink-Nummer mehr an eine Bestandszeile', () => {
  // Nur der QUELLTEXT, und nur die SCHREIBseite. Die Leseseite prüft die
  // Datenbank: Nach Migration 0037 gibt es die Spalten nicht, jede verbliebene
  // Lesestelle ist ein harter Fehler — und genau deshalb laufen die Lesewege
  // oben gegen eine migrierte Datenbank.
  const dateien = [];
  const lauf = (verz) => {
    for (const e of fs.readdirSync(verz, { withFileTypes: true })) {
      const p = path.join(verz, e.name);
      if (e.isDirectory()) { lauf(p); continue; }
      if (/\.(ts|js)$/.test(e.name)) dateien.push(p);
    }
  };
  for (const teil of ['routes', 'utils', 'jobs', 'db', 'clients', 'scripts']) {
    const v = path.join(ROOT, teil);
    if (fs.existsSync(v)) lauf(v);
  }
  dateien.push(path.join(ROOT, 'server.ts'));
  assert.ok(dateien.length > 100, `Nur ${dateien.length} Quelldateien gefunden`);

  const codeZeilen = (txt) => txt.split('\n')
    .filter(z => { const t = z.trim(); return !(t.startsWith('//') || t.startsWith('*')
                                             || t.startsWith('/*') || t.startsWith('--')); });

  // Die drei Abschriften, und die alte Tabelle. parts_summary.bl_part_number
  // ist ausgenommen: Diese Tabelle ist ein Zwischenspeicher, sie hält den
  // Gruppenschlüssel als fertige Spalte (utils/partsSummary.ts).
  const muster = [
    ['setzt parts.bl_part_number',    /UPDATE\s+parts\s+SET\s+[^;`']*\bbl_part_number\s*=/i],
    ['setzt minifigs.bl_fig_number',  /UPDATE\s+minifigs\s+SET\s+[^;`']*\bbl_fig_number\s*=/i],
    ['setzt den Set-Teile-Katalog',   /UPDATE\s+set_parts_catalog\s+SET\s+[^;`']*\bbl_part_number\s*=/i],
    ['legt die Spalte wieder an',     /ALTER\s+TABLE\s+(?:parts|minifigs|set_parts_catalog)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?bl_(?:part|fig)_number/i],
    ['benutzt rb_bl_mapping',         /\brb_bl_mapping\b/i],
  ];

  const stellen = [];
  for (const datei of dateien) {
    const rel = path.relative(ROOT, datei);
    // db/schema.sql ist keine .ts/.js-Datei und damit gar nicht dabei — dort
    // MUESSEN die Spalten und die alte Tabelle weiter stehen, weil Migration
    // 0037 sie liest.
    for (const z of codeZeilen(fs.readFileSync(datei, 'utf8'))) {
      for (const [was, m] of muster) if (m.test(z)) stellen.push(`${rel} (${was}): ${z.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(stellen, [],
    'Diese Stellen schreiben eine BrickLink-Nummer an eine Bestandszeile oder ' +
    'benutzen die alte Tabelle:\n  ' + stellen.join('\n  ') +
    '\nSie steht seit Migration 0037 in bl_zuordnung, einmal je Gegenstand.');

  // ── Selbstbeweis ─────────────────────────────────────────────────────────
  //
  // Die Muster finden jetzt nichts — das ist der Punkt, sagt aber allein noch
  // nicht, dass sie etwas finden KOENNTEN. Also an erfundenen Zeilen
  // nachgewiesen, in genau der Form, die vorher im Baum stand (die ersten drei
  // stehen so in utils/partsImport.ts und routes/minifigs.ts, Fassung vor 0037).
  const proben = [
    'UPDATE parts SET bl_part_number = m.bl_part_num FROM x',
    "UPDATE minifigs SET bl_fig_number=$1 WHERE id=$2",
    'UPDATE set_parts_catalog SET bl_part_number = m.bl_part_num FROM x',
    'ALTER TABLE parts ADD COLUMN IF NOT EXISTS bl_part_number TEXT',
    'SELECT bl_part_num FROM rb_bl_mapping WHERE part_num=$1',
  ];
  for (const zeile of proben) {
    assert.ok(muster.some(([, m]) => m.test(zeile)),
      `Kein Muster greift auf seine eigene Probe: ${zeile.slice(0, 60)}`);
  }
  // Und die Gegenrichtung: Was erlaubt ist, darf NICHT greifen.
  for (const zeile of [
    "INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES ($1,$2,NULLIF($3,$2))",
    'INSERT INTO parts_summary (user_id, part_key, bl_part_number) SELECT 1,2,3',
    "UPDATE rb_colors SET bl_color_id = $1 WHERE id = $2",
  ]) {
    for (const [was, m] of muster) {
      assert.ok(!m.test(zeile), `Das Muster „${was}" meldet eine erlaubte Zeile: ${zeile.slice(0, 70)}`);
    }
  }
});
