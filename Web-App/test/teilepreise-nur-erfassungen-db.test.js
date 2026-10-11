/**
 * Preis und Zustand von Teilen und Figuren stehen an GENAU EINEM Ort.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „Ich muss dir bei unit_price, purchase_price und condition widersprechen.
 *    Diese Informationen gehören in die set_acuisitions tabelle, da sie pro
 *    Kauf hinterlegt werden."
 *
 * Fuer Sets hat Migration 0032 das gemacht (test/sets-ohne-kaufpreisspalte-db).
 * Migration 0035 ist dasselbe fuer Teile und Minifiguren.
 *
 * ── Was dieser Test prueft ──────────────────────────────────────────────────
 *
 *   1. Nach der GANZEN Migrationskette tragen parts und minifigs keinen Preis
 *      und keinen Zustand mehr — und die Erfassungstabellen tragen sie.
 *   2. Der Riegel greift, wenn eine manuelle Position ihre Erfassung oder
 *      ihren Kaufpreis verlieren wuerde. Mit GEGENPROBE: ohne Riegel laeuft
 *      dieselbe Lage durch und der Preis ist weg.
 *   3. Set-Teile bekommen KEINE Erfassung — fuer sie gab es keinen eigenen
 *      Kauf, gekauft wurde das Set.
 *   4. Die Leseabfragen liefern Preis und Zustand weiterhin, aus der
 *      neuesten Erfassung.
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

// Dieselbe Begruendung wie in test/sets-ohne-kaufpreisspalte-db.test.js: Diese
// Datei baut die Datenbank mehrfach von null auf.
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  } catch (e) {
    console.error('[teilepreise-nur-erfassungen] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const spaltenVon = async (tabelle) => (await db.all(
  `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
  .map(r => r.column_name).sort();

const dbDa = async (t) => {
  try { await db.run('SELECT 1'); return true; }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return false;
  }
};

const MIG_DIR = path.join(ROOT, 'db', 'migrations');
const DATEI   = path.join(MIG_DIR, '0035-teilepreise-nur-in-erfassungen.sql');

test('nach der ganzen Kette tragen parts und minifigs keinen Preis mehr',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // ── Zwischenstand: der Selbstnachweis ────────────────────────────────────
  //
  // VOR den Migrationen muessen die Spalten da sein, aus zwei Gruenden:
  // Migration 0007 schreibt `ALTER COLUMN unit_price TYPE NUMERIC` und bricht
  // auf einer fehlenden Spalte ab, und der Nachtrag in 0035 LIEST sie, um sie
  // in die Erfassung zu tragen.
  //
  // Ohne diese Zusicherung saehe die Pruefung unten auch bei einer leeren
  // Tabelle gruen aus.
  const vorher = await spaltenVon('parts');
  for (const sp of ['unit_price', 'purchase_price', 'condition']) {
    assert.ok(vorher.includes(sp),
      `parts.${sp} fehlt schon vor den Migrationen — dann bricht Migration 0007 ` +
      'oder der Nachtrag in 0035 beim ersten Start einer frischen Installation ab.');
  }
  const vorherFigs = await spaltenVon('minifigs');
  for (const sp of ['unit_price', 'purchase_price', 'condition']) {
    assert.ok(vorherFigs.includes(sp), `minifigs.${sp} fehlt vor den Migrationen`);
  }

  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  const nachher = await spaltenVon('parts');
  for (const sp of ['unit_price', 'purchase_price', 'condition']) {
    assert.ok(!nachher.includes(sp),
      `parts.${sp} ist nach allen Migrationen noch da — Migration 0035 hat nicht ` +
      'geloescht, oder etwas legt die Spalte danach wieder an.');
  }
  // Und der Bestand ist noch da: Marcos Liste, plus was den Kauf NICHT betrifft.
  // bl_part_number stand hier und ist weg: Migration 0037 hat sie geloescht,
  // die BrickLink-Nummer steht in bl_zuordnung (einmal je Teil statt je
  // Konto). Siehe test/bricklink-zuordnung-db.test.js.
  for (const sp of ['id', 'user_id', 'set_number', 'part_number', 'color_id',
                    'quantity', 'source', 'storage_id', 'added_at']) {
    assert.ok(nachher.includes(sp), `parts.${sp} fehlt — die Spalte gehoert zum Bestand`);
  }

  const figsNachher = await spaltenVon('minifigs');
  for (const sp of ['unit_price', 'purchase_price', 'condition']) {
    assert.ok(!figsNachher.includes(sp), `minifigs.${sp} ist nach allen Migrationen noch da`);
  }

  // Nicht verschwunden, sondern umgezogen.
  for (const [tab, spalten] of [
    ['part_acquisitions',    ['user_id', 'part_number', 'color_id', 'quantity', 'unit_price', 'condition', 'created_at']],
    ['minifig_acquisitions', ['user_id', 'fig_number', 'quantity', 'unit_price', 'condition', 'created_at']],
  ]) {
    const vorhanden = await spaltenVon(tab);
    for (const sp of spalten) {
      assert.ok(vorhanden.includes(sp),
        `${tab}.${sp} fehlt — dann gibt es den Kaufpreis nirgends mehr`);
    }
  }
});

test('Migration 0035 löscht nur, wenn kein Kaufpreis verloren geht',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  // ── Drei Laeufe auf derselben Lage ───────────────────────────────────────
  //
  //   1. ganze Datei           → traegt nach, loescht, der Preis ist in der Erfassung
  //   2. ohne Schritt 1        → der Riegel bricht ab, die Spalten bleiben
  //   3. ohne Schritt 1 und 2  → laeuft durch, die Spalten sind weg, der Preis weg
  //
  // Lauf 2 ist die Zusage, Lauf 3 die GEGENPROBE: Er zeigt, dass der Riegel
  // tatsaechlich das ist, was den Verlust verhindert — und nicht etwa Postgres
  // oder ein Zufall der Reihenfolge.
  const skript = fs.readFileSync(DATEI, 'utf8');

  const nachtrag = skript.slice(skript.indexOf('DO $nachtrag$'),
                               skript.indexOf('END $nachtrag$;') + 15);
  const riegel   = skript.slice(skript.indexOf('DO $pruefung$'),
                               skript.indexOf('END $pruefung$;') + 15);
  assert.match(nachtrag, /INSERT INTO part_acquisitions/,
    'Schritt 1 (der Nachtrag) steht nicht mehr als DO $nachtrag$-Block');
  assert.match(nachtrag, /INSERT INTO minifig_acquisitions/,
    'Der Nachtrag traegt die Figuren nicht mehr nach');
  assert.match(riegel, /RAISE EXCEPTION '% manuelle Teile haben keine Erfassung/,
    'Der Riegel prüft nicht mehr auf fehlende Erfassungen');
  assert.match(riegel, /RAISE EXCEPTION '% manuelle Teile wuerden ihren Kaufpreis verlieren/,
    'Der Riegel prüft nicht mehr auf verlorene Kaufpreise');
  assert.ok(skript.indexOf('DO $nachtrag$') < skript.indexOf('DO $pruefung$'),
    'Der Riegel muss NACH dem Nachtrag stehen, sonst prüft er die alte Lage');

  /**
   * Frische Datenbank, alle Migrationen VOR 0035, eine manuelle Position mit
   * Preis und Zustand aber OHNE Erfassung — dann das uebergebene Skript.
   * @returns {Promise<string|null>} Fehlermeldung von Postgres, sonst null
   */
  const lauf = async (sql) => {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      for (const f of fs.readdirSync(MIG_DIR).filter(x => x.endsWith('.sql')).sort()) {
        if (f.startsWith('0035')) break;
        await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      }
      await c.query(`INSERT INTO users (username,password_hash) VALUES ('preise','x')`);
      // Die Erfassungen loeschen, die initSchema() beim Erststart angelegt
      // haben koennte — hier soll genau der Fall ohne Erfassung stehen.
      await c.query(`DELETE FROM part_acquisitions`);
      await c.query(`INSERT INTO parts (user_id,part_number,color_id,quantity,source,
                                        unit_price,purchase_price,condition,added_at)
                     SELECT id,'98138',14,7,'manual',1.25,1.25,'U','2023-03-03'
                       FROM users WHERE username='preise'`);
      // Ein Set-Teil dazu: Es darf KEINE Erfassung bekommen.
      await c.query(`INSERT INTO sets (user_id,set_number,quantity)
                     SELECT id,'75192-1',1 FROM users WHERE username='preise'`);
      await c.query(`INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
                     SELECT id,'75192-1','3001',4,6,'set' FROM users WHERE username='preise'`);
      await c.query('BEGIN');
      try { await c.query(sql); await c.query('COMMIT'); return null; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); return e.message; }
    } finally { c.release(); }
  };

  // ── Lauf 1: die ganze Datei ──────────────────────────────────────────────
  assert.equal(await lauf(skript), null,
    'Die Migration muss auf dieser Lage durchlaufen — Schritt 1 trägt die ' +
    'fehlende Erfassung ja gerade nach');
  const erf = await db.get(
    `SELECT quantity, unit_price, condition, created_at
       FROM part_acquisitions WHERE part_number='98138'`);
  assert.ok(erf, 'Schritt 1 hat für die manuelle Position keine Erfassung nachgetragen');
  assert.equal(Number(erf.unit_price), 1.25, 'Der Kaufpreis ist beim Umzug verloren gegangen');
  assert.equal(erf.condition, 'U', 'Der Zustand ist verloren gegangen');
  assert.equal(Number(erf.quantity), 7, 'Die Menge ist verloren gegangen');
  // toISOString, nicht String(): Der Treiber liefert ein Date, und dessen
  // Textform ist „Fri Mar 03 2023 …" — ein slice(0,10) darauf verglich
  // „Fri Mar 0" mit dem Datum und war immer rot.
  assert.equal(new Date(erf.created_at).toISOString().slice(0, 10), '2023-03-03',
    'Das Aufnahmedatum ist nicht mitgekommen — der Portfolio-Verlauf ordnet danach');

  // ── Set-Teile bekommen KEINE Erfassung ───────────────────────────────────
  //
  // Fuer sie gab es keinen eigenen Kauf; gekauft wurde das Set. Eine Erfassung
  // hier wuerde in der Finanzansicht als zweiter Kaufpreis mitzaehlen.
  const setTeil = await db.get(
    `SELECT COUNT(*)::int AS c FROM part_acquisitions WHERE part_number='3001'`);
  assert.equal(setTeil.c, 0,
    'Ein Set-Teil hat eine Erfassung bekommen — es gab aber keinen eigenen Kauf');

  // ── Lauf 2: ohne Schritt 1 — der Riegel muss greifen ─────────────────────
  const ohneNachtrag = skript.replace(nachtrag, '');
  assert.notEqual(ohneNachtrag, skript, 'Schritt 1 wurde nicht herausgeschnitten');
  const meldung = await lauf(ohneNachtrag);
  assert.match(String(meldung), /1 manuelle Teile haben keine Erfassung/,
    `Der Riegel hat nicht gegriffen. Postgres sagte: ${meldung}`);
  const nachAbbruch = await spaltenVon('parts');
  for (const sp of ['unit_price', 'purchase_price', 'condition']) {
    assert.ok(nachAbbruch.includes(sp),
      `parts.${sp} ist trotz Abbruch weg — dann rollt die Transaktion nicht zurück`);
  }
  const preisDa = await db.get(`SELECT unit_price FROM parts WHERE part_number='98138'`);
  assert.equal(Number(preisDa.unit_price), 1.25, 'Der Preis ist trotz Abbruch verschwunden');

  // ── Lauf 3: GEGENPROBE, ohne Schritt 1 UND ohne Schritt 2 ────────────────
  const ohneBeides = ohneNachtrag.replace(riegel, '');
  assert.notEqual(ohneBeides, ohneNachtrag, 'Schritt 2 wurde nicht herausgeschnitten');
  assert.equal(await lauf(ohneBeides), null,
    'Ohne den Riegel muss die Datei durchlaufen — sonst beweist Lauf 2 nichts');
  assert.deepEqual(
    (await spaltenVon('parts')).filter(c => ['unit_price', 'condition'].includes(c)), [],
    'Ohne Riegel müssen die Spalten gelöscht sein — sonst beweist Lauf 2 nichts');
  const verloren = await db.get(
    `SELECT COUNT(*)::int AS c FROM part_acquisitions WHERE part_number='98138'`);
  assert.equal(verloren.c, 0,
    'Ohne Schritt 1 darf es die Erfassung NICHT geben — der Preis war nur auf der ' +
    'Bestandszeile. Gibt es sie, trägt sie etwas anderes nach und Lauf 2 beweist nichts.');
});

