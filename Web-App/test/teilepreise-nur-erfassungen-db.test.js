/**
 * Seit db/basis.sql gibt es den Stand VOR dieser Migration nicht mehr: Die
 * Fälle zu Riegel, Nachtrag und Zwischenstand sind entfallen. Geprüft werden
 * der Endstand und die Lesewege.
 *
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

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltFigur, haeltTeil } = require('./helpers/bestand');

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

const MIG_DIR = path.join(ROOT, 'db/migrations');
const DATEI   = path.join(MIG_DIR, '0035-teilepreise-nur-in-erfassungen.sql');

test('nach der ganzen Kette tragen parts und minifigs keinen Preis mehr',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // Den Vorstand vor den Migrationen gibt es nicht mehr: Eine leere
  // Datenbank bekommt db/basis.sql. Geprüft wird der Endstand.
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
  // quantity stand hier und ist weg: Migration 0038 hat sie geloescht — fuer
  // ein Set-Teil ist die Stückzahl die Katalogzahl, fuer ein manuelles die
  // Summe der Erfassungen. Siehe test/teilemengen-abgeleitet-db.test.js.
  for (const sp of ['id', 'user_id', 'set_number', 'part_number', 'color_id',
                    'source', 'storage_id', 'added_at']) {
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
  // Nur die Bestandszeilen, ohne Menge: Die beiden Erfassungen weiter unten
  // tragen sie (Migration 0038). haeltTeil() mit menge 0 legt deshalb keine
  // eigene Erfassung an — die Tagesregel liesse daneben keine zweite zu.
  await haeltTeil(db, uid, '3002', { menge: 0, colorId: 1 });
  await haeltFigur(db, uid, 'fig-5', { menge: 0 });

  // ZWEI Erfassungen, verschiedene Tage und Zustaende. Die neuere ist die, die
  // als „der Preis dieses Teils" angezeigt werden muss — die aeltere darf ihn
  // nicht verdecken.
  await db.run(`INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                VALUES ($1,'3002',1,2,1.00,'N', NOW() - INTERVAL '3 days'),
                       ($1,'3002',1,3,2.00,'U', NOW() - INTERVAL '1 day')`, [uid]);
  await db.run(`INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition,created_at)
                VALUES ($1,'fig-5',1,5.00,'N', NOW() - INTERVAL '2 days'),
                       ($1,'fig-5',2,7.50,'U', NOW())`, [uid]);

  const H = _req('src/teile/abfragen.js');
  const M = _req('src/figuren/abfragen.js');

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
  // Menge 0 fuer die Bestandszeile, die Erfassung kommt darunter mit
  // AUSDRUECKLICH leerem Preis — das ist die Aussage dieses Falls.
  await haeltTeil(db, uid, '3003', { menge: 0, colorId: 0 });
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
