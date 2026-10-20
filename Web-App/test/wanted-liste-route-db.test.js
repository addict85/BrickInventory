/**
 * Der Wanted-Listen-Import über seine echte Adresse.
 *
 * ── Warum neben test/wanted-liste-db.test.js ────────────────────────────────
 *
 * Dort steht der Leser und die Abbildung. Hier läuft der WEG:
 * POST /api/v1/wanted-list/import/xml, mit echter Datenbank, und was danach
 * im Bestand steht. Diese Trennung ist in dieser Sitzung mehrfach teuer
 * geworden — ein Modul kann stimmen, während die Route es falsch ruft.
 *
 * ── Die Vorschau ist der wichtigste Fall ────────────────────────────────────
 *
 * Ohne `schreiben=1` darf NICHTS entstehen. Fall 2 prüft das an der Tabelle
 * und nicht an der Antwort: Eine Route, die „vorschau: true" meldet und
 * trotzdem schreibt, sähe in der Antwort richtig aus.
 *
 * ── Gegenproben (durchgeführt, Befunde GEMESSEN) ────────────────────────────
 *
 *   a) Vorschau nicht mehr Vorgabe (schreibt immer) → 2 UND 4 rot
 *   b) <INVENTORY>-Prüfung entfernt                 → 1 rot
 *   c) BL-Nummer roh übernommen statt abgebildet    → 4 rot
 *   d) BL-Farbe statt der abgebildeten genommen     → 4 rot
 *
 * Zwei Vorhersagen waren zu eng, und beide sagen etwas über diesen Test:
 *
 * Bei (a) hatte ich nur Fall 2 erwartet. Rot wurde auch 4, und zu Recht:
 * Schreibt die Vorschau, liegen beim späteren Schreiblauf schon Teile da, und
 * `angelegt` stimmt nicht mehr. Eine Kettenwirkung — Fall 2 ist der Befund,
 * Fall 4 die Folge.
 *
 * Bei (c) hatte ich 3 UND 4 erwartet. Rot wurde nur 4. Fall 3 zählt die
 * STUFEN, und die stimmen auch dann, wenn die falsche Nummer übernommen wird
 * — er prüft die Abbildung nicht. Das tut Fall 4, und nur er.
 *
 * Damit hängt an Fall 4 viel: Abbildung der Nummer, Abbildung der Farbe,
 * Menge, und dass der offene Posten draussen bleibt. Das ist bewusst so — die
 * vier Aussagen gehören zu EINEM Vorgang („was steht nach dem Schreiben im
 * Bestand"), und sie einzeln zu prüfen hiesse viermal denselben Import zu
 * fahren.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { testServer } = require('./helpers/server');

test.after(async () => { await db.pool.end().catch(() => {}); });

let HAUPT = 0;

function item(typ, id, farbe, menge = 1) {
  return `<ITEM>\n<ITEMTYPE>${typ}</ITEMTYPE>\n<ITEMID>${id}</ITEMID>\n`
       + (farbe === null ? '' : `<COLOR>${farbe}</COLOR>\n`)
       + `<MAXPRICE>-1.0000</MAXPRICE>\n<MINQTY>${menge}</MINQTY>\n`
       + `<CONDITION>X</CONDITION>\n<NOTIFY>N</NOTIFY>\n</ITEM>`;
}
const liste = (...i) => `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n${i.join('\n')}\n</INVENTORY>\n`;

/** Die Datei des Tests: zwei auflösbare Teile, eines offen. */
const XML = liste(
  item('P', '3001', 5, 3),     // bl_zuordnung: NULL-Vermerk → Stufe 2
  item('P', '4162', 1, 2),     // bl_zuordnung: abweichende Nummer → Stufe 1
  item('P', '99999', 5, 1),    // nichts → offen
);