test('die Listen liefern Preis und Zustand aus der neuesten Erfassung',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c0 = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c0); } finally { c0.release(); }

  const u = await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('preisleser','x') RETURNING id`);
  const uid = u.id;

  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3002','Brick 2x3')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3002',1,'Blau') ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES ('fig-5','Testfigur')
                ON CONFLICT (fig_number) DO NOTHING`);
  await db.run(`INSERT INTO parts (user_id,part_number,color_id,quantity,source)
                VALUES ($1,'3002',1,5,'manual')`, [uid]);
  await db.run(`INSERT INTO minifigs (user_id,fig_number,quantity,source)
                VALUES ($1,'fig-5',3,'manual')`, [uid]);

  // ZWEI Erfassungen, verschiedene Tage und Zustaende. Die neuere ist die, die
  // als „der Preis dieses Teils" angezeigt werden muss — die aeltere darf ihn
  // nicht verdecken.
  await db.run(`INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                VALUES ($1,'3002',1,2,1.00,'N', NOW() - INTERVAL '3 days'),
                       ($1,'3002',1,3,2.00,'U', NOW() - INTERVAL '1 day')`, [uid]);
  await db.run(`INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition,created_at)
                VALUES ($1,'fig-5',1,5.00,'N', NOW() - INTERVAL '2 days'),
                       ($1,'fig-5',2,7.50,'U', NOW())`, [uid]);

  const H = _req('utils/handlers/parts.js');
  const M = _req('utils/handlers/minifigs.js');

  const teile = await H.getManualParts([uid], uid);
  const teil = (Array.isArray(teile) ? teile : teile.parts || []).find(p => p.part_number === '3002');
  assert.ok(teil, `Das Teil fehlt in der Antwort: ${JSON.stringify(teile).slice(0, 300)}`);
  assert.equal(Number(teil.unit_price), 2.00,
    'unit_price muss der Preis der NEUESTEN Erfassung sein');
  assert.equal(Number(teil.purchase_price), 2.00,
    'purchase_price ist der Anzeigewert und darf nicht leer sein');
  assert.equal(teil.condition, 'U',
    'Eine gebrauchte Erfassung macht das Teil gebraucht (conditionFromAcquisitions)');

  const figs = await M.getManualMinifigs([uid], uid);
  const fig = (Array.isArray(figs) ? figs : figs.minifigs || []).find(f => f.fig_number === 'fig-5');
  assert.ok(fig, `Die Figur fehlt in der Antwort: ${JSON.stringify(figs).slice(0, 300)}`);
  assert.equal(Number(fig.unit_price), 7.50,
    'unit_price muss der Preis der NEUESTEN Erfassung sein');
  assert.equal(fig.condition, 'U', 'Eine gebrauchte Erfassung macht die Figur gebraucht');

  // ── Und ohne Preis bleibt der Anzeigewert 0, nicht leer ──────────────────
  //
  // utils/preisRegel.ts unterscheidet die beiden Bedeutungen: In der Erfassung
  // heisst NULL „kein Preis bekannt", der Anzeigewert ist dann 0. Vor
  // Migration 0035 stand diese 0 in parts.purchase_price; jetzt bildet die
  // Leseabfrage sie.
  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3003','Plate 1x1')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO parts (user_id,part_number,color_id,quantity,source)
                VALUES ($1,'3003',0,1,'manual')`, [uid]);
  await db.run(`INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition)
                VALUES ($1,'3003',0,1,NULL,'N')`, [uid]);
  const teile2 = await H.getManualParts([uid], uid);
  const ohnePreis = (Array.isArray(teile2) ? teile2 : teile2.parts || [])
    .find(p => p.part_number === '3003');
  assert.ok(ohnePreis, 'Das Teil ohne Preis fehlt in der Antwort');
  assert.equal(ohnePreis.unit_price, null,
    'Ohne Preis muss unit_price leer sein — das ist die Aussage „nichts eingegeben"');
  assert.equal(Number(ohnePreis.purchase_price), 0,
    'Der Anzeigewert muss 0 sein, nicht leer — siehe utils/preisRegel.ts');
});
