/**
 * Lagerort gegen eine echte Datenbank.
 *
 * ── Warum mit DB ────────────────────────────────────────────────────────────
 *
 * Der Kern sind zwei Dinge, die sich am Quelltext nicht beweisen lassen: dass
 * das Setzen ALLE Zeilen eines Teils trifft (dasselbe Teil steckt in mehreren
 * Sets) und dass die Übersicht Sets und Teile zu EINER Liste zusammenführt.
 * Beides sind Aussagen über Zeilen, nicht über Zeichen.
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

  for (const name of ['ich', 'kind', 'fremd']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)',
    [U.ich, U.kind]);

  // Dasselbe Teil in ZWEI Sets — daran hängt die wichtigste Aussage.
  for (const [uid, sn] of [[U.ich, '10179-1'], [U.ich, '75192-1'], [U.kind, '21318-1'],
                           [U.fremd, '10030-1']]) {
    await db.run(`INSERT INTO sets (user_id, set_number, name, quantity) VALUES ($1,$2,$3,1)`,
      [uid, sn, 'Set ' + sn]);
  }
  for (const [uid, sn, num, farbe] of [
    [U.ich, '10179-1', '3001', 4], [U.ich, '75192-1', '3001', 4],
    // DASSELBE Teil in einer anderen Farbe. Ohne diese Zeile blieb die
    // Gegenprobe „Farbbedingung wirkungslos" grün: In der Saat gab es 3001
    // nur in einer Farbe, also konnte kein Farbfehler etwas treffen.
    [U.ich, '10179-1', '3001', 5],
    [U.ich, '10179-1', '3002', 4], [U.fremd, '10030-1', '3001', 4],
  ]) {
    await db.run(
      `INSERT INTO parts (user_id, set_number, part_number, color_id, quantity, part_name)
       VALUES ($1,$2,$3,$4,1,$5)`, [uid, sn, num, farbe, 'Teil ' + num]);
  }
}

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Lagerort gegen echte Datenbank', async (t) => {
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
  const schreibbar = await household.writableIds(U.ich);

  await t.test('ein Teil liegt an EINEM Ort, nicht je Set an einem', async () => {
    // Dasselbe Teil steckt in zwei Sets und damit in zwei Zeilen. Träfe das
    // Setzen nur eine davon, müsste man denselben Ort je Set nachpflegen — und
    // die Übersicht zeigte das Teil in zwei Kisten, von denen eine leer ist.
    const n = await L.setzeLagerort('part', schreibbar, ['3001', '4'], 'Kiste 3');
    assert.equal(n, 2, `${n} Zeilen getroffen, erwartet 2 (beide Sets)`);
    const rows = await db.all(
      `SELECT color_id, storage FROM parts
        WHERE user_id=$1 AND part_number=$2 ORDER BY color_id`, [U.ich, '3001']);
    assert.deepEqual(rows.map(r => [parseInt(r.color_id), r.storage]),
      [[4, 'Kiste 3'], [4, 'Kiste 3'], [5, null]],
      'Beide Zeilen der Farbe 4 müssen den Ort haben — und die Farbe 5 keinen');
  });

  await t.test('das Setzen bleibt im Schreibbereich', async () => {
    // Ohne diese Grenze wäre der Lagerort ein Weg, in fremden Daten zu
    // schreiben — und zwar unauffällig, weil sich sonst nichts ändert.
    const vorher = (await db.get(
      'SELECT storage FROM parts WHERE user_id=$1', [U.fremd]))?.storage ?? null;
    await L.setzeLagerort('part', schreibbar, ['3001', '4'], 'Kiste 9');
    const nachher = (await db.get(
      'SELECT storage FROM parts WHERE user_id=$1', [U.fremd]))?.storage ?? null;
    assert.equal(nachher, vorher, 'Eine fremde Zeile wurde verändert');

    // Zurücksetzen: Dieselben Zeilen zählt die Übersicht weiter unten. Ohne
    // das stand dort „Kiste 9" statt „Kiste 3" — der erste Entwurf dieser
    // Datei ist genau darüber gestolpert, und zwar erst zwei Prüfungen
    // später. Ein Test, der seinen Aufbau verändert, ist ein Aufbau für alle
    // folgenden.
    await L.setzeLagerort('part', schreibbar, ['3001', '4'], 'Kiste 3');
  });

  await t.test('leer heisst NULL, nicht ein Ort namens „nichts"', async () => {
    // Ein leerer Text stünde als eigener Eintrag in jeder Auswahlliste.
    for (const eingabe of ['', '   ', null, undefined]) {
      assert.equal(L.normalisiereLagerort(eingabe), null, `„${eingabe}" wurde nicht zu null`);
    }
    assert.equal(L.normalisiereLagerort('  Kiste 3  '), 'Kiste 3', 'Nicht getrimmt');

    await L.setzeLagerort('part', schreibbar, ['3002', '4'], 'Regal B');
    await L.setzeLagerort('part', schreibbar, ['3002', '4'], null);
    const r = await db.get(
      'SELECT storage FROM parts WHERE user_id=$1 AND part_number=$2', [U.ich, '3002']);
    assert.equal(r.storage, null, 'Das Leeren hat den Ort nicht entfernt');
  });

  await t.test('zu lange Namen werden abgelehnt, nicht abgeschnitten', async () => {
    // Abschneiden hiesse: In der Datenbank steht etwas anderes als eingegeben,
    // und niemand erfährt es.
    assert.throws(() => L.normalisiereLagerort('x'.repeat(L.LAGERORT_MAX_ZEICHEN + 1)),
      /lagerort_zu_lang|zu lang/i);
    assert.equal(L.normalisiereLagerort('x'.repeat(L.LAGERORT_MAX_ZEICHEN)).length,
      L.LAGERORT_MAX_ZEICHEN, 'Die Grenze selbst muss noch durchgehen');
  });

  await t.test('die Übersicht führt Sets und Teile zu EINER Liste zusammen', async () => {
    await L.setzeLagerort('set', schreibbar, ['10179-1'], 'Kiste 3');
    await L.setzeLagerort('set', schreibbar, ['75192-1'], 'Regal B');

    const orte = await L.lagerorte(await household.scopeIds(U.ich, 'all'));
    const karte = Object.fromEntries(orte.map(o => [o.ort, o]));
    // „Kiste 3" hat ein Set UND zwei Teilezeilen — ein Ort, nicht zwei
    // Einträge. Zwei getrennte Listen zu liefern hiesse, dass jede Oberfläche
    // sie selbst zusammenführt, und zwar jede für sich.
    assert.deepEqual(karte['Kiste 3'], { ort: 'Kiste 3', sets: 1, teile: 2 });
    assert.deepEqual(karte['Regal B'], { ort: 'Regal B', sets: 1, teile: 0 });
    // Alphabetisch — die Auswahlliste soll nicht bei jedem Aufruf anders sein.
    assert.deepEqual(orte.map(o => o.ort), [...orte.map(o => o.ort)].sort());
    // Und nichts Fremdes.
    assert.ok(!orte.some(o => o.ort === 'Kiste 9'), 'Ein fremder Ort ist aufgetaucht');
  });

  await t.test('die Übersicht folgt dem Blickfeld', async () => {
    await L.setzeLagerort('set', await household.writableIds(U.kind), ['21318-1'], 'Kinderzimmer');
    const oben  = (await L.lagerorte(await household.scopeIds(U.ich,  'all'))).map(o => o.ort);
    const unten = (await L.lagerorte(await household.scopeIds(U.kind, 'all'))).map(o => o.ort);
    assert.ok(oben.includes('Kinderzimmer'), 'Das Hauptkonto sieht den Ort des Kindes nicht');
    assert.ok(!unten.includes('Kiste 3'),
      'Das Unterkonto sieht einen Ort des Hauptkontos — das Blickfeld geht nur nach unten');
  });

  await db.pool.end().catch(() => {});
});