async function hochladen(base, xml, abfrage = '') {
  const fd = new FormData();
  fd.append('file', new Blob([xml], { type: 'text/xml' }), 'wanted.xml');
  const r = await fetch(`${base}/api/v1/wanted-list/import/xml${abfrage}`,
    { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** Dieselbe Adresse, aber die Antwort ZEILENWEISE (NDJSON) gelesen. */
async function hochladenStrom(base, xml, abfrage) {
  const fd = new FormData();
  fd.append('file', new Blob([xml], { type: 'text/xml' }), 'wanted.xml');
  const r = await fetch(`${base}/api/v1/wanted-list/import/xml${abfrage}`,
    { method: 'POST', body: fd });
  const roh = await r.text();
  const zeilen = roh.split('\n').filter(z => z.trim()).map(z => JSON.parse(z));
  return { status: r.status, typ: r.headers.get('content-type') || '', zeilen };
}

async function aufbau() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x')`);
  HAUPT = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  await db.run(`INSERT INTO part_catalog (part_number, part_name)
                VALUES ('3001','Brick 2x4'), ('98765','Umgetauft')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3001',4,'Rot'), ('98765',15,'Weiss')
                ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO bl_zuordnung (art, rb_id, bl_id)
                VALUES ('part','98765','4162'), ('part','3001', NULL)`);
  await db.run(`INSERT INTO rb_colors (id,name,bl_color_id) VALUES (4,'Red',5),(15,'White',1)`);
}

test('Wanted-Liste: Vorschau und Schreiben über die echte Adresse', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await aufbau();

  const srv = testServer(_req, {
    sitzung: { userId: HAUPT }, apiNutzer: { user_id: HAUPT, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t,
  });

  await t.test('1. eine Datei ohne <INVENTORY> wird vorher abgewiesen', async () => {
    const { status, body } = await hochladen(srv.base, '<?xml version="1.0"?>\n<FOO/>\n');
    assert.equal(status, 422, `Erwartet 422, bekam ${status}`);
    assert.match(String(body.error || ''), /Wanted-Liste/,
      `Abgelehnt mit „${body.error}" — der Text soll sagen, DASS es keine Liste ist. ` +
      '„0 Posten gelesen" wäre mehrdeutig: Das kann auch eine leere Liste sein.');
  });

  await t.test('2. die Vorschau schreibt NICHTS', async () => {
    const { status, body } = await hochladen(srv.base, XML);
    assert.equal(status, 200, `Erwartet 200, bekam ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.vorschau, true, 'Ohne schreiben=1 ist das keine Vorschau');
    assert.equal(body.gelesen, 3, `${body.gelesen} Posten gelesen statt 3`);
    assert.equal(body.angelegt, 0, `${body.angelegt} angelegt — die Vorschau schreibt nicht`);

    // An der TABELLE geprüft und nicht an der Antwort: Eine Route, die
    // „vorschau: true" meldet und trotzdem schreibt, sähe in der Antwort
    // richtig aus.
    assert.equal((await db.get('SELECT COUNT(*)::int c FROM parts WHERE user_id=$1',
      [HAUPT])).c, 0, 'Die Vorschau hat Teile angelegt');
  });

  await t.test('3. die Vorschau nennt die Stufen getrennt und die offenen Posten', async () => {
    const { body } = await hochladen(srv.base, XML);
    assert.deepEqual(body.stufen, { gleich_vermerkt: 1, zuordnung: 1 },
      `Stufen: ${JSON.stringify(body.stufen)} — erwartet je eine aus bl_zuordnung`);
    assert.equal(body.offen.length, 1, `${body.offen.length} offen statt 1`);
    assert.equal(body.offen[0].blId, '99999',
      'Der offene Posten wird nicht mit seiner BrickLink-Nummer genannt — dann kann ' +
      'ihn niemand nachsehen');
    // Rebrickable wurde NICHT gefragt: ohne rebrickable=1 kostet der Import
    // kein Kontingent.
    assert.equal(body.rebrickable, undefined,
      'Es wurde bei Rebrickable gefragt, obwohl rebrickable=1 fehlte');
  });

  await t.test('4. mit schreiben=1 entstehen manuelle Teile — mit Menge und Farbe', async () => {
    const { body } = await hochladen(srv.base, XML, '?schreiben=1');
    assert.equal(body.vorschau, false);
    assert.equal(body.angelegt, 2, `${body.angelegt} angelegt statt 2: ${JSON.stringify(body.posten)}`);
    assert.equal(body.fehler, 0, `${body.fehler} Fehler: ${JSON.stringify(body.posten)}`);

    // Stufe 2: die Nummer bleibt, die Farbe wird abgebildet (BL 5 → RB 4).
    const a = await db.get(
      `SELECT p.color_id, COALESCE(SUM(pa.quantity),0)::int AS menge
         FROM parts p LEFT JOIN part_acquisitions pa
           ON pa.user_id=p.user_id AND pa.part_number=p.part_number AND pa.color_id=p.color_id
        WHERE p.user_id=$1 AND p.part_number='3001' GROUP BY p.color_id`, [HAUPT]);
    assert.ok(a, '3001 wurde nicht angelegt');
    assert.equal(Number(a.color_id), 4, `Farbe ${a.color_id} statt 4 (BL 5 = Rebrickable 4)`);
    assert.equal(a.menge, 3, `Menge ${a.menge} statt 3 — MINQTY war 3`);

    // Stufe 1: die abweichende Nummer muss UMGESETZT sein, nicht übernommen.
    assert.ok(await db.get(
      `SELECT 1 FROM parts WHERE user_id=$1 AND part_number='98765'`, [HAUPT]),
      'Die BrickLink-Nummer 4162 wurde nicht auf 98765 abgebildet');
    assert.equal((await db.get(
      `SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND part_number='4162'`, [HAUPT])).c, 0,
      'Die BrickLink-Nummer 4162 steht roh im Bestand — sie ist KEINE ' +
      'Rebrickable-Nummer, und ein Teil darunter findet keinen Katalogeintrag');

    // Der offene Posten ist NICHT angelegt worden.
    assert.equal((await db.get(
      `SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND part_number='99999'`, [HAUPT])).c, 0,
      'Ein Posten ohne bekannte Rebrickable-Nummer wurde trotzdem angelegt');
  });

  await t.test('5. kein Kaufpreis aus MAXPRICE', async () => {
    // MAXPRICE ist eine SUCHGRENZE, kein bezahlter Preis. Hier steht -1, und
    // selbst ein echter Wert dürfte nicht als Kaufpreis landen — sonst stünde
    // in der Finanzansicht ein Betrag, den niemand ausgegeben hat.
    // Die Spalte heisst `unit_price`, nicht `price` — nachgesehen, nachdem mein
    // erster Entwurf mit „column price does not exist" rot wurde. Ein
    // erfundener Spaltenname macht aus einer Zusicherung eine Fehlermeldung,
    // und die sieht aus wie ein Fehler im Code.
    const preise = await db.all(
      'SELECT unit_price FROM part_acquisitions WHERE user_id=$1', [HAUPT]);
    assert.ok(preise.length > 0, 'Vorbedingung: es gibt Erfassungen');
    for (const p of preise) {
      assert.ok(p.unit_price === null || Number(p.unit_price) >= 0,
        `Ein Kaufpreis von ${p.unit_price} ist aus MAXPRICE entstanden — MAXPRICE ist `
        + 'eine Suchgrenze, kein bezahlter Preis');
    }
  });

  await t.test('6. fremde Arten stehen im Bericht', async () => {
    const mit = liste(item('P', '3001', 5), item('B', '5002', null), item('G', '6001', null));
    const { body } = await hochladen(srv.base, mit);
    assert.deepEqual(body.fremdeArten, { B: 1, G: 1 },
      `fremdeArten: ${JSON.stringify(body.fremdeArten)} — ein Buch und ein Zubehör`);
  });

  // ── Der Fortschritt (Marcos Wunsch vom 20.10.) ────────────────────────────
  //
  // „kannst du beim Import auch den Fortschritt mit einem Fortschrittsbalken
  //  anzeigen?"
  //
  // Geprüft wird, was die Oberfläche tatsächlich liest: die ANTWORT, Zeile für
  // Zeile. Ein Test gegen den Rückruf im Kern wäre leichter zu schreiben und
  // sagte nichts darüber, ob die Meldungen durch die Leitung kommen.

  await t.test('7. mit strom=1 kommen Fortschrittszeilen, zuletzt der Bericht', async () => {
    const { status, typ, zeilen } = await hochladenStrom(srv.base, XML, '?schreiben=1&strom=1');
    assert.equal(status, 200);
    assert.match(typ, /ndjson/,
      `Content-Type „${typ}" — eine Zeilen-Antwort darf nicht als application/json ` +
      'ausgegeben werden, sonst versucht der Browser sie als EIN Dokument zu lesen');

    const melde = zeilen.filter(z => z.fortschritt);
    assert.equal(melde.length, 3,
      `${melde.length} Fortschrittszeilen für drei Posten — erwartet drei. Eine je ` +
      'Posten, auch für den offenen (sonst bliebe der Balken vor dem Ende stehen).');
    assert.deepEqual(melde.map(z => z.fortschritt.fertig), [1, 2, 3],
      'Die Zählung muss lückenlos und aufsteigend sein');
    for (const z of melde) {
      assert.equal(z.fortschritt.gesamt, 3, 'Der Nenner ist die Zahl der Posten');
      assert.equal(z.fortschritt.phase, 'schreiben');
    }

    const letzte = zeilen[zeilen.length - 1];
    assert.equal(letzte.success, true, 'Die letzte Zeile ist der Bericht');
    assert.equal(letzte.vorschau, false, 'mit schreiben=1 ist es kein Probelauf');
    assert.equal(letzte.gelesen, 3);
    assert.ok(!letzte.fortschritt, 'Der Bericht ist keine Fortschrittszeile');
  });

  await t.test('8. ohne strom=1 antwortet die Adresse unverändert als JSON', async () => {
    // Der Weg der Android-App und aller übrigen Prüfungen. Er darf sich durch
    // den Strom NICHT geändert haben.
    const r = await (async () => {
      const fd = new FormData();
      fd.append('file', new Blob([XML], { type: 'text/xml' }), 'wanted.xml');
      return fetch(`${srv.base}/api/v1/wanted-list/import/xml`, { method: 'POST', body: fd });
    })();
    assert.match(r.headers.get('content-type') || '', /application\/json/);
    const roh = await r.text();
    assert.ok(!roh.includes('"fortschritt"'),
      'Ohne strom=1 darf keine Fortschrittszeile in der Antwort stehen');
    const body = JSON.parse(roh);
    assert.equal(body.success, true);
    assert.equal(body.gelesen, 3);
  });
});
