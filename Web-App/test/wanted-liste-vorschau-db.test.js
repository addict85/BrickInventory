/**
 * Die Vorschau VOR dem Import — mit Bild, Farbe, Bezeichnung und Korrekturen.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „noch besser wäre wenn es beim Import die zu importierende Liste
 *    vorgängig anzeigen wurde analog der Teileliste mit Bild, Farbe,
 *    Bezeichnung und ich dort noch Korrekturen vornehmen kann oder z.b.
 *    rebrickable ids ergänzen könnte"
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Drei Dinge, und alle drei haben ihren eigenen Weg, lautlos falsch zu sein:
 *
 *   1. Die BESCHREIBUNG. Eine Vorschau, die nur Nummern zeigt, ist keine —
 *      und sie darf nichts erfinden. Was der Katalog nicht kennt, bleibt leer.
 *   2. Die KORREKTUREN. Sie müssen den richtigen Posten treffen. Eine Liste
 *      darf denselben Posten zweimal enthalten; ein Schlüssel aus Nummer und
 *      Farbe träfe dann beide, und die Korrektur landete auf der falschen.
 *   3. Was gemerkt wird. Eine von Hand eingetragene Nummer soll beim nächsten
 *      Import dastehen — aber nur sie, nicht ein Katalogtreffer: Der ist eine
 *      VERMUTUNG, und ihn als Zuordnung einzutragen würde sie zur Abbildung
 *      befördern, ohne dass jemand nachgesehen hat.
 *
 * ── Gegenproben (am 19.10. GEMESSEN, Zahlen abgeschrieben) ──────────────────
 *
 * Ausgangslage `# pass 9 / # fail 0` (acht Unterfälle plus der Rahmen). Jede
 * Gegenprobe ist EINE Änderung, danach zurückgenommen; die Dateien wurden
 * gegen ihre Sicherung verglichen (`diff` sagte identisch).
 *
 *   A  Korrektur über Art+Nummer gesucht statt am Index
 *      → `pass 7 / fail 2`. Rot ist Fall 3: „Menge 2 — korrigiert war Index
 *        1, also der Posten mit 5." Genau der Fehler, um den es geht: In
 *        einer Liste mit zweimal 3001 in Farbe 85 traf die Korrektur den
 *        ersten statt den gemeinten.
 *   B  farbenNachtragen() weggelassen
 *      → `pass 7 / fail 2`. Rot ist Fall 3: „Ohne Nachtragen geht die
 *        eingetragene Farbe ohne Namen an den Anleger" — der Farbpunkt ohne
 *        Beschriftung, wieder.
 *   C  die Gegenprobe der Korrektur (Art und Nummer) weggelassen
 *      → `pass 7 / fail 2`. Rot ist Fall 4: die Korrektur auf einen fremden
 *        Posten wirkt.
 *   D  merkeNummer für JEDE Stufe gerufen, nicht nur für 'korrigiert'
 *      → `pass 7 / fail 2`. Rot ist Fall 5: Ein Katalogtreffer — eine
 *        Vermutung — würde als Zuordnung eingetragen.
 *   E  `opt.vorschau` aus der Abbruchbedingung des Schreibwegs entfernt
 *      → `pass 7 / fail 2`. Rot ist Fall 6: Die Vorschau merkt sich etwas.
 *   F  in beschreibePosten eine Abfrage je Posten davorgesetzt
 *      → `pass 7 / fail 2`. Rot ist Fall 7: „64 Abfragen für 100 Posten."
 *        Diese Gegenprobe hat zuerst NICHTS gemeldet (`pass 9 / fail 0`) —
 *        der Grund und die Lehre stehen bei Fall 7 selbst.
 *   G  Name und Bild nicht in den Bericht gelegt
 *      → `pass 7 / fail 2`. Rot ist Fall 1.
 *
 * Die Zahlen stammen aus dem Lauf mit acht Unterfällen; der damalige Fall 7
 * („der Export erfindet keine BrickLink-Farbe") ist entfallen, weil Marco den
 * Export nicht braucht. Die übrigen Fälle und ihre Gegenproben sind
 * unverändert — nachgerechnet wurde nach dem Ausbau erneut.
 *
 * Am 20.10. ist Fall 2b dazugekommen (Marcos Zustandsspalte). Damit sind es
 * wieder acht Unterfälle, und die Zahlen oben gelten unverändert — NACHGEZÄHLT,
 * nicht angenommen: `# tests 9 / # pass 9`, und der Lauf mit einem absichtlich
 * falschen 2b meldete `pass 7 / fail 2`, also dieselbe Form wie A bis G.
 *
 * Eigene Gegenprobe zu 2b: `standardZustand: await nutzerStandardZustand(uid)`
 * durch das feste `'N'` ersetzt → `pass 7 / fail 2`, rot ist 2b mit
 * „'N' statt 'U' — die Einstellung des Kontos gewinnt".
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
const { importiereWantedListe, beschreibePosten, loeseLokalAuf, leseWantedListe } =
  _req('utils/wantedListe.js');

test.after(async () => { await db.pool.end().catch(() => {}); });

/** Ein ITEM-Block in Marcos Schreibweise (wie in wanted-liste-db.test.js). */
/**
 * `zustand` seit dem 20.10. — vorher stand hier fest `X`.
 *
 * Es gibt einen Zwilling dieses Helfers in test/wanted-liste-db.test.js, der
 * zusaetzlich MAXPRICE kann. Die beiden sind NICHT zusammengelegt: Das waere
 * eine Aenderung an einem gruenen Test ohne Gewinn fuer die Sache hier. Wer
 * einen dritten braucht, legt sie besser zusammen, statt einen dritten zu
 * schreiben.
 *
 * `null` laesst CONDITION ganz weg — das ist der Fall „die Datei sagt nichts",
 * und er ist ein anderer als `X` („egal"), auch wenn beide zum Standard des
 * Kontos fuehren.
 */
