/**
 * Der Lagerort lässt sich beim ERFASSEN setzen — nicht erst danach.
 *
 * ── Marcos Befund vom 24.09. ────────────────────────────────────────────────
 *
 *   „Wenn ich aus dem Katalog etwas in die Galerie aufnehme, kann ich den
 *    Lagerort nicht setzen. Wenn ich etwas aus der Merkliste in die Galerie
 *    aufnehme, kann ich den Lagerort nicht setzen. Wenn ich ein Set in der
 *    Galerie hinzufügen will, kann ich den Lagerort nicht wählen. […] Bei den
 *    manuell erfassten Teilen kann ich beim Erfassen keinen Lagerort setzen.
 *    Bei manuelle erfassten Minifiguren kann ich beim Erfassen keinen
 *    Lagerort setzen."
 *
 * ── Warum das mehr war als sechs fehlende Eingabefelder ─────────────────────
 *
 * Die Spalte liess sich ausschliesslich NACH dem Erfassen füllen, über
 * PUT …/storage aus dem Detaildialog. addSet(), addManualPart(),
 * addManualFig() und uebernimm() kannten kein `storage`. Bei Minifiguren gab
 * es die Spalte überhaupt nicht (Migration 0024).
 *
 * ── Warum gegen eine echte Datenbank ────────────────────────────────────────
 *
 * Die Aussage ist „nach dem Erfassen steht der Ort in der Zeile UND im
 * Vorrat". Beides sind Aussagen über Zeilen. Eine Quelltext-Regel könnte
 * prüfen, dass irgendwo `storage` steht — und wäre mit einem durchgereichten
 * Parameter zufrieden, der nirgends ankommt.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Der Lagerort-Aufruf in addSet() entfernt            → Schritt 1 rot.
 *   b) desgleichen in addManualPart()                      → Schritt 3 rot.
 *   c) desgleichen in addManualFig()                       → Schritt 4 rot.
 *   d) `storage` in uebernimm() nicht durchgereicht        → Schritt 5 rot.
 *   e) minifigs in lagerorte() nicht mitgezählt            → Schritt 6 rot.
 *   f) minifigs in loescheOrt() nicht mitgezählt           → Schritt 7 rot.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

const U = {};

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); }
  finally { client.release(); }
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('ich','x')`);
  U.ich = (await db.get(`SELECT id FROM users WHERE username='ich'`)).id;
}

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

/** Steht der Ort im VORRAT? Das ist die Hälfte, die ein blosses UPDATE nicht tut. */
async function imVorrat(uid, name) {
  const r = await db.get(
    'SELECT 1 AS da FROM storage_locations WHERE user_id=$1 AND lower(name)=lower($2)',
    [uid, name]);
  return !!r;
}

