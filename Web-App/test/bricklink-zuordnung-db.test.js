/**
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

  // ── Zwischenstand: der Selbstnachweis ────────────────────────────────────
  //
  // VOR den Migrationen müssen die drei Spalten und rb_bl_mapping da sein, und
  // das ist keine Formalie: Der Nachtrag in 0037 LIEST alle vier, und sein
  // Riegel prüft danach, dass keine Nummer verloren geht. Fehlte eine in
  // db/schema.sql, bräche die Kette beim ersten Start einer frischen
  // Installation ab — und Migration 0015 setzt zusätzlich einen Index auf
  // parts.bl_part_number.
  //
  // Ohne diese Zusicherung sähe die Prüfung unten auch dann grün aus, wenn es
  // die Spalten nie gegeben hätte — und bewiese nichts.
  assert.ok((await spaltenVon('parts')).includes('bl_part_number'),
    'parts.bl_part_number fehlt schon vor den Migrationen — dann hat der Nachtrag ' +
    'in 0037 nichts zu lesen, und Migration 0015 bricht an ihrem Index ab.');
  assert.ok((await spaltenVon('set_parts_catalog')).includes('bl_part_number'),
    'set_parts_catalog.bl_part_number fehlt schon vor den Migrationen');
  assert.ok((await spaltenVon('minifigs')).includes('bl_fig_number'),
    'minifigs.bl_fig_number fehlt schon vor den Migrationen');
  assert.ok(await tabelleDa('rb_bl_mapping'),
    'rb_bl_mapping fehlt schon vor den Migrationen — sie ist die erste und ' +
    'verlässlichste Quelle des Nachtrags');

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

test('Migration 0037 trägt alle vier Quellen zusammen und löscht nur dann',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  const skript = fs.readFileSync(DATEI, 'utf8');
  const nachtrag = skript.slice(skript.indexOf('DO $nachtrag$'),
                               skript.indexOf('END $nachtrag$;') + 15);
  const riegel   = skript.slice(skript.indexOf('DO $pruefung$'),
                               skript.indexOf('END $pruefung$;') + 15);
  // Vier Quellen im Nachtrag, nicht drei: Die Zuordnung selbst zuerst.
  for (const quelle of ['FROM rb_bl_mapping', 'FROM set_parts_catalog',
                        'FROM parts', 'FROM minifigs']) {
    assert.ok(nachtrag.includes(quelle),
      `Der Nachtrag liest ${quelle} nicht mehr — diese Nummern gingen verloren`);
  }
  assert.match(riegel, /RAISE EXCEPTION '% Teile wuerden ihre BrickLink-Nummer verlieren/,
    'Der Riegel prüft nicht mehr auf verlorene Teilenummern');
  assert.match(riegel, /RAISE EXCEPTION '% Figuren wuerden ihre BrickLink-Nummer verlieren/,
    'Der Riegel prüft nicht mehr auf verlorene Figurennummern');
  assert.match(riegel, /widersprechen sich die Quellen/,
    'Der Riegel prüft nicht mehr auf Widersprüche');
  assert.match(riegel, /Zeilen aus rb_bl_mapping sind nicht uebernommen/,
    'Der Riegel prüft nicht mehr, dass die alte Tabelle vollständig übernommen ist');
  assert.ok(skript.indexOf('DO $nachtrag$') < skript.indexOf('DO $pruefung$'),
    'Der Riegel muss NACH dem Nachtrag stehen, sonst prüft er die alte Lage');

  /**
   * Frische Datenbank, alle Migrationen VOR 0037, Daten in allen vier Quellen,
   * dann das übergebene Skript.
   *
   * @param sql     das auszuführende Skript
   * @param streit  true: ein zweites Konto gibt derselben Figur eine ANDERE
   *                BrickLink-Nummer
   * @returns {Promise<string|null>} Fehlermeldung von Postgres, sonst null
   */
  const lauf = async (sql, streit = false) => {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      for (const f of fs.readdirSync(MIG_DIR).filter(x => x.endsWith('.sql')).sort()) {
        if (f.startsWith('0037')) break;
        await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      }
      await c.query(`INSERT INTO users (username,password_hash) VALUES ('blp','x'),('blp2','x')`);
      // Quelle 1: die Zuordnung selbst — eine echte Nummer und eine Notiz
      // „keine abweichende" in ihrer alten Schreibweise (bl == rb).
      await c.query(`INSERT INTO rb_bl_mapping (part_num, bl_part_num)
                     VALUES ('3001','3001a'), ('3002','3002')`);
      // Quelle 2: der Set-Teile-Katalog
      await c.query(`INSERT INTO set_catalog (set_number, name) VALUES ('75192-1','Falcon')`);
      await c.query(`INSERT INTO set_parts_catalog (set_number,part_number,color_id,bl_part_number,quantity)
                     VALUES ('75192-1','3003',4,'3003b',5), ('75192-1','3004',1,'3004',2)`);
      // Quelle 3: eine Bestandszeile mit eigener Nummer
      await c.query(`INSERT INTO sets (user_id,set_number)
                     SELECT id,'75192-1' FROM users WHERE username='blp'`);
      await c.query(`INSERT INTO set_acquisitions (user_id,set_number,quantity)
                     SELECT id,'75192-1',1 FROM users WHERE username='blp'`);
      await c.query(`INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source,bl_part_number)
                     SELECT id,'75192-1','3005',7,3,'set','3005c' FROM users WHERE username='blp'`);
      // Quelle 4: zwei Figuren, eine mit abweichender Nummer
      await c.query(`INSERT INTO minifigs (user_id,fig_number,quantity,source,bl_fig_number)
                     SELECT id,'fig-001',1,'manual','sw0001' FROM users WHERE username='blp'`);
      await c.query(`INSERT INTO minifigs (user_id,fig_number,quantity,source,bl_fig_number)
                     SELECT id,'fig-002',1,'manual','fig-002' FROM users WHERE username='blp'`);
      if (streit) {
        await c.query(`INSERT INTO minifigs (user_id,fig_number,quantity,source,bl_fig_number)
                       SELECT id,'fig-001',1,'manual','sw0001b' FROM users WHERE username='blp2'`);
      }
      await c.query('BEGIN');
      try { await c.query(sql); await c.query('COMMIT'); return null; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); return e.message; }
    } finally { c.release(); }
  };

  const zuordnung = async () => (await db.all(
    `SELECT art, rb_id, bl_id FROM bl_zuordnung ORDER BY art, rb_id`))
    .map(r => `${r.art} ${r.rb_id} ${r.bl_id === null ? '-' : r.bl_id}`);

  // ── Lauf 1: die ganze Datei ──────────────────────────────────────────────
  assert.equal(await lauf(skript), null,
    'Die Migration muss auf dieser Lage durchlaufen');
  assert.deepEqual(await zuordnung(), [
    'fig fig-001 sw0001',   // abweichende Nummer, von Hand eingegeben
    'fig fig-002 -',        // „heisst genauso" → leer, EINE Schreibweise
    'part 3001 3001a',      // aus der Zuordnung
    'part 3002 -',          // aus der Zuordnung, Notiz bl == rb → leer
    'part 3003 3003b',      // aus dem Set-Teile-Katalog
    'part 3004 -',          // dort bl == rb → leer
    'part 3005 3005c',      // aus der Bestandszeile
  ], 'Der Nachtrag hat nicht alle vier Quellen zusammengetragen, oder „keine ' +
     'abweichende Nummer" steht in zwei Schreibweisen (einmal leer, einmal ' +
     'als dieselbe Nummer)');

  // ── Lauf 2: ohne Schritt 1 — der Riegel muss greifen ─────────────────────
  const ohneNachtrag = skript.replace(nachtrag, '');
  assert.notEqual(ohneNachtrag, skript, 'Schritt 1 wurde nicht herausgeschnitten');
  const meldung = await lauf(ohneNachtrag);
  assert.match(String(meldung), /Zeilen aus rb_bl_mapping sind nicht uebernommen/,
    `Der Riegel hat nicht gegriffen. Postgres sagte: ${meldung}`);
  assert.ok((await spaltenVon('parts')).includes('bl_part_number'),
    'parts.bl_part_number ist trotz Abbruch weg — dann rollt die Transaktion nicht zurück');
  assert.ok(await tabelleDa('rb_bl_mapping'),
    'rb_bl_mapping ist trotz Abbruch weg');

  // ── Lauf 3: GEGENPROBE, ohne Schritt 1 UND ohne Schritt 2 ────────────────
  //
  // Der Kern. Lauf 2 zeigt nur, dass es knallt; erst Lauf 3 zeigt, dass der
  // RIEGEL es ist, der den Verlust verhindert.
  const ohneBeides = ohneNachtrag.replace(riegel, '');
  assert.notEqual(ohneBeides, ohneNachtrag, 'Schritt 2 wurde nicht herausgeschnitten');
  assert.equal(await lauf(ohneBeides), null,
    'Ohne den Riegel muss die Datei durchlaufen — sonst beweist Lauf 2 nichts');
  assert.deepEqual(await zuordnung(), [],
    'Ohne Schritt 1 darf die Zuordnung LEER sein — sonst trägt etwas anderes ' +
    'nach und Lauf 2 beweist nichts');
  assert.ok(!(await spaltenVon('parts')).includes('bl_part_number'),
    'Ohne Riegel müssen die Spalten gelöscht sein — sonst beweist Lauf 2 nichts');
  assert.ok(!(await tabelleDa('rb_bl_mapping')),
    'Ohne Riegel muss auch die alte Tabelle weg sein');

  // ── Lauf 4: der WIDERSPRUCH ──────────────────────────────────────────────
  //
  // Zwei Konten haben derselben Figur verschiedene BrickLink-Nummern gegeben.
  // Bei den Figuren kann das wirklich vorkommen: Die Nummer wird dort von Hand
  // eingegeben (routes/minifigs.ts), und zwar je Konto. Genau hier darf die
  // Migration nicht eine der beiden gewinnen lassen.
  const streitMeldung = await lauf(skript, true);
  assert.match(String(streitMeldung), /widersprechen sich die Quellen/,
    `Der Widerspruchs-Riegel hat nicht gegriffen. Postgres sagte: ${streitMeldung}`);
  assert.match(String(streitMeldung), /fig fig-001: sw0001 oder sw0001b|fig fig-001: sw0001b oder sw0001/,
    'Die Meldung nennt nicht BEIDE Nummern — dann kann der Mensch nicht entscheiden');
  assert.ok((await spaltenVon('minifigs')).includes('bl_fig_number'),
    'minifigs.bl_fig_number ist trotz Abbruch weg');

  // ── Und die GEGENPROBE zum Widerspruch ───────────────────────────────────
  //
  // Dieselbe Lage ohne Widerspruch läuft durch. Ohne diesen Lauf könnte der
  // Riegel einfach immer abbrechen, sobald zwei Konten dieselbe Figur halten.
  assert.equal(await lauf(skript, false), null,
    'Ohne Widerspruch muss die Migration durchlaufen — sonst bricht der Riegel ' +
    'nicht beim Widerspruch ab, sondern immer');
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
  await db.run(`INSERT INTO parts (user_id,part_number,color_id,quantity,source)
                VALUES ($1,'3070b',0,5,'manual')`, [uid]);
  await db.run(`INSERT INTO minifigs (user_id,fig_number,quantity,source)
                VALUES ($1,'fig-9',2,'manual')`, [uid]);
  await db.run(`INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition)
                VALUES ($1,'3070b',0,5,1.00,'N')`, [uid]);
  await db.run(`INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
                VALUES ($1,'fig-9',2,5.00,'N')`, [uid]);
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