function item(typ, id, farbe, menge = 1, zustand = 'X') {
  return `<ITEM>\n<ITEMTYPE>${typ}</ITEMTYPE>\n<ITEMID>${id}</ITEMID>\n` +
    `${farbe === null ? '' : `<COLOR>${farbe}</COLOR>\n`}<MINQTY>${menge}</MINQTY>\n` +
    `${zustand === null ? '' : `<CONDITION>${zustand}</CONDITION>\n`}</ITEM>`;
}
const liste = (...items) => `<INVENTORY>\n${items.join('\n')}\n</INVENTORY>\n`;

test('Vorschau, Korrekturen und Farbübersetzung', { concurrency: 1 }, async (t) => {
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

  // Der Katalog: 3001 kennt der Baum mit Namen und einem Bild je Farbe,
  // 3002 nur über den CSV-Abgleich (rb_parts), 9999 kennt niemand.
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('3001','Brick 2 x 4')`);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url)
                VALUES ('3001',4,'Red','C91A09','https://cdn.example/3001-rot.png')`);
  await db.run(`INSERT INTO rb_parts (part_num, name, part_img_url)
                VALUES ('3002','Brick 2 x 2','https://cdn.example/3002.png')`);
  // bl_color_id: 5 → Rot(4), 11 → Schwarz(0), 7 → Blau(7). Die BrickLink-Farbe
  // 85 ist KEINER zugeordnet — genau Marcos Lage.
  await db.run(`INSERT INTO rb_colors (id, name, rgb, bl_color_id)
                VALUES (4,'Red','C91A09',5), (0,'Black','05131D',11), (7,'Blue','0055BF',7)`);

  await t.test('1. die Vorschau trägt Name, Bild und Farbe — und erfindet nichts', async () => {
    const xml = liste(item('P', '3001', 5, 10), item('P', '3002', 5, 3), item('P', '9999', 5, 1));
    // `vorschau: true` steht AUSDRÜCKLICH da. Die Vorgabe dieser Funktion ist
    // SCHREIBEN (`vorschau: !!opt.vorschau`), und das ist richtig so: Wer sie
    // ruft, hat einen Anleger dabei. Die Entscheidung „Vorschau oder Ernst"
    // trifft die Route aus `?schreiben=1` — nicht ein Vorgabewert hier.
    //
    // Dieser Test hat die Vorgabe zuerst falsch geraten und wurde deshalb rot.
    // Das war nützlich: Fall 6 unten war vorher aus dem falschen Grund grün
    // (ohne Anleger scheitert das Schreiben, und der Rückruf wird nie
    // erreicht) — er hätte eine Vorschau, die sehr wohl schreibt, nicht
    // gemeldet.
    const b = await importiereWantedListe(1, xml, { vorschau: true });
    assert.equal(b.vorschau, true, 'Mit vorschau: true muss es eine Vorschau sein');
    assert.equal(b.angelegt, 0, 'Eine Vorschau schreibt nichts');

    const nach = new Map(b.posten.map(p => [p.blId, p]));
    assert.equal(nach.get('3001').name, 'Brick 2 x 4',
      'Der Name aus part_catalog fehlt — dann zeigt die Vorschau nur Nummern, ' +
      'und Marco kann an Posten 57 nicht erkennen, dass es der falsche Stein ist.');
    assert.equal(nach.get('3001').bild, 'https://cdn.example/3001-rot.png',
      'Das Bild hängt an Teil UND Farbe (ein roter 2x4 sieht anders aus als ein ' +
      'blauer). Hier fehlt das Farbbild.');
    assert.equal(nach.get('3001').farbName, 'Red');
    assert.equal(nach.get('3001').farbHex, 'C91A09');

    // 3002 steht NUR in rb_parts (dem CSV-Abgleich), nicht in part_catalog.
    // Die Auflösung lässt es deshalb OFFEN — Stufe 3 liest part_catalog, und
    // das soll sie: Sie ist eine Vermutung, und sie auf die 50 000 Zeilen von
    // rb_parts auszuweiten hiesse, viel mehr Posten auf eine Vermutung hin
    // anzulegen. Gemessen: `rbId: null, sicherheit: null`.
    //
    // Die BESCHREIBUNG kommt trotzdem — unter der BrickLink-Nummer, und als
    // solche gekennzeichnet. Genau das braucht Marco zum Entscheiden: „9999 —
    // (nichts bekannt)" lässt ihn raten, „3002 — Brick 2 x 2, Name unter der
    // BL-Nummer gefunden" zeigt ihm, worum es geht.
    assert.equal(nach.get('3002').ausgang, 'offen',
      'Stufe 3 liest part_catalog; 3002 steht dort nicht und bleibt offen');
    assert.equal(nach.get('3002').name, 'Brick 2 x 2',
      'Der Rückfall auf rb_parts (CSV-Abgleich) greift nicht — dann bleibt ' +
      'jedes Teil namenlos, das noch in keinem Set war.');
    assert.equal(nach.get('3002').bild, 'https://cdn.example/3002.png',
      'Ohne Farbbild muss das allgemeine Teilebild einspringen');
    assert.equal(nach.get('3002').nameGeraten, true,
      'Der Name wurde unter der BrickLink-Nummer gefunden, nicht über eine ' +
      'Abbildung. Ohne dieses Kennzeichen sieht die Zeile aus wie ein Treffer.');
    assert.equal(nach.get('3001').nameGeraten, false,
      '3001 ist abgebildet — da ist nichts geraten.');

    // 9999 steht in keinem Katalog. Leer ist hier die EHRLICHE Auskunft.
    assert.equal(nach.get('9999').name ?? null, null,
      `Für 9999 steht „${nach.get('9999').name}" da — das kennt kein Katalog ` +
      'dieses Baums. Ein geratener Name ist schlimmer als eine leere Zelle.');
    assert.notEqual(nach.get('9999').nameGeraten, true,
      'Eine leere Zeile „geraten" zu nennen wäre eine Behauptung über nichts');
  });

  await t.test('2. Menge, BL-Farbe und Zustand reisen in die Vorschau mit', async () => {
    // Ohne sie kann die Vorschau die Zeile nicht zeigen — und die Korrektur
    // nicht sagen, welche Farbe gemeint war.
    const b = await importiereWantedListe(1, liste(item('P', '3001', 85, 7)), { vorschau: true });
    const p = b.posten[0];
    assert.equal(p.blFarbe, 85, 'Die BrickLink-Farbnummer aus der Datei fehlt');
    assert.equal(p.menge, 7);
    assert.equal(p.ausgang, 'offen', 'Farbe 85 ist nicht abbildbar — der Posten bleibt offen');
    assert.match(p.grund || '', /BrickLink-Farbe 85/);
  });

  await t.test('2b. der Standardzustand des Kontos reist EINMAL je Bericht mit', async () => {
    // ── Marcos Bitte vom 20.10. ─────────────────────────────────────────────
    //
    //   „ja, bitte die Zustandsspalte noch in die Vorschau"
    //
    // Je Posten steht der Zustand AUS DER DATEI, und der ist bei CONDITION=X
    // und bei fehlender Angabe null. Angelegt wird dann der Standard des
    // Kontos — die Vorschau soll zeigen, was ANGELEGT wird.
    //
    // Der Standard gehoert an den BERICHT, nicht an den Posten: Er ist je
    // Konto derselbe, und 224-mal dieselbe Zeichenkette waere eine Abschrift.
    // Und er kommt vom SERVER, nicht aus dem Browser — dort steht er nirgends
    // verlaesslich, und ein geratener Zustand in einer Vorschau waere genau
    // die Sorte Behauptung, die hier schon einmal falsch war.
    const ohne = await importiereWantedListe(1, liste(item('P', '3001', 5, 1, 'X')),
                                             { vorschau: true });
    assert.equal(ohne.standardZustand, 'N',
      'Ohne Einstellung gilt die Vorgabe des Baums (nutzerStandardZustand)');
    assert.equal(ohne.posten[0].zustand, null,
      'Am POSTEN steht weiterhin, was in der Datei stand — nicht der Standard');

    await db.run(`INSERT INTO user_settings (user_id, key, value)
                  VALUES (1,'user_default_condition','U')
                  ON CONFLICT (user_id, key) DO UPDATE SET value='U'`);
    const mit = await importiereWantedListe(
      1, liste(item('P', '3001', 5, 1, 'N'), item('P', '3001', 5, 1, 'U'),
               item('P', '3001', 5, 1, 'X'), item('P', '3001', 5, 1, null)),
      { vorschau: true });
    assert.equal(mit.standardZustand, 'U', 'Die Einstellung des Kontos gewinnt');
    assert.deepEqual(mit.posten.map(x => x.zustand), ['N', 'U', null, null],
      'N und U bleiben, X bleibt null — der Standard ersetzt sie NICHT im Posten. ' +
      'Die Vorschau setzt beides zusammen (zeile() in public/js/18-wanted-xml.js)');
    await db.run(`DELETE FROM user_settings WHERE user_id=1 AND key='user_default_condition'`);
  });

  await t.test('3. eine Korrektur trifft den Posten am Index, nicht die Nummer', async () => {
    // Dieselbe Nummer und dieselbe Farbe ZWEIMAL — ein Schlüssel aus Art,
    // Nummer und Farbe träfe beide Zeilen.
    const xml = liste(item('P', '3001', 85, 2), item('P', '3001', 85, 5));
    const zaehler = [];
    const b = await importiereWantedListe(1, xml, {
      vorschau: false,
      korrekturen: [{ index: 1, blId: '3001', art: 'part', rbFarbe: 7 }],
      anleger: {
        teil: async (_u, body) => { zaehler.push(body); return { action: 'created' }; },
        figur: async () => ({ action: 'created' }), set: async () => ({ action: 'created' }),
      },
    });
    assert.equal(b.korrekturen?.angewandt, 1, JSON.stringify(b.korrekturen));
    assert.deepEqual(b.korrekturen?.abgewiesen, []);
    assert.equal(zaehler.length, 1,
      `Der Anleger bekam ${zaehler.length} Posten. Genau EINER wurde korrigiert; ` +
      'der andere hat weiterhin keine abbildbare Farbe und muss offen bleiben.');
    assert.equal(zaehler[0].quantity, 5,
      `Menge ${zaehler[0].quantity} — korrigiert war Index 1, also der Posten mit 5. ` +
      'Trifft die Korrektur den ersten, zeigt sie auf die Nummer statt auf den Index.');
    assert.equal(zaehler[0].color_id, 7);
    // Der FARBNAME muss nachgeholt werden: Die Auflösung holt ihn für die
    // Farben aus der DATEI, und 7 stand dort nicht.
    assert.equal(zaehler[0].color_name, 'Blue',
      'Ohne Nachtragen geht die eingetragene Farbe ohne Namen an den Anleger — ' +
      'und das ist genau der Farbpunkt ohne Beschriftung vom 19.10.');
    assert.equal(zaehler[0].color_hex, '0055BF');
    assert.equal(b.posten[1].sicherheit, 'korrigiert',
      'Eine eingetragene Nummer ist nicht „zuordnung" — der Bericht darf nicht ' +
      'behaupten, der Katalog habe geliefert, was jemand getippt hat.');
  });

  await t.test('4. eine Korrektur auf einen fremden Posten wird abgewiesen, nicht angewandt',
    async () => {
    // Der Fall: zwischen Vorschau und Schreiben wurde eine ANDERE Datei
    // gewählt. Ohne die Gegenprobe wirkte die Korrektur auf einen fremden
    // Posten — lautlos, denn beide Zahlen sähen plausibel aus.
    const xml = liste(item('P', '3001', 85, 2));
    const zaehler = [];
    const b = await importiereWantedListe(1, xml, {
      vorschau: false,
      korrekturen: [{ index: 0, blId: '4444', art: 'part', rbFarbe: 7 }],
      anleger: {
        teil: async (_u, body) => { zaehler.push(body); return { action: 'created' }; },
        figur: async () => ({ action: 'created' }), set: async () => ({ action: 'created' }),
      },
    });
    assert.equal(b.korrekturen?.angewandt, 0);
    assert.equal(b.korrekturen?.abgewiesen.length, 1,
      'Die abgewiesene Korrektur muss im Bericht STEHEN — stillschweigend zu ' +
      'übergehen heisst: Marco korrigiert, und nichts passiert.');
    assert.equal(zaehler.length, 0, 'Der Posten hat weiterhin keine Farbe und bleibt offen');
  });

  await t.test('5. nur eine EINGETRAGENE Nummer wird gemerkt, kein Katalogtreffer', async () => {
    const gemerkt = [];
    const anleger = {
      teil: async () => ({ action: 'created' }),
      figur: async () => ({ action: 'created' }), set: async () => ({ action: 'created' }),
    };
    // 3001 löst über den Katalog auf (Stufe 3, eine Vermutung), 9999 nicht.
    // Korrigiert wird 9999 → 3002.
    const xml = liste(item('P', '3001', 5, 1), item('P', '9999', 5, 1));
    const b = await importiereWantedListe(1, xml, {
      vorschau: false, anleger,
      korrekturen: [{ index: 1, blId: '9999', art: 'part', rbId: '3002', rbFarbe: 4 }],
      merkeNummer: async (art, rbId, blId) => { gemerkt.push({ art, rbId, blId }); },
    });
    assert.equal(b.korrekturen?.angewandt, 1, JSON.stringify(b.korrekturen));
    assert.deepEqual(gemerkt, [{ art: 'part', rbId: '3002', blId: '9999' }],
      `Gemerkt wurde ${JSON.stringify(gemerkt)}. Erwartet ist GENAU die ` +
      'eingetragene Zuordnung 9999→3002. Steht 3001 mit dabei, wird ein ' +
      'Katalogtreffer — also eine Vermutung — als Abbildung eingetragen.');
  });

  await t.test('6. eine Vorschau merkt sich nichts', async () => {
    // Die Gegenrichtung zu Fall 5: Ohne diesen Fall wäre er auch grün, wenn
    // schon die Vorschau schriebe. Eine Vorschau, die etwas speichert, ist
    // keine.
    const gemerkt = [];
    // MIT Anleger: Ohne ihn scheitert das Schreiben, und der Rückruf wäre
    // schon deshalb nicht erreicht — der Fall wäre grün, ohne etwas über die
    // Vorschau zu sagen.
    const b = await importiereWantedListe(1, liste(item('P', '9999', 5, 1)), {
      vorschau: true,
      korrekturen: [{ index: 0, blId: '9999', art: 'part', rbId: '3002', rbFarbe: 4 }],
      anleger: {
        teil: async () => ({ action: 'created' }),
        figur: async () => ({ action: 'created' }), set: async () => ({ action: 'created' }),
      },
      merkeNummer: async (...a) => { gemerkt.push(a); },
    });
    assert.equal(b.korrekturen?.angewandt, 1,
      'Vorbedingung: die Korrektur muss greifen, sonst sagt der Fall nichts');
    assert.equal(b.angelegt, 0, 'Eine Vorschau legt nichts an');
    assert.deepEqual(gemerkt, [], 'In der Vorschau darf nichts gemerkt werden');
  });

  await t.test('7. beschreibePosten macht nicht eine Abfrage je Posten', async () => {
    // Marcos Datei hat 224 Zeilen. Eine Abfrage je Zeile wäre eine Vorschau,
    // auf die man wartet.
    //
    // ── Gemessen an pool.query, NICHT an db.all (und das ist tragend) ──────
    //
    // Der erste Entwurf überschrieb `db.all` am Modulobjekt — und war
    // GEMESSEN wirkungslos: Mit 60 zusätzlichen Abfragen je Posten blieb er
    // grün (`pass 9 / fail 0`). Der Grund steckt im Bündler: esbuild macht
    // aus `import * as db from '../db/database'` ein
    // `__toESM(require(...))`, und das KOPIERT die Eigenschaften in ein neues
    // Objekt. Die Funktion in utils/wantedListe.ts ruft also ihre eigene
    // Kopie von `all`, nicht die hier ersetzte.
    //
    // `pool` ist dagegen ein Objekt, und die Kopie trägt dieselbe Referenz —
    // ein Ersatz an `pool.query` ist auf beiden Seiten derselbe. Er zählt
    // ausserdem das Richtigere: wirklich abgeschickte SQL-Anweisungen.
    const echt = db.pool.query.bind(db.pool);
    let abfragen = 0;
    db.pool.query = (...a) => { abfragen++; return echt(...a); };
    try {
      const gelesen = leseWantedListe(liste(
        ...Array.from({ length: 60 }, (_, i) => item('P', `300${i % 10}`, 5, 1)),
        ...Array.from({ length: 20 }, (_, i) => item('M', `fig${i}`, null, 1)),
        ...Array.from({ length: 20 }, (_, i) => item('S', `1049${i}-1`, null, 1)),
      ));
      const auf = await loeseLokalAuf(gelesen.posten);
      abfragen = 0;
      await beschreibePosten(auf);
      assert.ok(abfragen <= 4,
        `${abfragen} Abfragen für 100 Posten. Erlaubt sind höchstens 4 (Teile, ` +
        'Farbbilder, Figuren, Sets). Eine je Posten wären 100.');
    } finally { db.pool.query = echt; }
  });
});
