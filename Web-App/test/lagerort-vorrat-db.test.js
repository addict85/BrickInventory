/**
 * Der VORRAT an Lagerorten — gegen eine echte Datenbank.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * „Der Lagerort soll ein Auswahlfeld mit einem Dropdown sein, bei dem man auch
 * gleich neue Auswahlwerte erfassen kann. Die Werte sollen pro User verwaltet
 * werden können und sollen in den Einstellungen bearbeitbar sein. Der
 * Grossvater soll die Werte der Enkel für die entsprechenden Sets sehen und
 * wählen können."
 *
 * ── Warum mit DB ────────────────────────────────────────────────────────────
 *
 * Drei Aussagen dieser Änderung sind Aussagen über DATEN und lassen sich am
 * Quelltext nicht prüfen:
 *
 *   1. Umbenennen schreibt die Zuordnungen mit um. Bliebe sie stehen, stünden
 *      die Sets danach in einem Ort, den die Auswahlliste nicht mehr kennt —
 *      ein Umbenennen wäre in Wahrheit ein Verlieren.
 *   2. Löschen ist eine ABSAGE, solange etwas darin liegt.
 *   3. „Regal A" und „regal a" sind dasselbe Regal.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

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
  const L = _req('utils/lagerort.js');

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
    await db.run(`INSERT INTO sets (user_id, set_number, name, quantity)
                  VALUES ($1,'10179-1','Falcon',1)`, [U.enkel]);
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
    assert.equal((await db.get('SELECT storage FROM sets WHERE set_number=$1', ['10179-1'])).storage,
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
    await db.run('UPDATE sets SET storage = NULL WHERE set_number = $1', ['10179-1']);
    await L.loescheOrt(U.enkel, belegt.id);
    assert.deepEqual(await L.orteVon([U.enkel]), []);
  });

  await t.test('die Migration übernimmt bereits benutzte Orte', async () => {
    // Ohne diesen Schritt wäre die Auswahlliste nach der Migration LEER,
    // während in den Sets weiter Orte stehen — die Oberfläche zeigte dann
    // einen Wert an, den sie selbst nicht zur Wahl stellt.
    await db.run('DELETE FROM storage_locations', []);
    await db.run('UPDATE sets SET storage = $1 WHERE set_number = $2', ['Dachboden', '10179-1']);
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, quantity, storage)
                  VALUES ($1,'3001',5,2,'dachboden')`, [U.enkel]);

    const sql = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'db', 'migrations', '0020-lagerorte-verwaltet.sql'), 'utf8');
    // Nur der Übernahme-Teil: Tabelle und Index stehen schon.
    await db.run(sql.slice(sql.indexOf('INSERT INTO storage_locations')));

    const orte = await L.orteVon([U.enkel]);
    assert.equal(orte.length, 1,
      `„Dachboden" und „dachboden" ergaben ${orte.length} Einträge: ${orte.map(o => o.name)}`);
  });

  await db.pool.end().catch(() => {});
});
