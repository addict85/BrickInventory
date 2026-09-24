/**
 * Der Filter der Merkliste — Suche, Zustand, Sortierung und Inhaber.
 *
 * ── Marcos Vorgabe vom 24.09. ───────────────────────────────────────────────
 *
 *   „In der Merkliste noch einen Filter analog den Sets einbauen inkl.
 *    Inhaber."
 *
 * ── Warum gegen eine echte Datenbank ────────────────────────────────────────
 *
 * Weil die Aussagen alle vier in SQL stehen und keiner davon man am Quelltext
 * ansieht, ob sie stimmt: ob die Suche den NAMEN aus rb_sets mittrifft (die
 * Merkliste hält keine Kopie der Stammdaten, siehe Migration 0021), ob die
 * Parameternummern nach dem Einbau dreier neuer Parameter noch zueinander
 * passen, ob NULLS LAST greift und ob die Maskierung in LIKE wirkt.
 *
 * Der Zahlendreher ist dabei die reale Gefahr: merkpostenVon() zählt seine
 * Platzhalter beim Bauen hoch, und die Währung steht ganz am Ende. Verrutscht
 * die Reihenfolge, bekäme Postgres die Währung als Setnummer — und liefe
 * still leer statt zu scheitern.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) `OR rb.name ILIKE` aus der Suche entfernt   → Schritt 2 rot.
 *   b) Die Maskierung der Eingabe weggelassen      → Schritt 3 rot.
 *      (Beim ersten Versuch BLIEB ES GRÜN — der Bestand enthielt nichts, das
 *      der ungeschützte Platzhalter zusätzlich getroffen hätte. Der Seed hat
 *      deshalb ein zweites Set bekommen; das ist ein Befund über die Prüfung,
 *      kein Formfehler.)
 *   c) Zustandsbedingung entfernt                  → Schritt 4 rot.
 *   d) NULLS LAST bei price_desc gestrichen        → Schritt 5 rot.
 *      (Bei name_asc gestrichen: BLIEB GRÜN — bei ASC ist NULLS LAST die
 *      Vorgabe von Postgres. Gemessen, nicht vermutet; der Schritt sagt es.)
 *   e) ausTabelle() durch MERK_SORTS[x] ersetzt    → Schritt 7 rot.
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

  for (const n of ['opa', 'enkel']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [n]);
    U[n] = (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  }

  // Drei Sets im Katalog — zwei mit Namen, eines OHNE. Das dritte ist kein
  // Beiwerk: Ein Merkposten auf ein Set, das rb_sets nicht kennt, ist der
  // Regelfall bei neuen Sets, und er entscheidet über NULLS LAST.
  for (const [num, name, jahr] of [
    ['10179-1', 'Millennium Falcon', 2007],
    ['75192-1', 'UCS Millennium Falcon', 2017],
  ]) {
    await db.run(`INSERT INTO rb_sets (set_num, name, year) VALUES ($1,$2,$3)`, [num, name, jahr]);
  }

  // Zwei Namen, an denen die Maskierung hängt: einer MIT Prozentzeichen und
  // einer, der nur „50" enthält. Ohne das zweite Set wäre der Schritt unten
  // wirkungslos — die Gegenprobe hat genau das gezeigt: Maskierung entfernt,
  // Prüfung blieb grün, weil „%50%%" im damaligen Bestand nichts anderes traf
  // als „50%". Eine Prüfung, die nur den einen Fall kennt, unterscheidet ihn
  // nicht vom anderen.
  await db.run(`INSERT INTO rb_sets (set_num, name, year) VALUES ('60000-1','Sale 50% Feuerwehr',2013)`);
  await db.run(`INSERT INTO rb_sets (set_num, name, year) VALUES ('60001-1','Feuerwehr 5000er',2014)`);

  const posten = [
    [U.opa,   '10179-1', 'N'],
    [U.opa,   '10179-1', 'U'],
    [U.opa,   '60000-1', 'N'],
    [U.opa,   '60001-1', 'N'],
    [U.opa,   '99999-1', 'N'],   // kein Katalogeintrag: Name und Jahr NULL
    [U.enkel, '75192-1', 'N'],
  ];
  // created_at absteigend gestaffelt, damit die Vorgabesortierung eine
  // bestimmte Reihenfolge hat und nicht dem Zufall folgt.
  let tage = posten.length;
  for (const [uid, sn, c] of posten) {
    await db.run(
      `INSERT INTO wanted (user_id, set_number, condition, created_at)
       VALUES ($1,$2,$3, NOW() - ($4 || ' days')::interval)`, [uid, sn, c, tage--]);
  }

  // Preise nur für zwei Merkposten — der Rest hat keinen. Genau das prüft die
  // Preissortierung: Ein fehlender Preis gehört ans Ende, nicht an den Anfang.
  for (const [sn, c, p] of [['10179-1', 'N', 500], ['60000-1', 'N', 80]]) {
    await db.run(
      `INSERT INTO price_cache (set_number, condition, currency_code, avg_price)
       VALUES ($1,$2,'EUR',$3)`, [sn, c, p]);
  }
}

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

const nummern = (liste) => liste.map(w => `${w.set_number}/${w.condition}`);

test('Merkliste: Suche, Zustand, Sortierung, Inhaber', async (t) => {
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
  const alle = [U.opa, U.enkel];

  await t.test('1. Ohne Filter bleibt alles, wie es war', async () => {
    // Der Ausgangspunkt: Vier Parameter sind dazugekommen, und ein Aufruf ohne
    // sie muss weiterhin dieselbe Liste in derselben Reihenfolge liefern.
    const liste = await M.merkpostenVon(alle, undefined, 'EUR');
    assert.equal(liste.length, 6, `${liste.length} statt 6 Merkposten`);
    // Vorgabe added_desc: der zuletzt eingetragene zuerst.
    assert.equal(liste[0].set_number, '75192-1');
  });

  await t.test('2. Die Suche trifft Nummer UND Name', async () => {
    const perNummer = await M.merkpostenVon(alle, undefined, 'EUR', { suche: '75192' });
    assert.deepEqual(nummern(perNummer), ['75192-1/N']);

    // „Falcon" steht in keiner Setnummer — ohne den Namensvergleich käme hier
    // nichts zurück. Der Name kommt aus rb_sets, nicht aus wanted.
    const perName = await M.merkpostenVon(alle, undefined, 'EUR', { suche: 'falcon' });
    assert.deepEqual(nummern(perName).sort(), ['10179-1/N', '10179-1/U', '75192-1/N']);
  });

  await t.test('3. Ein Prozentzeichen sucht nach einem Prozentzeichen', async () => {
    // Ohne Maskierung wäre das '%' der LIKE-Platzhalter: Gesucht würde dann
    // nach „irgendwas, das 50 enthält" — und „Feuerwehr 5000er" käme mit.
    // Das ist nicht kaputt, aber es ist nicht, wonach gefragt wurde; für den
    // Suchenden sieht es aus, als wirke der Filter nicht.
    const liste = await M.merkpostenVon(alle, undefined, 'EUR', { suche: '50%' });
    assert.deepEqual(nummern(liste), ['60000-1/N'],
      `Die Maskierung greift nicht: ${nummern(liste).join(', ')}`);
    // Die Gegenprobe dazu: OHNE Prozentzeichen findet dieselbe Suche beide.
    const beide = await M.merkpostenVon(alle, undefined, 'EUR', { suche: '50' });
    assert.equal(beide.length, 2, `„50" findet ${beide.length} statt 2 — Seed veraltet?`);
  });

  await t.test('4. Der Zustand filtert, ein unbekannter Wert nicht', async () => {
    const gebraucht = await M.merkpostenVon(alle, undefined, 'EUR', { zustand: 'U' });
    assert.deepEqual(nummern(gebraucht), ['10179-1/U']);
    // Kleinschreibung soll genauso wirken — die Oberflächen schicken, was in
    // ihrem Auswahlfeld steht, und eine davon könnte 'u' schicken.
    assert.equal((await M.merkpostenVon(alle, undefined, 'EUR', { zustand: 'u' })).length, 1);
    // Ein unbekannter Wert heisst „beide" und nicht „keine": Eine leere Liste
    // sähe aus wie eine leere Merkliste.
    assert.equal((await M.merkpostenVon(alle, undefined, 'EUR', { zustand: 'X' })).length, 6);
  });

  await t.test('5. Sortierung: der fehlende Wert steht hinten', async () => {
    // 99999-1 hat keinen Namen (nicht im Katalog).
    //
    // ── Was die Gegenprobe hier GEMESSEN hat ─────────────────────────────
    //
    // Hier stand „ohne NULLS LAST stünde es bei name_asc ganz oben". Das ist
    // falsch: Bei ASC ist NULLS LAST die Vorgabe von Postgres — NULLS LAST aus
    // name_asc zu streichen ändert nichts, und diese Prüfung blieb grün.
    // Entscheidend ist es bei DESC, wo NULLS FIRST die Vorgabe ist: Genau dort
    // stünden die Merkposten OHNE Preis ganz oben. Die Angabe steht trotzdem
    // in allen Zeilen der Tabelle, damit sie sich gleich liest — aber die
    // Aussage dieses Schritts hängt an price_desc darunter.
    const nachName = await M.merkpostenVon(alle, undefined, 'EUR', { sortierung: 'name_asc' });
    assert.equal(nachName[nachName.length - 1].set_number, '99999-1',
      `Ohne Namen steht nicht hinten: ${nummern(nachName).join(', ')}`);
    assert.equal(nachName[0].name, 'Feuerwehr 5000er');

    const nachPreis = await M.merkpostenVon(alle, undefined, 'EUR', { sortierung: 'price_desc' });
    assert.equal(nachPreis[0].marktpreis, 500);
    assert.equal(nachPreis[1].marktpreis, 80);
    assert.equal(nachPreis[nachPreis.length - 1].marktpreis, null,
      'Ein Merkposten ohne Preis steht nicht am Ende.');

    const nachNummer = await M.merkpostenVon(alle, undefined, 'EUR', { sortierung: 'num_asc' });
    assert.equal(nachNummer[0].set_number, '10179-1');
  });

  await t.test('6. Der Inhaber ist das Blickfeld, kein eigener Parameter', async () => {
    // Genau so steht es in der Route: `accounts=` geht durch scopeIds() und
    // kommt als userIds herein. Eine zweite Stelle, die Konten auswählt, wäre
    // die Doppelung, vor der utils/household.ts warnt.
    const nurEnkel = await M.merkpostenVon([U.enkel], undefined, 'EUR');
    assert.deepEqual(nummern(nurEnkel), ['75192-1/N']);
    const nurOpa = await M.merkpostenVon([U.opa], undefined, 'EUR');
    assert.equal(nurOpa.length, 5);
  });

  await t.test('7. Eine erfundene Sortierung fällt auf die Vorgabe zurück', async () => {
    // ausTabelle() prüft mit hasOwnProperty. Mit `MERK_SORTS[x] || vorgabe`
    // wäre 'constructor' ein gültiger Wert gewesen — und was dann in ORDER BY
    // landet, ist keine Sortierung mehr, sondern eine Funktion als Text.
    for (const boese of ['constructor', 'toString', '__proto__', 'gibtsnicht']) {
      const liste = await M.merkpostenVon(alle, undefined, 'EUR', { sortierung: boese });
      assert.equal(liste.length, 6, `${boese} hat die Liste verändert`);
      assert.equal(liste[0].set_number, '75192-1', `${boese} hat die Reihenfolge verändert`);
    }
  });

  await t.test('8. Alle vier zusammen — die Parameterfolge bleibt heil', async () => {
    // Der eigentliche Grund für diesen Schritt: Die Platzhalter werden beim
    // Bauen hochgezählt, und die Währung hängt sich ganz am Ende an. Verrutscht
    // eine Nummer, bekäme Postgres die Währung als Setnummer und liefe still
    // leer — kein Fehler, nur eine leere Liste.
    const liste = await M.merkpostenVon([U.opa], undefined, 'EUR',
      { suche: 'falcon', zustand: 'N', sortierung: 'num_asc' });
    assert.deepEqual(nummern(liste), ['10179-1/N']);
    assert.equal(liste[0].marktpreis, 500, 'Die Währung ist beim Zählen verrutscht.');
  });

  await db.pool.end().catch(() => {});
});
