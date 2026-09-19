/**
 * „Kann ich das bauen?" — der Abgleich zwischen Teileliste und eigenem Bestand.
 *
 * ── Warum gegen eine echte Datenbank ────────────────────────────────────────
 *
 * Der Kern ist eine einzige Abfrage, und ihr heikler Teil ist der JOIN über
 * `unnest($2::text[], $3::int[])`: zwei parallele Felder, die Postgres Zeile
 * für Zeile paart. Verrutscht die Reihenfolge, paart er Teilenummern mit
 * fremden Farben — und liefert dabei nicht etwa einen Fehler, sondern
 * plausible Zahlen zu den falschen Teilen. Genau das sieht man nur, wenn
 * wirklich Zeilen in der Tabelle stehen.
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

  for (const name of ['ich', 'kind', 'fremd']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)',
    [U.ich, U.kind]);

  // Dieselbe Teilenummer in ZWEI Farben, und dieselbe Farbe bei ZWEI
  // Teilenummern: Nur so fällt eine verrutschte Paarung auf.
  const teile = [
    // user, nummer, farbe, menge, quelle, set
    [U.ich,   '3001', 4,  6, 'set',    '10179-1'],
    [U.ich,   '3001', 4,  2, 'manual', null],
    [U.ich,   '3001', 5,  3, 'manual', null],
    [U.ich,   '3002', 4, 10, 'set',    '10179-1'],
    [U.kind,  '3001', 4,  1, 'manual', null],
    [U.fremd, '3001', 4, 99, 'manual', null],
  ];
  for (const [uid, num, farbe, menge, quelle, set] of teile) {
    await db.run(
      `INSERT INTO parts (user_id, set_number, part_number, color_id, quantity, source, part_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uid, set, num, farbe, menge, quelle, 'Teil ' + num]);
  }
}

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Bestandsabgleich gegen echte Datenbank', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }
  await seed();
  const { getOwnedQuantities, BESTAND_MAX_TEILE } = _req('utils/handlers/parts.js');
  const household = _req('utils/household.js');

  await t.test('zählt je Teil UND Farbe, nicht je Teilenummer', async () => {
    const b = await getOwnedQuantities([U.ich], [
      { part_number: '3001', color_id: 4 },
      { part_number: '3001', color_id: 5 },
      { part_number: '3002', color_id: 4 },
    ]);
    // 6 aus dem Set + 2 lose = 8 gesamt, davon 2 lose.
    assert.deepEqual(b['3001|4'], { gesamt: 8, lose: 2 });
    // Dieselbe Nummer, andere Farbe — darf sich nicht vermischen.
    assert.deepEqual(b['3001|5'], { gesamt: 3, lose: 3 });
    // Andere Nummer, dieselbe Farbe — ebenso wenig.
    assert.deepEqual(b['3002|4'], { gesamt: 10, lose: 0 });
  });

  await t.test('„lose" schliesst aus, was in einem Set steckt', async () => {
    // Der eigentliche Punkt der zweiten Zahl: Ein Teil in einem aufgebauten
    // Set besitzt man zwar, müsste dafür aber ein anderes Set zerlegen.
    const b = await getOwnedQuantities([U.ich], [{ part_number: '3002', color_id: 4 }]);
    assert.equal(b['3002|4'].gesamt, 10);
    assert.equal(b['3002|4'].lose, 0, 'Ein Set-Teil darf nicht als lose gelten');
  });

  await t.test('was nicht da ist, fehlt in der Antwort', async () => {
    // Bewusst kein Eintrag mit 0 statt eines fehlenden: Die Oberfläche setzt
    // fehlende Schlüssel auf 0 und unterscheidet damit nicht — der Server
    // spart sich dafür eine Zeile je nicht vorhandenem Teil, und das sind bei
    // einem grossen Set die meisten.
    const b = await getOwnedQuantities([U.ich], [{ part_number: '9999', color_id: 0 }]);
    assert.equal(b['9999|0'], undefined);
  });

  await t.test('das Blickfeld entscheidet, nicht die Anfrage', async () => {
    // Ohne diese Grenze wäre der Abgleich ein Weg, fremde Bestände zu zählen.
    const nurIch  = await getOwnedQuantities([U.ich], [{ part_number: '3001', color_id: 4 }]);
    const mitKind = await getOwnedQuantities(
      await household.scopeIds(U.ich, 'all'), [{ part_number: '3001', color_id: 4 }]);
    assert.equal(nurIch['3001|4'].gesamt, 8);
    assert.equal(mitKind['3001|4'].gesamt, 9, 'Das Unterkonto muss mitzählen');
    // 99 Stück liegen bei 'fremd' — die dürfen nirgends auftauchen.
    assert.ok(mitKind['3001|4'].gesamt < 99, 'Ein fremder Bestand ist durchgeschlagen');
  });

  await t.test('doppelte Anfragen und leere Eingaben laufen nicht ins Leere', async () => {
    const b = await getOwnedQuantities([U.ich], [
      { part_number: '3001', color_id: 4 },
      { part_number: '3001', color_id: 4 },   // doppelt
      { part_number: '',     color_id: 4 },   // leer
      { part_number: '3001' },                // ohne Farbe → 0
    ]);
    assert.equal(b['3001|4'].gesamt, 8, 'Eine doppelte Anfrage darf nicht doppelt zählen');
    assert.deepEqual(await getOwnedQuantities([U.ich], []), {});
  });

  await t.test('die Anfrage ist gedeckelt', async () => {
    // Eine Teileliste über viele Sets darf keine unbegrenzte Abfrage bauen.
    // GEMESSEN: Der Deckel greift, die Antwort bleibt leer statt zu werfen.
    assert.equal(typeof BESTAND_MAX_TEILE, 'number');
    const viele = Array.from({ length: BESTAND_MAX_TEILE + 50 },
      (_, i) => ({ part_number: 'x' + i, color_id: 0 }));
    viele.push({ part_number: '3001', color_id: 4 });   // steht HINTER dem Deckel
    const b = await getOwnedQuantities([U.ich], viele);
    assert.deepEqual(b, {}, 'Alles hinter dem Deckel muss wegfallen — auch Vorhandenes');
  });

  await db.pool.end().catch(() => {});
});
