/**
 * BrickLink-Wanted-Listen lesen und auf Rebrickable-Nummern abbilden.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „Ich möchte auch Bricklink-Wanted-Listen importieren können … Bitte
 *    beachte dass im xml BL-IDs und nicht Rebrickable-IDs enthalten sind."
 *
 * ── Was an Marcos echter Datei GEMESSEN wurde ───────────────────────────────
 *
 * Seine Datei (castle.xml, 2019 Zeilen) liegt NICHT im Baum — sie ist seine,
 * und ein Beispiel gehört nicht ins Repository, nur weil es gerade zur Hand
 * ist. Der Leser ist aber gegen sie gelaufen, und das sind die Zahlen:
 *
 *     224 Posten, alle ITEMTYPE=P
 *     886 Stück in der Summe, 139 Posten mit Menge > 1
 *     24 verschiedene BL-Farben
 *     0 fremde Arten, 0 ohne Nummer
 *     0 mit Höchstpreis (alle MAXPRICE=-1.0000)
 *     alle CONDITION=X → Zustand null („egal")
 *
 * Die Vorlagen unten sind daran gebaut: dieselben Felder, dieselbe
 * Reihenfolge, dieselben Schreibweisen der Teilenummern (rein numerisch,
 * Ziffern+Buchstaben, bedruckt mit pb, x-Präfix).
 *
 * ── Gegenproben (durchgeführt, Befunde GEMESSEN — siehe Commit) ─────────────
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1. Die reinen Lesefälle brauchen keine DB und laufen immer.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { leseWantedListe, loeseLokalAuf } = _req('utils/wantedListe.js');

test.after(async () => { await db.pool.end().catch(() => {}); });

/** Ein ITEM-Block in Marcos Schreibweise. */
function item(typ, id, farbe, menge = 1, zustand = 'X', preis = '-1.0000') {
  return `<ITEM>
<ITEMTYPE>${typ}</ITEMTYPE>
<ITEMID>${id}</ITEMID>
${farbe === null ? '' : `<COLOR>${farbe}</COLOR>\n`}<MAXPRICE>${preis}</MAXPRICE>
<MINQTY>${menge}</MINQTY>
<CONDITION>${zustand}</CONDITION>
<NOTIFY>N</NOTIFY>
</ITEM>`;
}
const liste = (...items) => `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n${items.join('\n')}\n</INVENTORY>\n`;

test('1. jeder Posten wird einzeln gelesen, nicht die Datei als Ganzes', () => {
  // Der Fehler, den dieser Fall ausschliesst: ein Muster über die GANZE Datei
  // legen. Dann gewinnt der erste Treffer je Feld, und aus 224 Posten wird
  // einer. Genau diese Form hat in diesem Baum schon zweimal etwas falsch
  // gemacht (siehe seitenweiseLesen in utils/gutscheinPdfSchreiben.ts).
  const xml = liste(
    item('P', '41879', 7),
    item('P', '973pb4536c01', 36, 2),
    item('P', 'x126', 95, 14),
  );
  const r = leseWantedListe(xml);
  assert.equal(r.posten.length, 3, `${r.posten.length} Posten statt 3`);
  assert.deepEqual(r.posten.map(p => p.blId), ['41879', '973pb4536c01', 'x126']);
  assert.deepEqual(r.posten.map(p => p.blFarbe), [7, 36, 95]);
  assert.deepEqual(r.posten.map(p => p.menge), [1, 2, 14]);
});

test('2. CONDITION=X heisst „egal" und wird nicht zu N', () => {
  // Der Zustand ist in dieser Anwendung ein Schlüsselteil (N und U sind zwei
  // Einträge). „Egal" als N zu lesen wäre eine Entscheidung dieser Datei über
  // etwas, das die Einstellung des Kontos bestimmt — dieselbe Regel wie beim
  // Merklisten-Import.
  const r = leseWantedListe(liste(item('P', '3001', 4, 1, 'X'),
                                  item('P', '3002', 4, 1, 'N'),
                                  item('P', '3003', 4, 1, 'U')));
  assert.deepEqual(r.posten.map(p => p.zustand), [null, 'N', 'U']);
});

test('3. MAXPRICE=-1 ist kein Preis', () => {
  // -1.0000 steht in ALLEN 224 Posten von Marcos Datei. Als Zahl übernommen
  // ergäbe das einen Kaufpreis von minus einem Franken.
  const r = leseWantedListe(liste(item('P', '3001', 4, 1, 'X', '-1.0000'),
                                  item('P', '3002', 4, 1, 'X', '2.5000')));
  assert.equal(r.posten[0].maxPreis, null, 'Aus -1 wurde ein Preis');
  assert.equal(r.posten[1].maxPreis, 2.5);
});

test('4. fremde Arten werden gezählt, nicht verschluckt', () => {
  // B (Book), G (Gear), I (Instruction) führt diese Anwendung nicht. Wer eine
  // Liste mit Zubehör hochlädt, soll LESEN, dass davon etwas liegenblieb —
  // eine stille Lücke sieht aus wie ein vollständiger Import.
  const r = leseWantedListe(liste(
    item('P', '3001', 4), item('B', '5002', null), item('G', '6001', null),
    item('B', '5003', null), item('M', 'sw0001', null), item('S', '75192-1', null)));
  assert.equal(r.posten.length, 3, `${r.posten.length} brauchbare Posten statt 3`);
  assert.deepEqual(r.posten.map(p => p.art), ['part', 'fig', 'set']);
  assert.deepEqual(r.fremdeArten, { B: 2, G: 1 },
    `Fremde Arten: ${JSON.stringify(r.fremdeArten)} — zwei Bücher und ein Zubehör`);
});

