/**
 * Der Lagerort am Bestand ist eine ID — und was das rettet.
 *
 * ── Marcos Frage ────────────────────────────────────────────────────────────
 *
 *   „Wäre es nicht schöner wenn auf den Sets eine id für storage abgelegt
 *    wäre?"
 *
 * Ja, und zwar nicht aus Geschmack. Diese Datei führt genau den Ablauf durch,
 * der mit dem NAMEN schiefging. Gemessen, beide Male, mit demselben Skript:
 *
 *                              vorher (Name)        jetzt (ID)
 *   Vorrat                     ['Estrich']          ['Estrich']
 *   am Set getippt: "estrich"  Set: "estrich"       Set: "Estrich"
 *   Umbenennen → Dachboden     Set: "estrich"  (!)  Set: "Dachboden"
 *   Löschen des Ortes          GELUNGEN        (!)  abgelehnt (belegt)
 *   Auswahlliste danach        []              (!)  ['Dachboden']
 *
 * Drei Symptome, eine Ursache: Die Zuordnung wurde zeichengenau verglichen,
 * die Eindeutigkeit im Vorrat aber ohne Rücksicht auf Gross-/Kleinschreibung
 * (`lower(name)`, Migration 0020). Am Ende stand genau das, wovor 0020 selbst
 * warnt — ein Wert, den die Oberfläche nicht zur Wahl stellt.
 *
 * ── Warum diese Datei und nicht ein Zusatz in lagerort-db.test.js ──────────
 *
 * Dort steht, was der Lagerort TUT. Hier steht, warum er als ID dasteht. Das
 * sind zwei Fragen, und die zweite wird jemand stellen, der die Spalte sieht
 * und sie für Umstand hält.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

let UID = 0;

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); }
  finally { client.release(); }
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('ich','x')`);
  UID = (await db.get("SELECT id FROM users WHERE username='ich'")).id;
  await db.run(`INSERT INTO sets (user_id, set_number, quantity) VALUES ($1,$2,1)`,
    [UID, '10179-1']);
}

/** Der NAME, den die Oberfläche am Set sieht — über den Vorrat aufgelöst. */
async function ortAmSet(sn) {
  return (await db.get(
    `SELECT l.name FROM sets t LEFT JOIN storage_locations l ON l.id = t.storage_id
      WHERE t.user_id = $1 AND t.set_number = $2`, [UID, sn]))?.name ?? null;
}

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Lagerort als ID gegen echte Datenbank', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }
  await seed();
  const L = _req('utils/lagerort.js');
  const household = _req('utils/household.js');
  const schreibbar = await household.writableIds(UID);

  const estrich = (await L.legeOrtAn(UID, 'Estrich')).ort;

  await t.test('eine andere Schreibweise landet im VORHANDENEN Ort', async () => {
    // Der Kern. Getippt wird „estrich", im Vorrat steht „Estrich" — und das
    // Set zeigt danach die Schreibweise des Vorrats. Mit dem Namen am Bestand
    // stand hier „estrich", und damit war die Zuordnung von da an eine andere
    // Zeichenkette als der Eintrag, aus dem sie gewählt wurde.
    const n = await L.setzeLagerort('set', schreibbar, ['10179-1'], 'estrich');
    assert.equal(n, 1, `${n} Zeilen getroffen, erwartet 1`);
    assert.equal(await ortAmSet('10179-1'), 'Estrich',
      'Das Set trägt eine eigene Schreibweise — dann ist es nicht derselbe Ort');
    const orte = (await L.orteVon([UID])).map(o => o.name);
    assert.deepEqual(orte, ['Estrich'],
      `Der Vorrat hat ${orte.length} Einträge: ${orte} — „estrich" hat einen zweiten angelegt`);
    const id = (await db.get(
      'SELECT storage_id FROM sets WHERE user_id=$1 AND set_number=$2', [UID, '10179-1'])).storage_id;
    assert.equal(parseInt(String(id)), estrich.id,
      'Die Zeile zeigt nicht auf den Eintrag im Vorrat');
  });

  await t.test('Umbenennen wirkt ohne eine Zeile Nacharbeit', async () => {
    // benenneOrtUm() schreibt NUR den Vorrat um. Mit dem Namen brauchte es
    // dafür eine Schleife über drei Tabellen in einer Transaktion — und die
    // verglich zeichengenau, traf „estrich" also nicht.
    await L.benenneOrtUm(UID, estrich.id, 'Dachboden');
    assert.equal(await ortAmSet('10179-1'), 'Dachboden',
      'Das Set steht im alten Ort — das Umbenennen war ein Verlieren');
  });

  await t.test('ein belegter Ort laesst sich nicht loeschen', async () => {
    // Die Belegt-Prüfung zählt über die ID. Mit dem Namen zählte sie bei
    // abweichender Schreibweise null und gab den Ort frei — das Set behielt
    // danach einen Namen, den die Auswahlliste nicht mehr kannte.
    await assert.rejects(() => L.loescheOrt(UID, estrich.id),
      e => String(e.code) === 'lagerort_in_benutzung',
      'Ein belegter Ort liess sich loeschen');
    assert.deepEqual((await L.orteVon([UID])).map(o => o.name), ['Dachboden'],
      'Die Auswahlliste ist leer, das Set zeigt aber weiter auf einen Ort');
  });

  await t.test('leeren setzt die ID auf NULL', async () => {
    // Leer und NULL sind dasselbe: „nicht erfasst" (Begründung in 0018).
    await L.setzeLagerort('set', schreibbar, ['10179-1'], null);
    assert.equal(await ortAmSet('10179-1'), null, 'Das Leeren hat nichts entfernt');
    // Und jetzt geht das Löschen, weil nichts mehr darin liegt.
    await L.loescheOrt(UID, estrich.id);
    assert.deepEqual(await L.orteVon([UID]), []);
  });

  await t.test('ein Fehlversuch legt keinen Ort im Vorrat an', async () => {
    // Diese Eigenschaft hatte der alte Weg nebenbei: Er ordnete zuerst zu und
    // legte den Ort nur bei Erfolg an. Mit der ID muss es umgekehrt laufen
    // (ohne Zeile keine ID), deshalb steht beides in einer Transaktion mit
    // Rücknahme. Ohne die stünde nach jedem Tippfehler ein Ort in der Liste.
    const vorher = (await L.orteVon([UID])).length;
    const n = await L.setzeLagerort('set', schreibbar, ['99999-1'], 'Geisterkiste');
    assert.equal(n, 0, 'Ein Set, das es nicht gibt, wurde angeblich geaendert');
    assert.equal((await L.orteVon([UID])).length, vorher,
      'Der Fehlversuch hat „Geisterkiste" im Vorrat hinterlassen');
  });

  await db.pool.end().catch(() => {});
});
