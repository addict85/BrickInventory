/**
 * Die Merkliste zeigt den Marktpreis — und zwar den des richtigen Zustands.
 *
 * ── Marcos Vorgabe vom 24.09. ───────────────────────────────────────────────
 *
 *   „Bitte in der Tabelle der Merkliste der Button In die Galerie aufnehme
 *    entfernen und dafuer den Marktpreis anzeigen. Dies ebenfalls in der
 *    Android und Webapp Umsetzen."
 *
 * ── Warum aus dem Cache und nicht frisch geholt ─────────────────────────────
 *
 * Ein Abruf je Zeile wären bei zwei Dutzend Merkposten ein Dutzend
 * BrickLink-Anfragen beim Öffnen des Reiters, und die Liste wartete darauf.
 * jobs/priceJob.ts frischt die Preise der Merkposten ohnehin täglich auf — die
 * Begründung steht dort ausdrücklich. Ein LEFT JOIN kostet nichts.
 *
 * ── Warum gegen eine echte Datenbank ────────────────────────────────────────
 *
 * Die eigentliche Aussage ist „der Preis gehört zum ZUSTAND dieser Zeile".
 * Ohne die Bedingung stünde beim gebrauchten Merkposten der Neupreis — und das
 * sieht man keiner Quelltextzeile an, nur dem Ergebnis.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Zustandsbedingung im JOIN entfernt → Schritte 2 und 5 rot.
 *   b) Währungsbedingung im JOIN entfernt → alle fünf rot (die Zeile findet
 *      dann drei Preiszeilen statt einer und vervielfacht das Ergebnis).
 *   c) Number() weggelassen → BLIEB GRÜN. Das ist kein Mangel des Tests,
 *      sondern eine Messung: db/database.ts:63 setzt einen Typ-Leser, der
 *      NUMERIC schon als Zahl liefert. Die Umwandlung ist damit ein Netz und
 *      keine Umrechnung — der Kommentar an der Stelle sagt das jetzt auch.
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

  // Zwei Merkposten auf DASSELBE Set, in beiden Zuständen — daran hängt die
  // wichtigste Aussage.
  for (const c of ['N', 'U']) {
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'10179-1',$2)`,
      [U.ich, c]);
  }
  await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'75192-1','N')`,
    [U.ich]);

  // Preise: neu 500, gebraucht 300 — und in einer ANDEREN Währung ein
  // abweichender Wert, damit ein fehlender Währungsvergleich auffällt.
  for (const [c, p, w] of [['N', 500, 'EUR'], ['U', 300, 'EUR'], ['N', 999, 'CHF']]) {
    await db.run(
      `INSERT INTO price_cache (set_number, condition, currency_code, avg_price)
       VALUES ('10179-1',$1,$2,$3)`, [c, w, p]);
  }
  // 75192-1 bleibt ohne Preis — „noch keiner im Cache" ist ein gültiger Fall.
}

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Merkliste: Marktpreis aus dem Cache', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }
  await seed();
  const M = _req('utils/merkliste.js');

  await t.test('1. Der Preis kommt als Zahl an', async () => {
    // Dass er das tut, liegt am Typ-Leser in db/database.ts (NACHGEMESSEN,
    // siehe Gegenprobe c) — nicht am Number() in merkliste.ts. Die Prüfung
    // steht trotzdem hier: Fiele der Leser weg, verglichen beide Oberflächen
    // später Text, und das fiele sonst erst beim Sortieren auf.
    const liste = await M.merkpostenVon([U.ich], undefined, 'EUR');
    const neu = liste.find(w => w.set_number === '10179-1' && w.condition === 'N');
    assert.equal(typeof neu.marktpreis, 'number', `marktpreis ist ${typeof neu.marktpreis}`);
    assert.equal(neu.marktpreis, 500);
    assert.equal(neu.waehrung, 'EUR');
  });

  await t.test('2. Jeder Zustand bekommt SEINEN Preis', async () => {
    // Ohne die Zustandsbedingung im JOIN stünde beim gebrauchten Merkposten
    // der Neupreis — und niemand sähe es der Zahl an.
    const liste = await M.merkpostenVon([U.ich], undefined, 'EUR');
    const karte = Object.fromEntries(
      liste.filter(w => w.set_number === '10179-1').map(w => [w.condition, w.marktpreis]));
    assert.deepEqual(karte, { N: 500, U: 300 },
      'Der gebrauchte Merkposten zeigt nicht den Gebrauchtpreis.');
  });

  await t.test('3. Die Währung des Lesers entscheidet', async () => {
    const chf = await M.merkpostenVon([U.ich], undefined, 'CHF');
    const neu = chf.find(w => w.set_number === '10179-1' && w.condition === 'N');
    assert.equal(neu.marktpreis, 999, 'Der Preis stammt aus der falschen Währung.');
    assert.equal(neu.waehrung, 'CHF');
  });

  await t.test('4. Kein Preis im Cache heisst null, nicht 0', async () => {
    // 0 wäre „wertlos", null ist „noch keiner da" — die Oberflächen zeigen
    // dafür einen Strich. Der Unterschied ist der zwischen einer Aussage und
    // einer fehlenden Aussage.
    const liste = await M.merkpostenVon([U.ich], undefined, 'EUR');
    const ohne = liste.find(w => w.set_number === '75192-1');
    assert.equal(ohne.marktpreis, null);
  });

  await t.test('5. Der Filter auf EIN Set funktioniert weiter', async () => {
    // Die Währung ist ein zusätzlicher Parameter geworden; ihre Nummer hängt
    // davon ab, ob der Set-Filter gesetzt ist. Genau dort entstünde ein
    // Zahlendreher, und er wäre still: Postgres bekäme die Währung als
    // Setnummer und liefe leer.
    const eins = await M.merkpostenVon([U.ich], '10179-1', 'EUR');
    assert.equal(eins.length, 2, `${eins.length} Zeilen statt 2 — Parameterfolge verrutscht?`);
    assert.ok(eins.every(w => w.set_number === '10179-1'));
    assert.equal(eins.find(w => w.condition === 'U').marktpreis, 300);
  });

  await db.pool.end().catch(() => {});
});
