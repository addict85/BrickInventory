/**
 * Der VORRAT an Lagerorten — gegen eine echte Datenbank.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

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
  for (const name of ['grandparent', 'enkel']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('storage location stock against a real database', { concurrency: 1 }, async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }
  await seed();
  const L = {
    ..._req('src/inventory/storageLocation.js'),
    ...require('./helpers/sources').testArea('inventory').locationService,
  };

  await t.test('create, and creating the same twice is no second entry', async () => {
    const a = await L.putLocationAn(U.grandparent, 'Regal A');
    assert.equal(a.war_neu, true);
    assert.equal(a.ort.name, 'Regal A');

    // Gross-/Kleinschreibung entscheidet NICHT: „Regal A" und „regal a" sind
    // dasselbe Regal. Zwei Einträge dafür wären eine Falle in der
    // Auswahlliste, nicht eine Wahlmöglichkeit.
    const b = await L.putLocationAn(U.grandparent, 'regal a');
    assert.equal(b.war_neu, false, '„regal a" wurde als zweiter Ort angelegt');
    assert.equal(b.ort.id, a.ort.id);
    // Und der ursprüngliche Name bleibt stehen — die erste Schreibweise gewinnt.
    assert.equal(b.ort.name, 'Regal A');
  });

  await t.test('empty and too long are rejected, not bent into shape', async () => {
    for (const roh of ['', '   ', null, undefined]) {
      await assert.rejects(
        () => L.putLocationAn(U.grandparent, roh),
        (/** @type {any} */ e) => String(e.code) === 'lagerort_leer',
        `${JSON.stringify(roh)} wurde angenommen`,
      );
    }
    await assert.rejects(
      () => L.putLocationAn(U.grandparent, 'x'.repeat(61)),
      (/** @type {any} */ e) => String(e.code) === 'lagerort_zu_lang',
    );
    // Genau auf der Grenze ist erlaubt — sonst wäre die Zahl in der
    // Fehlermeldung („höchstens 60") gelogen.
    const rand = await L.putLocationAn(U.grandparent, 'y'.repeat(60));
    assert.equal(rand.war_neu, true);
    await db.run('DELETE FROM storage_locations WHERE id = $1', [rand.ort.id]);
  });

  await t.test('every account has its own stock', async () => {
    // Ein Lagerort ist ein Regal in einer Wohnung. Der Grossvater hat andere
    // Regale als der Enkel, auch wenn er dessen Sets sehen darf.
    await L.putLocationAn(U.enkel, 'Kinderzimmer');
    assert.deepEqual(
      (await L.locationsOf([U.grandparent])).map(o => o.name),
      ['Regal A'],
    );
    assert.deepEqual(
      (await L.locationsOf([U.enkel])).map(o => o.name),
      ['Kinderzimmer'],
    );
    // Und der Grossvater kann beide Listen zusammen abfragen — genau das tut
    // das Auswahlfeld bei einem Set, das beiden gehört.
    assert.deepEqual(
      (await L.locationsOf([U.grandparent, U.enkel])).map(o => o.name),
      ['Kinderzimmer', 'Regal A'],
      'sortiert ohne Rücksicht auf Gross-/Kleinschreibung',
    );
  });

  await t.test('a new place on the SET lands in the stock', async () => {
    // Marcos „man kann auch gleich neue Auswahlwerte erfassen". Ohne das
    // stünde der Ort am Set, fehlte aber in der Liste, aus der er beim
    // nächsten Mal gewählt werden soll.
    await holdsSet(db, U.enkel, '10179-1', 1);
    assert.equal(await L.setLocation('set', [U.enkel], ['10179-1'], 'Unterm Bett'), 1);
    assert.ok(
      (await L.locationsOf([U.enkel])).some(o => o.name === 'Unterm Bett'),
      'Der frisch getippte Ort fehlt im Vorrat',
    );
  });

  await t.test('a place that hits no row leaves no entry', async () => {
    // Kein Schreibrecht, falsche Setnummer: Dann soll auch nichts im Vorrat
    // stehen bleiben. Sonst sammelte die Liste Namen aus Fehlversuchen.
    const vorher = (await L.locationsOf([U.grandparent])).length;
    assert.equal(await L.setLocation('set', [U.grandparent], ['99999-1'], 'Geisterkiste'), 0);
    assert.equal(
      (await L.locationsOf([U.grandparent])).length,
      vorher,
      'Ein Fehlversuch hat einen Ort im Vorrat hinterlassen',
    );
  });

  await t.test('renaming takes the assignments along', async () => {
    const ort = (await L.locationsOf([U.enkel])).find(o => o.name === 'Unterm Bett');
    await L.benenneOrtUm(U.enkel, ort.id, 'Kiste 3');
    // Die Aussage ist dieselbe wie vorher, der Weg dahin ein anderer: Bis
    // Migration 0031 schrieb benenneOrtUm() den neuen Namen in drei Tabellen
    // nach, und genau das konnte eine Schreibweise verfehlen. Jetzt traegt die
    // Zeile eine ID, es gibt nichts nachzuschreiben — die Pruefung bleibt
    // trotzdem stehen, weil sie das ERGEBNIS prueft und nicht den Weg.
    const amSet = await db.get(
      `SELECT l.name AS storage FROM sets t
         LEFT JOIN storage_locations l ON l.id = t.storage_id
        WHERE t.set_number = $1`,
      ['10179-1'],
    );
    assert.equal(amSet.storage, 'Kiste 3', 'Das Set steht noch im alten Ort — das Umbenennen war ein Verlieren');
    assert.ok((await L.locationsOf([U.enkel])).some(o => o.name === 'Kiste 3'));
  });

  await t.test('renaming to a taken name is rejected', async () => {
    const ort = (await L.locationsOf([U.enkel])).find(o => o.name === 'Kiste 3');
    await assert.rejects(
      () => L.benenneOrtUm(U.enkel, ort.id, 'kinderzimmer'),
      (/** @type {any} */ e) => String(e.code) === 'lagerort_doppelt',
      'Zwei Orte mit demselben Namen wären eine Falle in der Auswahlliste',
    );
    // Der eigene Name auf sich selbst ist dagegen in Ordnung — sonst liesse
    // sich „Kiste 3" nicht zu „KISTE 3" korrigieren.
    await L.benenneOrtUm(U.enkel, ort.id, 'KISTE 3');
    assert.ok((await L.locationsOf([U.enkel])).some(o => o.name === 'KISTE 3'));
  });

  await t.test('a foreign account cannot rename anything', async () => {
    const ort = (await L.locationsOf([U.enkel])).find(o => o.name === 'KISTE 3');
    await assert.rejects(
      () => L.benenneOrtUm(U.grandparent, ort.id, 'Opas Keller'),
      (/** @type {any} */ e) => String(e.code) === 'lagerort_unbekannt',
    );
    await assert.rejects(
      () => L.loescheOrt(U.grandparent, ort.id),
      (/** @type {any} */ e) => String(e.code) === 'lagerort_unbekannt',
    );
  });

  await t.test('deleting only works for an empty place', async () => {
    const belegt = (await L.locationsOf([U.enkel])).find(o => o.name === 'KISTE 3');
    await assert.rejects(
      () => L.loescheOrt(U.enkel, belegt.id),
      (/** @type {any} */ e) => String(e.code) === 'lagerort_in_benutzung',
      'Ein belegter Ort liess sich löschen — die Zuordnung wäre ohne Weg zurück weg',
    );

    const leer = (await L.locationsOf([U.enkel])).find(o => o.name === 'Kinderzimmer');
    await L.loescheOrt(U.enkel, leer.id);
    assert.ok(!(await L.locationsOf([U.enkel])).some(o => o.name === 'Kinderzimmer'));

    // Und nach dem Ausräumen geht auch der belegte.
    await db.run('UPDATE sets SET storage_id = NULL WHERE set_number = $1', ['10179-1']);
    await L.loescheOrt(U.enkel, belegt.id);
    assert.deepEqual(await L.locationsOf([U.enkel]), []);
  });

  await t.test('an assignment without a place in the stock is no longer possible', async () => {
    // Was hier vorher stand, und warum es weg ist
    const frei = (await db.get('SELECT COALESCE(MAX(id),0) + 1000 AS frei FROM storage_locations')).frei;
    await assert.rejects(
      () => db.run('UPDATE sets SET storage_id = $1 WHERE set_number = $2', [frei, '10179-1']),
      (/** @type {any} */ e) => /foreign key|verletzt|violates/i.test(String(e?.message || e)),
      'Ein Set liess sich auf einen Ort setzen, den es im Vorrat nicht gibt',
    );
  });

  await db.pool.end().catch(() => {});
});