test('5. ein Posten ohne ITEMID wird gezählt, nicht geraten', () => {
  const xml = liste(item('P', '3001', 4))
    .replace('<ITEMID>3001</ITEMID>', '');
  const r = leseWantedListe(xml);
  assert.equal(r.posten.length, 0);
  assert.equal(r.ohneNummer, 1, 'Der Posten ohne Nummer wurde nicht gezählt');
});

test('6. Entitäten werden aufgelöst, und & zuletzt', () => {
  // &amp; MUSS zuletzt ersetzt werden: Sonst wird aus „&amp;lt;" erst „&lt;"
  // und dann „<" — eine Zeichenkette, die nie dort stand.
  const r = leseWantedListe(liste(item('P', 'A&amp;B', 4)));
  assert.equal(r.posten[0].blId, 'A&B');
  const r2 = leseWantedListe(liste(item('P', 'A&amp;lt;B', 4)));
  assert.equal(r2.posten[0].blId, 'A&lt;B',
    'Aus &amp;lt; wurde „<" — die Reihenfolge der Ersetzungen stimmt nicht');
});

test('die lokale Auflösung trennt Abbildung von Vermutung', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }

  // Drei Lagen, eine je Stufe — und eine vierte ohne alles.
  await db.run(`INSERT INTO part_catalog (part_number, part_name)
                VALUES ('3001','Brick 2x4'), ('98765','Umgetauft'), ('11111','Nur im Katalog')`);
  await db.run(`INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES
                  ('part','98765','4162'),    -- abweichende Nummer: eingetragen
                  ('part','3001', NULL)       -- nachgesehen: keine abweichende`);
  await db.run(`INSERT INTO rb_colors (id, name, bl_color_id) VALUES
                  (4,'Red',5), (15,'White',1)`);

  const posten = leseWantedListe(liste(
    item('P', '4162', 5),     // Stufe 1 — Zuordnung
    item('P', '3001', 1),     // Stufe 2 — gleich vermerkt
    item('P', '11111', 5),    // Stufe 3 — nur Katalogtreffer
    item('P', '99999', 5),    // nichts
    item('P', '3001', 77),    // Nummer ja, Farbe unbekannt
  )).posten;

  const auf = await loeseLokalAuf(posten);
  assert.equal(auf.length, 5);

  await t.test('Stufe 1: die eingetragene abweichende Nummer', () => {
    assert.equal(auf[0].rbId, '98765',
      `4162 wurde zu ${auf[0].rbId} — erwartet 98765 aus bl_zuordnung`);
    assert.equal(auf[0].sicherheit, 'zuordnung');
    assert.equal(auf[0].rbFarbe, 4, 'BL-Farbe 5 ist Rebrickable 4 (Red)');
  });

  await t.test('Stufe 2: „keine abweichende Nummer" ist auch eine Abbildung', () => {
    // Migration 0037 erklaert diesen NULL-Wert ausdruecklich als Vermerk,
    // nicht als Fehlen. Ihn wie einen Katalogtreffer zu zaehlen waere eine
    // Abbildung zur Vermutung herabgestuft.
    assert.equal(auf[1].rbId, '3001');
    assert.equal(auf[1].sicherheit, 'gleich_vermerkt',
      `Stufe „${auf[1].sicherheit}" — ein NULL-Vermerk in bl_zuordnung ist eine ` +
      'Abbildung und kein blosser Katalogtreffer');
    assert.equal(auf[1].rbFarbe, 15);
  });

  await t.test('Stufe 3: der Katalogtreffer bleibt als Vermutung markiert', () => {
    assert.equal(auf[2].rbId, '11111');
    assert.equal(auf[2].sicherheit, 'katalogtreffer',
      `Stufe „${auf[2].sicherheit}" — niemand hat für 11111 bei BrickLink ` +
      'nachgesehen. Als „zuordnung" gezählt sähe eine Vermutung wie eine ' +
      'Abbildung aus, und genau diese Trennung soll die Vorschau zeigen.');
  });

  await t.test('ohne jeden Treffer bleibt es offen — es wird nichts geraten', () => {
    assert.equal(auf[3].rbId, null, `99999 wurde zu ${auf[3].rbId} aufgelöst`);
    assert.equal(auf[3].sicherheit, null);
  });

  await t.test('eine unbekannte Farbe lässt den Posten nicht scheitern', () => {
    // Die Nummer ist da, nur die Farbe nicht. Den ganzen Posten zu verwerfen
    // hiesse, ein bekanntes Teil wegen einer fehlenden Farbzuordnung
    // liegenzulassen; den Posten ohne Hinweis anzulegen hiesse, eine falsche
    // Farbe zu behaupten. Deshalb: Nummer ja, `farbeOffen` gesetzt.
    assert.equal(auf[4].rbId, '3001');
    assert.equal(auf[4].rbFarbe, null);
    assert.equal(auf[4].farbeOffen, true,
      'Die offene Farbe wird nicht gemeldet — dann legt der Import sie still falsch an');
    // Gegenrichtung: Bei den vier anderen ist nichts offen.
    assert.deepEqual(auf.slice(0, 4).map(a => a.farbeOffen), [false, false, false, false]);
  });
});
