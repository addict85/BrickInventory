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
const { leseWantedListe, loeseLokalAuf, importiereWantedListe } = _req('utils/wantedListe.js');

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

/**
 * ── Nachtrag 19.10.: was der SCHREIBWEG mit `farbeOffen` tut ────────────────
 *
 * Marcos Befund, mit Bildschirmfoto aus der App: „Die Farbe wurde nicht immer
 * übernommen und die Teile sind nun mehrfach vorhanden (bsp 3001). Das sollte
 * nicht sein."
 *
 * Die Auflösung oben tat ihre Arbeit — sie setzte `farbeOffen` und sagt im
 * Fall darüber sogar, warum: „den Posten ohne Hinweis anzulegen hiesse, eine
 * falsche Farbe zu behaupten". Der Schreibweg las das Feld NIE. Er schrieb
 * `color_id: a.rbFarbe ?? 0` — und 0 ist bei Rebrickable SCHWARZ, nicht
 * „keine Farbe" (die Warnung steht wörtlich in routes/parts.ts).
 *
 * NACHGESTELLT am laufenden Server, vorher:
 *
 *     part_number | color_id | color_name
 *     3001        |        4 | (leer)      ← BL-Farbe 5, richtig abgebildet
 *     3001        |        0 | (leer)      ← BL-Farbe 85, ERFUNDEN
 *
 * Zwei Karten für ein Teil, beide ohne Farbnamen. Nachher: eine Zeile,
 * color_id 4, color_name „Red" — und der zweite Posten offen, mit Grund.
 *
 * Hier wird mit einem gefälschten Anleger geprüft und nicht über die Route:
 * Die Schnittstelle `Anleger` gibt es genau dafür („ein Test könnte Zähler
 * hineinstecken").
 *
 * ── Gegenproben (am 19.10. GEMESSEN, Zahlen abgeschrieben) ──────────────────
 *
 * Ausgangslage, dieselbe Datei, derselbe Aufruf: `# pass 17 / # fail 0`.
 * Jede Gegenprobe ist EINE Änderung in utils/wantedListe.ts, danach wieder
 * zurückgenommen (die Datei wurde gegen ihre Sicherung verglichen).
 *
 *   A  die alte Fassung des Schreibwegs: `a.farbeOffen` aus der Abbruch-
 *      bedingung entfernt, damit der offene Posten wieder mit
 *      `color_id: a.rbFarbe ?? 0` hinausgeht
 *      → `# pass 13 / # fail 4`. Rot sind DREI Unterfälle, nicht einer:
 *        „eine offene Farbe wird nicht erfunden" („Der Anleger bekam 2
 *        Posten statt einem"), „ein zweiter Lauf stockt auf" und „in der
 *        Vorschau wird nichts geschrieben" — denn mit dem erfundenen
 *        Schwarz zählt der Bericht 2 statt 1. Eine Gegenprobe darf mehr
 *        umwerfen als den Fall, für den sie gedacht war; sie trifft hier
 *        alles, was an der Zahl hängt.
 *   B  `color_name`/`color_hex` nicht mehr übergeben (die zwei Zeilen
 *      gelöscht)
 *      → `# pass 15 / # fail 2`. Rot ist genau „die Farbe reist mit Namen
 *        und Farbwert": `expected: 'Red'`, bekommen hat der Anleger nichts.
 *   C  `action` des Anlegers ignoriert (`const wieAngelegt = true`)
 *      → `# pass 15 / # fail 2`. Rot ist genau „ein zweiter Lauf stockt
 *        auf, statt anzulegen": `angelegt: 1`, erwartet 0.
 */
test('der Import erfindet keine Farbe und schreibt ihren Namen', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  // Derselbe Unterbau wie oben — der Fall läuft eigenständig.
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('3001','Brick 2x4')`);
  await db.run(`INSERT INTO rb_colors (id, name, rgb, bl_color_id) VALUES (4,'Red','C91A09',5)`);

  // BL-Farbe 5 ist abbildbar, 85 nicht — genau Marcos Lage.
  const xml = `<INVENTORY>${item('P', '3001', 5, 10)}${item('P', '3001', 85, 7)}</INVENTORY>`;

  /** Ein Anleger, der nur mitschreibt. `action` wie addManualPart. */
  function zaehler(zweiterLauf = false) {
    const gesehen = [];
    return {
      gesehen,
      anleger: {
        teil: async (_u, body) => { gesehen.push(body); return { action: zweiterLauf ? 'updated' : 'created' }; },
        figur: async () => ({ action: 'created' }),
        set: async () => ({ action: 'created' }),
      },
    };
  }

  const z1 = zaehler();
  const bericht = await importiereWantedListe(1, xml, { anleger: z1.anleger });

  await t.test('eine offene Farbe wird nicht erfunden', () => {
    assert.equal(z1.gesehen.length, 1,
      `Der Anleger bekam ${z1.gesehen.length} Posten statt einem. Der zweite hat ` +
      'eine Farbe, die der Katalog nicht kennt — ihn mit `color_id: 0` zu ' +
      'schreiben heisst SCHWARZ, und daneben steht dasselbe Teil in seiner ' +
      'richtigen Farbe. Das ist das Doppelte aus Marcos Bildschirmfoto.');
    const offen = bericht.posten.find(p => p.ausgang === 'offen');
    assert.ok(offen, 'Der Posten mit offener Farbe steht nicht als „offen" im Bericht');
    assert.match(offen.grund || '', /BrickLink-Farbe 85/,
      `Der Grund nennt die Farbe nicht: „${offen.grund}" — dann weiss Marco ` +
      'nicht, was er nachtragen muss.');
  });

  await t.test('die Farbe reist mit Namen und Farbwert', () => {
    assert.equal(z1.gesehen[0].color_id, 4);
    assert.equal(z1.gesehen[0].color_name, 'Red',
      'Ohne `color_name` bleibt die Spalte leer. Die Teileliste liest den ' +
      'Namen von dort — der Hex-Wert fällt auf den Katalog zurück, der Name ' +
      'NICHT. Ergebnis ist ein Farbpunkt ohne Beschriftung.');
    assert.equal(z1.gesehen[0].color_hex, 'C91A09');
  });

  await t.test('ein zweiter Lauf stockt auf, statt anzulegen', async () => {
    const z2 = zaehler(true);
    const b2 = await importiereWantedListe(1, xml, { anleger: z2.anleger });
    assert.equal(b2.angelegt, 0,
      `angelegt: ${b2.angelegt} — der Anleger meldete „updated". Vorher zählte ` +
      'der Import blind hoch: Ein zweiter Import derselben Liste meldete ' +
      '„angelegt: 2, aufgestockt: 0", obwohl nichts Neues entstand.');
    assert.equal(b2.aufgestockt, 1);
  });

  await t.test('in der Vorschau wird nichts geschrieben', () => {
    // Die Gegenrichtung: Der Fall oben wäre auch grün, wenn der Import
    // überhaupt nichts mehr schriebe.
    assert.equal(bericht.vorschau, false, 'Dieser Lauf war keine Vorschau');
    assert.equal(bericht.angelegt, 1, 'Der abbildbare Posten muss angelegt werden');
  });
});
