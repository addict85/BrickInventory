/**
 * Der Lagerort lässt sich beim ERFASSEN setzen — nicht erst danach.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Der Lagerort-Aufruf in setErfassen() entfernt       → Schritt 1 rot.
 *   b) desgleichen in addManualPart()                      → Schritt 3 rot.
 *   c) desgleichen in addManualFig()                       → Schritt 4 rot.
 *   d) `storage` in uebernimm() nicht durchgereicht        → Schritt 5 rot.
 *   e) minifigs in lagerorte() nicht mitgezählt            → Schritt 6 rot.
 *   f) minifigs in loescheOrt() nicht mitgezählt           → Schritt 7 rot.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');

/**
 * Der Lagerort-NAME einer Bestandszeile.
 *
 * Seit Migration 0031 traegt die Zeile eine ID; der Name steht im Vorrat. Die
 * Pruefungen unten fragen weiter nach dem Namen — das ist die Aussage, auf die
 * es ankommt — nur der Weg dorthin fuehrt jetzt ueber einen JOIN.
 */
async function ortVon(db, tabelle, bedingung, params) {
  const r = await db.get(
    `SELECT l.name AS storage
       FROM ${tabelle} t
       LEFT JOIN storage_locations l ON l.id = t.storage_id
      WHERE ${bedingung}`,
    params,
  );
  return r?.storage ?? null;
}
const db = testDaten();

const U = {};

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('ich','x')`);
  U.ich = (await db.get(`SELECT id FROM users WHERE username='ich'`)).id;
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

/** Steht der Ort im VORRAT? Das ist die Hälfte, die ein blosses UPDATE nicht tut. */
async function imVorrat(uid, name) {
  const r = await db.get('SELECT 1 AS da FROM storage_locations WHERE user_id=$1 AND lower(name)=lower($2)', [
    uid,
    name,
  ]);
  return !!r;
}

test('Lagerort beim Erfassen — gegen echte Datenbank', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }
  await seed();
  const setService = require('./helpers/sources').bereichsSeite('sets');
  const teile = _req('src/teile/manuelleTeile.js');
  const figuren = _req('src/figuren/manuelleFiguren.js');
  const merkliste = _req('src/merkliste/merkliste.js');
  const L = {
    ..._req('src/bestand/lagerort.js'),
    ...require('./helpers/sources').testBereich('bestand').lagerortDienst,
  };

  await t.test('1. Ein Set kommt mit seinem Lagerort in die Galerie', async () => {
    // Wie der CSV-Import (aufstocken); den Katalog holt der Auftrag, geprüft wird der Lagerort.
    await setService.setErfassen({
      anfragender: U.ich,
      setNumber: '10179-1',
      menge: 1,
      zustand: 'N',
      lagerort: 'Kiste 3',
      wennVorhanden: 'aufstocken',
    });
    const ort = await ortVon(db, 'sets', 't.user_id=$1 AND t.set_number=$2', [U.ich, '10179-1']);
    assert.equal(ort, 'Kiste 3', 'Das Set wurde erfasst, aber ohne den mitgegebenen Lagerort.');
  });

  await t.test('2. Der neu getippte Ort landet im Vorrat', async () => {
    // Sonst stünde er am Set, fehlte aber in der Auswahlliste, aus der er
    // gewählt werden soll — Marcos „man kann auch gleich neue Auswahlwerte
    // erfassen".
    assert.ok(await imVorrat(U.ich, 'Kiste 3'), 'Der Ort steht am Set, aber nicht im Vorrat.');
  });

  await t.test('3. Ein manuell erfasstes Teil bekommt seinen Lagerort', async () => {
    await teile.addManualPart(U.ich, { part_number: '3001', color_id: 4, quantity: 2, storage: 'Regal B' });
    const r = await db.get(
      `SELECT l.name AS storage FROM parts t
         LEFT JOIN storage_locations l ON l.id = t.storage_id
        WHERE t.user_id=$1 AND t.part_number=$2 AND t.source='manual'`,
      [U.ich, '3001'],
    );
    assert.equal(r?.storage, 'Regal B');
    assert.ok(await imVorrat(U.ich, 'Regal B'), 'Nicht im Vorrat');
  });

  await t.test('4. Eine manuell erfasste Minifigur bekommt ihren Lagerort', async () => {
    // Bis Migration 0024 gab es die Spalte gar nicht.
    await figuren.addManualFig(U.ich, { fig_number: 'sw0001', quantity: 1, storage: 'Vitrine' });
    const r = await db.get(
      `SELECT l.name AS storage FROM minifigs t
         LEFT JOIN storage_locations l ON l.id = t.storage_id
        WHERE t.user_id=$1 AND t.fig_number=$2`,
      [U.ich, 'sw0001'],
    );
    assert.equal(r?.storage, 'Vitrine');
    assert.ok(await imVorrat(U.ich, 'Vitrine'), 'Nicht im Vorrat');
  });

  await t.test('5. Die Übernahme aus der Merkliste reicht ihn durch', async () => {
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,$2,'N')`, [U.ich, '75192-1']);
    await merkliste.uebernimm(U.ich, U.ich, '75192-1', 'N', { quantity: 1, storage: 'Dachboden' });
    const ort = await ortVon(db, 'sets', 't.user_id=$1 AND t.set_number=$2', [U.ich, '75192-1']);
    assert.equal(ort, 'Dachboden', 'Der Merkposten wurde übernommen, der Lagerort ging dabei verloren.');
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
    const ort = await db.get('SELECT id FROM storage_locations WHERE user_id=$1 AND name=$2', [U.ich, 'Vitrine']);
    // Geprüft wird `code`, nicht der Text: fachfehler() legt die deutsche
    // Fassung in `message` und den Code daneben (src/infra/fehlerTexte.ts). Auf
    // den Text zu prüfen hiesse, die Regel an eine Übersetzung zu hängen.
    await assert.rejects(
      () => L.loescheOrt(U.ich, parseInt(ort.id, 10)),
      e => e?.code === 'lagerort_in_benutzung',
      'Der Ort liess sich löschen, obwohl eine Figur darin liegt.',
    );
  });

  await t.test('8. Umbenennen nimmt die Figuren mit', async () => {
    const ort = await db.get('SELECT id FROM storage_locations WHERE user_id=$1 AND name=$2', [U.ich, 'Vitrine']);
    await L.benenneOrtUm(U.ich, parseInt(ort.id, 10), 'Vitrine Wohnzimmer');
    const figurOrt = await ortVon(db, 'minifigs', 't.user_id=$1 AND t.fig_number=$2', [U.ich, 'sw0001']);
    assert.equal(figurOrt, 'Vitrine Wohnzimmer', 'Der Vorrat wurde umbenannt, die Figur zeigt auf den alten Namen.');
  });

  await db.pool.end().catch(() => {});
});