test('Lagerort beim Erfassen — gegen echte Datenbank', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }
  await seed();
  const setService = _req('utils/setService.js');
  const teile      = _req('routes/parts.js');
  const figuren    = _req('routes/minifigs.js');
  const merkliste  = _req('utils/merkliste.js');
  const L          = _req('utils/lagerort.js');

  await t.test('1. Ein Set kommt mit seinem Lagerort in die Galerie', async () => {
    // Ohne Netz: getSetInfo/Brickset scheitern still und addSet legt die Zeile
    // trotzdem an („Set 10179-1"). Genau das ist hier erwünscht — geprüft wird
    // der Lagerort, nicht die Anreicherung.
    await setService.addSet('10179-1', 1, U.ich, null, null, 'N', 'Kiste 3');
    const r = await db.get('SELECT storage FROM sets WHERE user_id=$1 AND set_number=$2',
      [U.ich, '10179-1']);
    assert.equal(r?.storage, 'Kiste 3',
      'Das Set wurde erfasst, aber ohne den mitgegebenen Lagerort.');
  });

  await t.test('2. Der neu getippte Ort landet im Vorrat', async () => {
    // Sonst stünde er am Set, fehlte aber in der Auswahlliste, aus der er
    // gewählt werden soll — Marcos „man kann auch gleich neue Auswahlwerte
    // erfassen".
    assert.ok(await imVorrat(U.ich, 'Kiste 3'),
      'Der Ort steht am Set, aber nicht im Vorrat.');
  });

  await t.test('3. Ein manuell erfasstes Teil bekommt seinen Lagerort', async () => {
    await teile.addManualPart(U.ich,
      { part_number: '3001', color_id: 4, quantity: 2, storage: 'Regal B' });
    const r = await db.get(
      `SELECT storage FROM parts WHERE user_id=$1 AND part_number=$2 AND source='manual'`,
      [U.ich, '3001']);
    assert.equal(r?.storage, 'Regal B');
    assert.ok(await imVorrat(U.ich, 'Regal B'), 'Nicht im Vorrat');
  });

  await t.test('4. Eine manuell erfasste Minifigur bekommt ihren Lagerort', async () => {
    // Bis Migration 0024 gab es die Spalte gar nicht.
    await figuren.addManualFig(U.ich,
      { fig_number: 'sw0001', quantity: 1, storage: 'Vitrine' });
    const r = await db.get(
      `SELECT storage FROM minifigs WHERE user_id=$1 AND fig_number=$2`,
      [U.ich, 'sw0001']);
    assert.equal(r?.storage, 'Vitrine');
    assert.ok(await imVorrat(U.ich, 'Vitrine'), 'Nicht im Vorrat');
  });

  await t.test('5. Die Übernahme aus der Merkliste reicht ihn durch', async () => {
    await db.run(
      `INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,$2,'N')`,
      [U.ich, '75192-1']);
    await merkliste.uebernimm(U.ich, U.ich, '75192-1', 'N', { quantity: 1, storage: 'Dachboden' });
    const r = await db.get('SELECT storage FROM sets WHERE user_id=$1 AND set_number=$2',
      [U.ich, '75192-1']);
    assert.equal(r?.storage, 'Dachboden',
      'Der Merkposten wurde übernommen, der Lagerort ging dabei verloren.');
  });

  await t.test('6. Die Übersicht zählt Figuren EIGEN, nicht als Teilesorten', async () => {
    // „18 Teilesorten" hiesse sonst mal 18 Teilesorten und mal 12 plus 6
    // Figuren, und niemand könnte der Zahl ansehen, was gemeint ist.
    const liste = await L.lagerorte([U.ich]);
    const vitrine = liste.find(o => o.ort === 'Vitrine');
    assert.ok(vitrine, 'Ein Ort, in dem NUR eine Figur liegt, fehlt in der Übersicht.');
    assert.deepEqual([vitrine.sets, vitrine.teile, vitrine.figuren], [0, 0, 1]);
    const kiste = liste.find(o => o.ort === 'Kiste 3');
    assert.deepEqual([kiste.sets, kiste.teile, kiste.figuren], [1, 0, 0]);
  });

  await t.test('7. Ein Ort mit nur einer Figur darin lässt sich nicht löschen', async () => {
    // Sonst zeigte die Zuordnung der Figur danach auf einen Namen, den der
    // Vorrat nicht mehr kennt.
    const ort = await db.get(
      'SELECT id FROM storage_locations WHERE user_id=$1 AND name=$2', [U.ich, 'Vitrine']);
    // Geprüft wird `code`, nicht der Text: fehlerWerfen() legt die deutsche
    // Fassung in `message` und den Code daneben (utils/fehlerTexte.ts). Auf
    // den Text zu prüfen hiesse, die Regel an eine Übersetzung zu hängen.
    await assert.rejects(() => L.loescheOrt(U.ich, parseInt(ort.id)),
      (e) => e?.code === 'lagerort_in_benutzung',
      'Der Ort liess sich löschen, obwohl eine Figur darin liegt.');
  });

  await t.test('8. Umbenennen nimmt die Figuren mit', async () => {
    const ort = await db.get(
      'SELECT id FROM storage_locations WHERE user_id=$1 AND name=$2', [U.ich, 'Vitrine']);
    await L.benenneOrtUm(U.ich, parseInt(ort.id), 'Vitrine Wohnzimmer');
    const r = await db.get('SELECT storage FROM minifigs WHERE user_id=$1 AND fig_number=$2',
      [U.ich, 'sw0001']);
    assert.equal(r?.storage, 'Vitrine Wohnzimmer',
      'Der Vorrat wurde umbenannt, die Figur zeigt auf den alten Namen.');
  });

  await db.pool.end().catch(() => {});
});
