/**
 * Der eigene Katalog wird VOR Rebrickable gefragt.
 *
 * ── Marcos Frage vom 20.10. ─────────────────────────────────────────────────
 *
 *   „Wieso ist der Import so langsam? Wird jedes Teil bei Rebrickable
 *    abgefragt auch wenn es lokal bereits vorhanden ist, resp. das Mapping
 *    vorhanden ist?"
 *
 * Fuers MAPPING lautete die Antwort nein: loeseLokalAuf() in
 * utils/wantedListe.ts loest zuerst lokal auf und fragt nur die offenen
 * Nummern nach (geprueft in test/wanted-liste-db.test.js).
 *
 * Fuer Name und Bild lautete sie JA. GEMESSEN am laufenden Server, mit einem
 * Zaehler auf https.get, beim Anlegen von Teil 3001 in Farbe 4 — Name UND
 * Farbbild standen im Katalog:
 *
 *     → get rebrickable.com/api/v3/lego/parts/?part_nums=3001&page_size=1
 *     Dauer: 1475 ms   (davon ~1,5 s Drosselwarten)
 *
 * lookupPart() macht im Betrieb ZWEI Abrufe (das Teil, dann das Farbbild),
 * jeder durch die Hintergrunddrossel mit 1,5 Sekunden Abstand
 * (utils/rateLimiter.ts). Bei einer Wanted-Liste mit 224 Posten sind das elf
 * Minuten Warten und 448 Abrufe aus dem Tageskontingent — fuer Daten, die
 * dalagen. Nach der Aenderung: 0 Abrufe, 49 ms.
 *
 * ── Warum die Pruefung HIER steht und nicht am Import ───────────────────────
 *
 * Die Luecke war nicht im Import. Sie war in addManualPartIntern() und
 * addManualFigIntern(), deren Regel „kein Name mitgegeben ⇒ fremden Dienst
 * fragen" hiess. Der Import war nur der Auffaellige, weil er 224 Posten ohne
 * Namen hereinschiebt; dieselbe Luecke hat jeder andere Weg, der ohne Namen
 * hereinkommt — POST /api/v1/parts etwa.
 *
 * ── Was als „Bild vorhanden" gilt ───────────────────────────────────────────
 *
 * Nur FARBRICHTIGE Quellen (part_color_catalog, set_parts_catalog). Das
 * allgemeine Teilebild aus rb_parts ist bei vielen Teilen die weisse Fassung;
 * es als Treffer zu zaehlen hiesse, den Farb-Abruf zu sparen und das falsche
 * Bild zu behalten. Der Fall „Name ja, Farbbild nein" steht deshalb unten und
 * MUSS abrufen.
 *
 * ── Gegenproben (am 20.10. GEMESSEN, Zahlen abgeschrieben) ──────────────────
 *
 * Ausgangslage: `# pass 9 / # fail 0` (acht Faelle und ihre Huelle). Jede
 * Gegenprobe ist EINE Aenderung, danach zurueckgenommen (die drei Dateien
 * wurden gegen ihre Sicherung verglichen).
 *
 *   A  den katalogTeil()-Vorlauf in routes/parts.ts entfernt (also der Stand
 *      von Marcos Befund)
 *      → `pass 4 / fail 5`. Rot sind VIER Faelle: „Name und Farbbild im
 *        Katalog — kein Abruf", „Bild als Datei zaehlt auch", „ohne Farbe
 *        zaehlt das allgemeine Bild" und „der Name kommt aus dem Katalog".
 *        Der erste meldet `[ 'lookupPart 3001/4' ] statt []` — Marcos Befund
 *        in Zahlen.
 *   B  `hatBild` in der Bedingung durch `image_url` ersetzt (also die Datei
 *      nicht als Beleg zaehlen lassen)
 *      → `pass 7 / fail 2`. Rot: „Bild als Datei zaehlt auch". Genau dafuer
 *        gibt es das Feld; ohne es waere jedes heruntergeladene Bild wieder
 *        ein Abruf.
 *   C  in katalogTeil() `rb_parts.part_img_url` auch mit Farbe als Treffer
 *      gezaehlt
 *      → `pass 7 / fail 2`. Rot: „Name ja, Farbbild nein — es wird gefragt".
 *        Das ist die Schranke gegen das weisse Bild.
 *
 *        Diese Gegenprobe blieb beim ersten Versuch GRUEN, und das war kein
 *        Lob fuer die Schranke, sondern eine Luecke im Test: Fuer 3003 stand
 *        gar keine rb_parts-Zeile da, das allgemeine Bild konnte also nicht
 *        dazwischenkommen. Die Zeile steht jetzt unten — sie ist der Grund,
 *        warum dieser Fall ueberhaupt etwas prueft.
 *   D  den katalogFigur()-Vorlauf in routes/minifigs.ts entfernt
 *      → `pass 7 / fail 2`. Rot: „Figur mit Name und Bild — kein Abruf".
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');

// Rebrickable vorgeben, BEVOR routes/parts.js und routes/minifigs.js die
// Funktionen herausziehen. esbuild exportiert ueber Getter, ein
// `rb.lookupPart = …` liefe ins Leere — deshalb der Eintrag im
// require-Zwischenspeicher (dasselbe Vorgehen wie in
// test/preis-schreibweg-db.test.js).
const rbPfad = require.resolve(path.join(ROOT, 'dist', 'clients/rebrickable.js'));
const echtRb = require(rbPfad);
let abrufe = [];
require.cache[rbPfad].exports = Object.assign({}, echtRb, {
  lookupPart: async (nr, farbe) => {
    abrufe.push(`lookupPart ${nr}/${farbe}`);
    return { part_name: 'VON REBRICKABLE', category_name: '42',
             image_url: 'https://cdn.example/rb.jpg' };
  },
  getMinifigInfo: async (nr) => {
    abrufe.push(`getMinifigInfo ${nr}`);
    return { fig_number: nr, fig_name: 'VON REBRICKABLE',
             image_url: 'https://cdn.example/rb-fig.jpg' };
  },
});

test.after(async () => { await db.pool.end().catch(() => {}); });

test('der eigene Katalog wird vor Rebrickable gefragt', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  {
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  }

  const UID = (await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('marco','x') RETURNING id`)).id;

  // Der Preisabruf ist hier nicht die Frage und soll nicht dazwischenreden:
  // Ohne BrickLink-Zugang bricht fetchPartPrice von sich aus ab, und
  // marktpreisMitHerkunft faengt es (preis: null).
  await db.run(`INSERT INTO part_catalog (part_number,part_name,category_name) VALUES
                  ('3001','Brick 2 x 4','Bricks'),
                  ('3002','Brick 2 x 2','Bricks'),
                  ('3003','Brick 2 x 3','Bricks')`);
  // 3001/4: Name UND Farbbild als URL. 3002/4: Bild nur als DATEI.
  // 3003 steht ohne jedes Farbbild da.
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,image_url) VALUES
                  ('3001',4,'https://cdn.example/3001-4.jpg')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,image_local) VALUES
                  ('3002',4,'/images/parts/3002-4.jpg')`);
  // 3003 traegt in rb_parts ein ALLGEMEINES Bild. Das ist der Fall, an dem
  // sich entscheidet, ob die Schranke gegen das weisse Bild haelt: Zaehlte man
  // es bei angegebener Farbe als Treffer, unterbliebe der Farb-Abruf und das
  // allgemeine Bild stuende dauerhaft an der roten Variante. Ohne diese Zeile
  // war Gegenprobe C gruen geblieben — die Schranke war ungeprueft.
  await db.run(`INSERT INTO rb_parts (part_num,name,part_img_url) VALUES
                  ('3003','Brick 2 x 3','https://cdn.example/3003-weiss.jpg')`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name,image_url) VALUES
                  ('fig-000123','Chewbacca','https://cdn.example/chewie.jpg'),
                  ('fig-000456','Luke',NULL)`);

  const { addManualPart } = _req('utils/manuelleTeile.js');
  const { addManualFig }  = _req('utils/manuelleFiguren.js');

  /** Ein Teil anlegen und zaehlen, was dabei nach draussen ging. */
  const legeTeil = async (nr, farbe) => {
    abrufe = [];
    await addManualPart(UID, { part_number: nr, color_id: farbe, quantity: 1 });
    return abrufe.filter(a => a.startsWith('lookupPart'));
  };

  await t.test('Name und Farbbild im Katalog — kein Abruf', async () => {
    assert.deepEqual(await legeTeil('3001', 4), [],
      'Beides steht lokal da. Jeder Abruf hier ist der, den Marco gemessen hat');
  });

  await t.test('Bild als Datei zaehlt auch', async () => {
    assert.deepEqual(await legeTeil('3002', 4), [],
      'image_local ist ein Pfad und darf nicht durch V.optionalImageUrl — ' +
      'er beweist aber, dass der Abruf nichts mehr zu holen hat');
  });

  await t.test('Name ja, Farbbild nein — es wird gefragt', async () => {
    assert.deepEqual(await legeTeil('3003', 4), ['lookupPart 3003/4'],
      'Gespart werden soll der ueberfluessige Abruf, nicht der noetige. ' +
      'rb_parts.part_img_url liegt vor und darf den Farb-Abruf NICHT ersetzen');
    const z = await db.get(
      `SELECT image_url FROM part_color_catalog WHERE part_number='3003' AND color_id=4`);
    assert.equal(z?.image_url, 'https://cdn.example/rb.jpg',
      'Geschrieben wird, was lookupPart fuer DIESE Farbe geliefert hat — ' +
      'nicht das allgemeine Bild aus rb_parts');
  });

  await t.test('ohne Farbe zaehlt das allgemeine Bild', async () => {
    // Die Kehrseite des Falls darueber: Ohne angegebene Farbe gibt es keine
    // farbrichtige Erwartung, und lookupPart holt dort selbst nur das
    // allgemeine Bild. Dann ist der Abruf wirklich ueberfluessig.
    abrufe = [];
    await addManualPart(UID, { part_number: '3003', quantity: 1 });
    assert.deepEqual(abrufe, [],
      'rb_parts fuehrt Name und allgemeines Bild — mehr holt der Abruf hier nicht');
  });

  await t.test('gar nicht im Katalog — es wird gefragt', async () => {
    assert.deepEqual(await legeTeil('99999zzz', 4), ['lookupPart 99999zzz/4'],
      'Ohne lokalen Eintrag ist Rebrickable die einzige Quelle');
  });

  await t.test('der Name kommt aus dem Katalog, nicht von Rebrickable', async () => {
    // Die Gegenprobe zum ersten Fall: Dass nicht gefragt wurde, soll nicht
    // heissen, dass der Name fehlt. Der Vorgabewert des Doppels lautet
    // „VON REBRICKABLE" — er darf hier nirgends stehen.
    await db.run("DELETE FROM parts WHERE user_id=$1 AND part_number='3001'", [UID]);
    abrufe = [];
    const r = await addManualPart(UID, { part_number: '3001', color_id: 4, quantity: 1 });
    assert.equal(r.part_name, 'Brick 2 x 4',
      'Der Katalogname, nicht der des Doppels — sonst waere nichts gespart, sondern verloren');
    assert.deepEqual(abrufe, []);
  });

  await t.test('Figur mit Name und Bild — kein Abruf', async () => {
    abrufe = [];
    const r = await addManualFig(UID, { fig_number: 'fig-000123', quantity: 1 });
    assert.deepEqual(abrufe, [], 'minifigs_catalog fuehrt Name und Bild');
    assert.equal(r.fig_name, 'Chewbacca');
  });

  await t.test('Figur ohne Bild — es wird gefragt', async () => {
    abrufe = [];
    await addManualFig(UID, { fig_number: 'fig-000456', quantity: 1 });
    assert.deepEqual(abrufe, ['getMinifigInfo fig-000456'],
      'Der Name allein genuegt nicht: das Bild fehlt wirklich');
  });
});
