/**
 * Der Filter der Reiter „Teile" und „Minifiguren" trifft BEIDE Listen.
 *
 * ── Marcos Befund vom 20.10. ────────────────────────────────────────────────
 *
 *   „Wenn ich im Filter z.b. nach 3001 suche passiert nichts."
 *
 * NACHGEMESSEN am laufenden Server (angemeldet, Reiter Teile, zwei manuell
 * erfasste Kacheln): Vor der Eingabe standen „9999 | Brick 2 x 2" und
 * „3001 | Brick 2 x 4 | Red" da, nach der Eingabe von „3001" DIESELBEN ZWEI.
 * Getroffen hatte der Suchtext allein die Wand der Set-Teile darunter (dort
 * null Treffer, weil das Teil manuell erfasst ist).
 *
 * ── Warum das nicht Auslegung ist ───────────────────────────────────────────
 *
 * public/index.html stellt die Filterleiste ÜBER den manuellen Bereich und
 * begründet es dort ausdrücklich:
 *
 *     „Die manuell erfassten Teile stehen UNTER der Filterleiste (Nachtrag 34,
 *      Marcos Hinweis): Der Filter wirkt auf beide Listen — auf die manuellen
 *      und die aus Sets."
 *
 * test/tab-layout.test.js prüft diese Anordnung, für BEIDE Reiter. Geprüft war
 * damit die Anordnung, nicht ihre Wirkung: Die Leiste versprach etwas, das die
 * Abfrage nicht hielt — und zwar in beiden Reitern. Marco hat es an den Teilen
 * gesehen; die Minifiguren trugen es unbemerkt mit.
 *
 * ── Gefiltert wird am SERVER ────────────────────────────────────────────────
 *
 * Wie beim Konto- und Lagerortfilter daneben (public/js/14-scope.js schreibt
 * den Grund aus). Deshalb steht die Prüfung hier an den Abfragen und nicht an
 * einem Cache im Browser.
 *
 * ── Gegenproben (am 20.10. GEMESSEN, Zahlen abgeschrieben) ──────────────────
 *
 * Ausgangslage: `# pass 11 / # fail 0` (zehn Fälle und ihre Hülle). Jede
 * Gegenprobe ist EINE Änderung, danach zurückgenommen (die Dateien wurden
 * gegen ihre Sicherung verglichen).
 *
 *   A  `search` in getManualParts ignoriert (`if (false && search)`)
 *      → `pass 4 / fail 7`. Rot sind SECHS Fälle: Teilenummer, Name,
 *        BrickLink-Nummer, „ohne Treffer leer", „Suchtext und Lagerort
 *        zusammen" und „das Set-Teil bleibt draussen". Der erste meldet
 *        „die Suche nach 3001 liefert 3001,3002,3003 — erwartet nur 3001".
 *        Das ist Marcos Befund, in Zahlen.
 *   B  `search` in getManualMinifigs ignoriert
 *      → `pass 9 / fail 2`. Rot ist der Figuren-Fall. Dass es nur einer ist,
 *        ist der Grund, warum diese Lücke so lange unbemerkt blieb: Niemand
 *        sucht im Reiter Minifiguren nach einer manuell erfassten Figur,
 *        bevor er es bei den Teilen gemerkt hat.
 *   C  die BrickLink-Nummer aus teileSuche() entfernt
 *      → `pass 8 / fail 3`. Rot sind ZWEI Fälle: „die Suche findet die
 *        BrickLink-Nummer von der Kachel" (manuelle Liste) und „die Wand der
 *        Set-Teile sucht über dieselbe Formulierung". Eine Änderung, zwei
 *        Fundstellen — genau dafür ist der Ausdruck zusammengelegt.
 *   D  den Lagerort-Platzhalter VOR den Suchtext in `params` gelegt, die
 *      Nummern im SQL gelassen
 *      → `pass 9 / fail 2`. Rot ist „Suchtext und Lagerort zusammen" mit
 *        null Treffern: Jede Bedingung bekam den Wert der anderen. Der Fall
 *        steht genau deshalb da.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const { haeltFigur, haeltTeil } = require('./helpers/bestand');
const db = _req('db/database.js');

test.after(async () => { await db.pool.end().catch(() => {}); });

test('Suchtext und Lagerort treffen auch die manuell erfassten Listen',
  { concurrency: 1 }, async (t) => {
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

  const u = await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('marco','x') RETURNING id`);
  const UID = u.id;

  // Drei manuell erfasste Teile. 3002 trägt bei BrickLink eine ANDERE Nummer —
  // und auf der Kachel steht die (bl_part_number, blNummerSql). Wer sie dort
  // liest, tippt sie auch ein.
  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES
                  ('3001','Brick 2 x 4'), ('3002','Brick 2 x 2'), ('3003','Brick 2 x 3')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name) VALUES
                  ('3001',4,'Red'), ('3002',4,'Red'), ('3003',4,'Red')`);
  await db.run(`INSERT INTO bl_zuordnung (art,rb_id,bl_id) VALUES ('part','3002','9999')`);
  await db.run(`INSERT INTO storage_locations (user_id,name) VALUES ($1,'Kiste 3')`, [UID]);
  const ORT = (await db.get(`SELECT id FROM storage_locations WHERE name='Kiste 3'`)).id;
  await haeltTeil(db, UID, '3001', { colorId: 4, menge: 10, storageId: ORT });
  await haeltTeil(db, UID, '3002', { colorId: 4, menge: 5 });
  await haeltTeil(db, UID, '3003', { colorId: 4, menge: 1 });
  // Ein Set-Teil derselben Nummer: Es darf in dieser Liste NIE auftauchen,
  // auch nicht als Suchtreffer.
  await haeltTeil(db, UID, '3001', { setNumber: '10497-1', colorId: 7, menge: 2 });

  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES
                  ('fig-000123','Chewbacca'), ('fig-000456','Luke Skywalker')`);
  await haeltFigur(db, UID, 'fig-000123', { menge: 1 });
  await haeltFigur(db, UID, 'fig-000456', { menge: 2 });

  const teile   = _req('utils/handlers/parts.js');
  const figuren = _req('utils/handlers/minifigs.js');
  const nummern = async (opt) =>
    (await teile.getManualParts([UID], UID, opt)).map(p => String(p.part_number)).sort();
  const figNummern = async (opt) =>
    (await figuren.getManualMinifigs([UID], UID, opt)).map(f => String(f.fig_number)).sort();

  await t.test('ohne Suchtext steht alles da', async () => {
    assert.deepEqual(await nummern({}), ['3001', '3002', '3003'],
      'Die Liste ohne Filter ist der Vergleichspunkt für alles Folgende');
    assert.deepEqual(await figNummern({}), ['fig-000123', 'fig-000456']);
  });

  await t.test('die Suche nach der Teilenummer lässt nur diese stehen', async () => {
    const g = await nummern({ search: '3001' });
    assert.deepEqual(g, ['3001'],
      `Die Suche nach 3001 liefert ${g.join(',')} — erwartet nur 3001. ` +
      'Genau das ist Marcos Befund: „passiert nichts".');
  });

  await t.test('die Suche findet den Namen aus dem Katalog', async () => {
    assert.deepEqual(await nummern({ search: '2 x 3' }), ['3003'],
      'Der Teilename steht seit Migration 0034 in part_catalog — die ' +
      'Bedingung muss über den JOIN gehen, nicht über parts');
  });

  await t.test('die Suche findet die BrickLink-Nummer von der Kachel', async () => {
    const g = await nummern({ search: '9999' });
    assert.deepEqual(g, ['3002'],
      `Die Suche nach 9999 liefert ${g.join(',') || '(nichts)'} — erwartet 3002. ` +
      'Auf der Kachel steht 9999 (bl_part_number); eine Suche, die nur die ' +
      'Rebrickable-Nummer kennt, findet nicht, was dasteht.');
  });

  await t.test('ohne Treffer bleibt die Liste leer — nicht voll', async () => {
    assert.deepEqual(await nummern({ search: '4711' }), [],
      'Ein Suchtext ohne Treffer muss eine leere Liste ergeben. Käme die ' +
      'ganze Liste zurück, sähe es wieder aus wie „passiert nichts".');
  });

  await t.test('der Lagerort filtert dieselbe Liste', async () => {
    assert.deepEqual(await nummern({ storage: 'Kiste 3' }), ['3001'],
      'Der Lagerortfilter steht in derselben Leiste und gehört zum gleichen ' +
      'Versprechen');
    assert.deepEqual(await nummern({ storage: 'Regal B' }), [],
      'Ein Ort ohne Teile ergibt eine leere Liste');
  });

  await t.test('Suchtext und Lagerort zusammen', async () => {
    assert.deepEqual(await nummern({ search: '3001', storage: 'Kiste 3' }), ['3001'],
      'Beide Platzhalter stehen in EINER Abfrage; vertauschen sich ihre ' +
      'Nummern, bekommt jede Bedingung den Wert der anderen und die Liste ' +
      'ist leer');
    assert.deepEqual(await nummern({ search: '3002', storage: 'Kiste 3' }), [],
      'Beide Bedingungen gelten zusammen, nicht wahlweise');
  });

  await t.test('das Set-Teil bleibt draussen, auch als Suchtreffer', async () => {
    const alle = await teile.getManualParts([UID], UID, { search: '3001' });
    assert.deepEqual(alle.map(p => p.color_id), [4],
      'Diese Liste zeigt nur source=manual. Das Set-Teil 3001 in Farbe 7 ' +
      'gehört in die Wand darunter — der Suchtext darf es nicht hereinholen.');
  });

  await t.test('die Figurenliste sucht über Nummer und Name', async () => {
    assert.deepEqual(await figNummern({ search: 'chewb' }), ['fig-000123'],
      'Der Figurenname steht in minifigs_catalog');
    assert.deepEqual(await figNummern({ search: '000456' }), ['fig-000456'],
      'Die Figurennummer muss genauso treffen');
  });

  await t.test('die Wand der Set-Teile sucht über dieselbe Formulierung', async () => {
    // teileSuche() ist für beide Listen EIN Ausdruck. Diese Zusicherung hält
    // sie zusammen: Vorher kannte der Live-Weg der Set-Teile die
    // BrickLink-Nummer NICHT, die vorberechnete Zusammenfassung daneben schon
    // — dieselbe Suche fand je nach Weg etwas anderes.
    const d = await teile.getParts([UID], { search: '9999' });
    assert.deepEqual(d.parts.map(p => String(p.part_number)), ['9999'],
      'Die Set-Teile-Wand findet die BrickLink-Nummer nicht — sie zeigt sie ' +
      'aber an (blNummerSql als part_number)');
  });
});
