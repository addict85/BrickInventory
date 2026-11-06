/**
 * Der VORRAT an Lagerorten — gegen eine echte Datenbank.
 * Ausführlich: docs/begruendungen/test/lagerort-vorrat-db.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { haeltSet } = require('./helpers/bestand');
const db = _req('db/database.js');

const U = {};

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); }
  finally { client.release(); }
  for (const name of ['opa', 'enkel']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
}

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Lagerort-Vorrat gegen echte Datenbank', { concurrency: 1 }, async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }
  await seed();
  const L = _req('src/bestand/lagerort.js');

  await t.test('anlegen, und dasselbe zweimal anlegen ist kein zweiter Eintrag', async () => {
    const a = await L.legeOrtAn(U.opa, 'Regal A');
    assert.equal(a.war_neu, true);
    assert.equal(a.ort.name, 'Regal A');

    // Gross-/Kleinschreibung entscheidet NICHT: „Regal A" und „regal a" sind
    // dasselbe Regal. Zwei Einträge dafür wären eine Falle in der
    // Auswahlliste, nicht eine Wahlmöglichkeit.
    const b = await L.legeOrtAn(U.opa, 'regal a');
    assert.equal(b.war_neu, false, '„regal a" wurde als zweiter Ort angelegt');
    assert.equal(b.ort.id, a.ort.id);
    // Und der ursprüngliche Name bleibt stehen — die erste Schreibweise gewinnt.
    assert.equal(b.ort.name, 'Regal A');
  });

  await t.test('leer und zu lang werden abgelehnt, nicht zurechtgebogen', async () => {
    for (const roh of ['', '   ', null, undefined]) {
      await assert.rejects(() => L.legeOrtAn(U.opa, roh),
        e => String(e.code) === 'lagerort_leer', `${JSON.stringify(roh)} wurde angenommen`);
    }
    await assert.rejects(() => L.legeOrtAn(U.opa, 'x'.repeat(61)),
      e => String(e.code) === 'lagerort_zu_lang');
    // Genau auf der Grenze ist erlaubt — sonst wäre die Zahl in der
    // Fehlermeldung („höchstens 60") gelogen.
    const rand = await L.legeOrtAn(U.opa, 'y'.repeat(60));
    assert.equal(rand.war_neu, true);
    await db.run('DELETE FROM storage_locations WHERE id = $1', [rand.ort.id]);
  });

  await t.test('jedes Konto hat seinen eigenen Vorrat', async () => {
    // Ein Lagerort ist ein Regal in einer Wohnung. Der Grossvater hat andere
    // Regale als der Enkel, auch wenn er dessen Sets sehen darf.
    await L.legeOrtAn(U.enkel, 'Kinderzimmer');
    assert.deepEqual((await L.orteVon([U.opa])).map(o => o.name), ['Regal A']);
    assert.deepEqual((await L.orteVon([U.enkel])).map(o => o.name), ['Kinderzimmer']);
    // Und der Grossvater kann beide Listen zusammen abfragen — genau das tut
    // das Auswahlfeld bei einem Set, das beiden gehört.
    assert.deepEqual((await L.orteVon([U.opa, U.enkel])).map(o => o.name),
      ['Kinderzimmer', 'Regal A'], 'sortiert ohne Rücksicht auf Gross-/Kleinschreibung');
  });

  await t.test('ein neuer Ort am SET landet im Vorrat', async () => {
    // Marcos „man kann auch gleich neue Auswahlwerte erfassen". Ohne das
    // stünde der Ort am Set, fehlte aber in der Liste, aus der er beim
    // nächsten Mal gewählt werden soll.
    await haeltSet(db, U.enkel, '10179-1', 1);
    assert.equal(await L.setzeLagerort('set', [U.enkel], ['10179-1'], 'Unterm Bett'), 1);
    assert.ok((await L.orteVon([U.enkel])).some(o => o.name === 'Unterm Bett'),
      'Der frisch getippte Ort fehlt im Vorrat');
  });

  await t.test('ein Ort, der keine Zeile trifft, hinterlässt keinen Eintrag', async () => {
    // Kein Schreibrecht, falsche Setnummer: Dann soll auch nichts im Vorrat
    // stehen bleiben. Sonst sammelte die Liste Namen aus Fehlversuchen.
    const vorher = (await L.orteVon([U.opa])).length;
    assert.equal(await L.setzeLagerort('set', [U.opa], ['99999-1'], 'Geisterkiste'), 0);
    assert.equal((await L.orteVon([U.opa])).length, vorher,
      'Ein Fehlversuch hat einen Ort im Vorrat hinterlassen');
  });

  await t.test('Umbenennen nimmt die Zuordnungen mit', async () => {
    const ort = (await L.orteVon([U.enkel])).find(o => o.name === 'Unterm Bett');
    await L.benenneOrtUm(U.enkel, ort.id, 'Kiste 3');
    // Die Aussage ist dieselbe wie vorher, der Weg dahin ein anderer: Bis
    // Migration 0031 schrieb benenneOrtUm() den neuen Namen in drei Tabellen
    // nach, und genau das konnte eine Schreibweise verfehlen. Jetzt traegt die
    // Zeile eine ID, es gibt nichts nachzuschreiben — die Pruefung bleibt
    // trotzdem stehen, weil sie das ERGEBNIS prueft und nicht den Weg.
    const amSet = await db.get(
      `SELECT l.name AS storage FROM sets t
         LEFT JOIN storage_locations l ON l.id = t.storage_id
        WHERE t.set_number = $1`, ['10179-1']);
    assert.equal(amSet.storage,
      'Kiste 3', 'Das Set steht noch im alten Ort — das Umbenennen war ein Verlieren');
    assert.ok((await L.orteVon([U.enkel])).some(o => o.name === 'Kiste 3'));
  });

  await t.test('Umbenennen auf einen belegten Namen wird abgelehnt', async () => {
    const ort = (await L.orteVon([U.enkel])).find(o => o.name === 'Kiste 3');
    await assert.rejects(() => L.benenneOrtUm(U.enkel, ort.id, 'kinderzimmer'),
      e => String(e.code) === 'lagerort_doppelt',
      'Zwei Orte mit demselben Namen wären eine Falle in der Auswahlliste');
    // Der eigene Name auf sich selbst ist dagegen in Ordnung — sonst liesse
    // sich „Kiste 3" nicht zu „KISTE 3" korrigieren.
    await L.benenneOrtUm(U.enkel, ort.id, 'KISTE 3');
    assert.ok((await L.orteVon([U.enkel])).some(o => o.name === 'KISTE 3'));
  });

  await t.test('ein fremdes Konto kann nichts umbenennen', async () => {
    const ort = (await L.orteVon([U.enkel])).find(o => o.name === 'KISTE 3');
    await assert.rejects(() => L.benenneOrtUm(U.opa, ort.id, 'Opas Keller'),
      e => String(e.code) === 'lagerort_unbekannt');
    await assert.rejects(() => L.loescheOrt(U.opa, ort.id),
      e => String(e.code) === 'lagerort_unbekannt');
  });

  await t.test('Löschen geht nur bei einem leeren Ort', async () => {
    const belegt = (await L.orteVon([U.enkel])).find(o => o.name === 'KISTE 3');
    await assert.rejects(() => L.loescheOrt(U.enkel, belegt.id),
      e => String(e.code) === 'lagerort_in_benutzung',
      'Ein belegter Ort liess sich löschen — die Zuordnung wäre ohne Weg zurück weg');

    const leer = (await L.orteVon([U.enkel])).find(o => o.name === 'Kinderzimmer');
    await L.loescheOrt(U.enkel, leer.id);
    assert.ok(!(await L.orteVon([U.enkel])).some(o => o.name === 'Kinderzimmer'));

    // Und nach dem Ausräumen geht auch der belegte.
    await db.run('UPDATE sets SET storage_id = NULL WHERE set_number = $1', ['10179-1']);
    await L.loescheOrt(U.enkel, belegt.id);
    assert.deepEqual(await L.orteVon([U.enkel]), []);
  });

  await t.test('eine Zuordnung ohne Ort im Vorrat ist nicht mehr moeglich', async () => {
    // Was hier vorher stand, und warum es weg ist
    // Ausführlich: docs/begruendungen/test/lagerort-vorrat-db.test.js.md#frei
    const frei = (await db.get(
      'SELECT COALESCE(MAX(id),0) + 1000 AS frei FROM storage_locations')).frei;
    await assert.rejects(
      () => db.run('UPDATE sets SET storage_id = $1 WHERE set_number = $2',
                   [frei, '10179-1']),
      (e) => /foreign key|verletzt|violates/i.test(String(e?.message || e)),
      'Ein Set liess sich auf einen Ort setzen, den es im Vorrat nicht gibt');
  });

  await db.pool.end().catch(() => {});
});
