/**
 * Die Farbe eines manuell erfassten Teils NACHTRÄGLICH ändern.
 *
 * ── Marcos Bitte ────────────────────────────────────────────────────────────
 *
 *   „Ich habe mehrere wanted listen importiert. Die Farbe wurde nicht immer
 *    übernommen und die Teile sind nun mehrfach vorhanden (bsp 3001). … Weiter
 *    möchte ich die Farbe nachträglich anpassen können für den Fall dass diese
 *    nicht korrekt geladen wurde."
 *
 * Der Import erfindet seit dem 19.10. keine Farbe mehr (utils/wantedListe.ts).
 * Marcos BESTEHENDER Bestand trägt die falschen Farben aber schon — dieser Weg
 * ist der, auf dem er sie geradezieht, OHNE die Erfassungshistorie zu
 * verlieren. Löschen und neu erfassen wäre der Preis dafür gewesen.
 *
 * ── Warum der schwierige Fall der Normalfall ist ────────────────────────────
 *
 * Bei Marco steht dasselbe Teil DANEBEN schon in der richtigen Farbe — das war
 * ja sein Befund. Die Korrektur läuft also fast immer auf ein
 * ZUSAMMENLEGEN hinaus, nicht auf einen Umzug. Beides hat seinen eigenen
 * eindeutigen Index, an dem ein naives UPDATE abbricht:
 *
 *     idx_parts_eindeutig   (user_id, set_number, part_number, color_id)
 *     idx_part_acq_tag_zustand      (user_id, part_number, color_id, Tag)
 *
 * Der zweite ist der unangenehmere: Er schlägt nur zu, wenn beide Farben am
 * GLEICHEN Tag erfasst wurden. Ein Fehler, der von der Uhr abhängt — deshalb
 * hat er hier einen eigenen Fall.
 *
 * ── Gegenproben (am 19.10. GEMESSEN, Zahlen abgeschrieben) ──────────────────
 *
 * Ausgangslage: `# pass 8 / # fail 0` (vor den drei Bild-Fällen vom 20.10.,
 * seither `# pass 11 / # fail 0`). Jede Gegenprobe ist EINE Änderung,
 * danach zurückgenommen (die Dateien wurden gegen ihre Sicherung verglichen).
 *
 *   A  das Addieren gleicher Tage weggelassen (`vereint = { changes: 0 }`,
 *      UPDATE und DELETE davor gestrichen)
 *      → `pass 6 / fail 2`. Rot ist genau Fall 3, mit dem echten Grund:
 *        `500 duplicate key value violates unique constraint
 *        "idx_part_acq_tag_zustand"`.
 *   B  kein Zusammenlegen der Bestandszeilen (immer `UPDATE parts SET
 *      color_id`)
 *      → `pass 4 / fail 4`. Rot sind die Fälle 2, 3 und 4, alle drei mit
 *        `duplicate key value violates unique constraint
 *        "idx_parts_eindeutig"` — jeder Fall, in dem die Zielfarbe schon
 *        dasteht. Marcos Normalfall.
 *   C  merkeTeilFarbe() nicht gerufen
 *      → `pass 6 / fail 2`. Rot ist Fall 1: „Der Farbkatalog nennt die Farbe
 *        „undefined" — erwartet „Red" aus rb_colors". Das ist der Farbpunkt
 *        ohne Beschriftung.
 *   D  in der Route `V.colorId(req.body?.color_id)` statt der Absage
 *      → `pass 6 / fail 2`. Rot ist Fall 5: Status 200 statt 400 — die
 *        fehlende Farbe wurde zur 0.
 *   E  `AND source = 'manual'` aus der Quellabfrage entfernt
 *      → `pass 6 / fail 2`. Rot ist Fall 6: Status 200, das Set-Teil wurde
 *        umgefärbt.
 *   F  die Abkürzung `if (alt === neu)` entfernt
 *      → `pass 6 / fail 2`. Rot ist Fall 7, und das Gemessene ist schlimmer
 *        als die Zahl: Die Zeile findet sich SELBST als Ziel, addiert ihre
 *        Erfassung auf sich (`vereint: 1`, Menge 5 → 10) und löscht sich
 *        danach als „Quelle". Am laufenden Server mit einem Teil in Farbe 4,
 *        Menge 5, und dem Aufruf 4 → 4:
 *
 *            vorher  parts: [ { color_id: 4 } ]   erf: [ { 4, 5 } ]
 *            nachher parts: [ ]                   erf: [ ]
 *
 *        Ein Verklicken auf dieselbe Farbe hätte das Teil gelöscht.
 *
 * ── Die drei Bild-Fälle, Gegenproben vom 20.10. ─────────────────────────────
 *
 * Marcos Befund: „Wenn ich die Farbe der manuell erfassten Teile ändere wird
 * das Bild nicht aktualisiert." Ausgangslage `# pass 11 / # fail 0`.
 *
 *   G  (entfallen am 28.10.2026: Seit Migration 0062 führen die Setlisten
 *      keine eigenen Bilder mehr, ihre stehen an der Farbe — der Fall
 *      „aus den Set-Teilelisten" ist derselbe wie „vorhanden".)
 *   H  die Frage, ob schon ein Bild dasteht, abgeschaltet
 *      (`if (false && lokal?.bildQuelle === 'farbe')`; am 28.10.2026 neu
 *      gemessen) → `pass 9 / fail 2`. Rot ist „ein schon vorhandenes
 *      Farbbild wird nicht überschrieben": „Die Antwort sagt „null" —
 *      erwartet „vorhanden"". Die Oberfläche hängt ihren Hinweis an diese
 *      Antwort.
 *   I  bei „nichts gefunden" trotzdem `'vorhanden'` gemeldet
 *      → `pass 9 / fail 2`. Rot ist „kennt niemand ein Bild, sagt die Antwort
 *        das": Ein geratenes „vorhanden" nimmt der Oberfläche den Hinweis, und
 *        Marco stünde ein zweites Mal vor einem leeren Platz, ohne zu wissen,
 *        warum.
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

test('die Farbe eines manuellen Teils lässt sich nachträglich ändern',
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

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('marco','x')`);
  const UID = (await db.get(`SELECT id FROM users WHERE username='marco'`)).id;

  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3001','Brick 2x4')`);
  // Farbe 4 steht im Farbkatalog, Farbe 0 ist die, die der Import erfunden
  // hat. rb_colors ist die Quelle, aus der die Änderung Name und Farbcode
  // holt, wenn der Aufrufer keine mitgibt.
  await db.run(`INSERT INTO rb_colors (id,name,rgb,bl_color_id)
                VALUES (4,'Red','C91A09',5), (7,'Blue','0055BF',7)`);

  const { base } = testServer(_req, {
    sitzung: { userId: UID },
    apiNutzer: { user_id: UID, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const aendere = async (nummer, alteFarbe, koerper) => {
    const r = await fetch(`${base}/api/v1/parts/${nummer}/${alteFarbe}/color`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(koerper),
    });
    return { status: r.status, body: await r.json() };
  };
  const bestand = async () => db.all(
    `SELECT color_id, source, storage_id FROM parts WHERE user_id=$1 AND part_number='3001'
      ORDER BY color_id`, [UID]);
  const erfassungen = async () => (await db.all(
    `SELECT color_id, quantity, (created_at AT TIME ZONE 'UTC')::date AS tag
       FROM part_acquisitions WHERE user_id=$1 AND part_number='3001'
      ORDER BY color_id, tag`, [UID]))
    .map(r => ({ farbe: r.color_id, menge: Number(r.quantity), tag: String(r.tag).slice(0, 10) }));
  const leeren = async () => {
    await db.run(`DELETE FROM part_acquisitions`);
    await db.run(`DELETE FROM parts`);
    await db.run(`DELETE FROM part_color_catalog`);
    // Die Set-Teilelisten sind seit dem 20.10. die erste Bildquelle der
    // Farbänderung — ohne Leeren trüge der nächste Fall das Bild des vorigen.
    await db.run(`DELETE FROM set_teile`);
  };
  const farbBild = async (farbe) => db.get(
    `SELECT image_url, image_local FROM part_color_catalog
      WHERE part_number='3001' AND color_id=$1`, [farbe]);

  await t.test('ohne Zielzeile zieht die Zeile samt Erfassungen um', async () => {
    await leeren();
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',0,'manual')`, [UID]);
    await db.run(`INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                  VALUES ($1,'3001',0,10,0.40,'N', NOW() - INTERVAL '2 days')`, [UID]);

    const a = await aendere('3001', 0, { color_id: 4 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.zusammengelegt, false, 'Es gab keine Zielzeile — nichts zusammenzulegen');

    assert.deepEqual((await bestand()).map(r => r.color_id), [4],
      'Nach der Änderung muss GENAU EINE Zeile dastehen, und zwar in Farbe 4');
    assert.deepEqual(await erfassungen(),
      [{ farbe: 4, menge: 10, tag: (await erfassungen())[0].tag }],
      'Die Erfassung muss mitgezogen sein — bleibt sie in Farbe 0 zurück, ist der ' +
      'Kaufpreis vom Teil abgeschnitten und die Stückzahl der neuen Zeile null');

    // Farbbezeichnung und Farbcode: Ohne Katalogeintrag für (3001, 4) zeigt
    // die Teileliste einen Farbpunkt ohne Beschriftung — genau der Zustand,
    // über den Marco sich beim Import beschwert hat. Der Aufrufer hat hier
    // NICHTS mitgegeben; die Werte müssen aus rb_colors kommen.
    const kat = await db.get(
      `SELECT color_name, color_hex FROM part_color_catalog
        WHERE part_number='3001' AND color_id=4`);
    assert.equal(kat?.color_name, 'Red',
      `Der Farbkatalog nennt die Farbe „${kat?.color_name}" — erwartet „Red" aus rb_colors`);
    assert.equal(kat?.color_hex, 'C91A09');
  });

  await t.test('gibt es die Zielfarbe schon, werden die Zeilen zusammengelegt', async () => {
    await leeren();
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',0,'manual'), ($1,'3001',4,'manual')`, [UID]);
    // Verschiedene Tage: idx_part_acq_tag_zustand lässt je Position und Tag nur eine
    // Erfassung zu, der Aufbau wäre sonst nicht herzustellen.
    await db.run(`INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                  VALUES ($1,'3001',0,7,0.40,'N', NOW() - INTERVAL '3 days'),
                         ($1,'3001',4,10,0.50,'N', NOW() - INTERVAL '2 days')`, [UID]);

    const a = await aendere('3001', 0, { color_id: 4 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.zusammengelegt, true,
      'Die Zielfarbe gab es schon — die Antwort muss das sagen, sonst hält der ' +
      'Aufrufer eine Vereinigung für einen Umzug');

    assert.deepEqual((await bestand()).map(r => r.color_id), [4],
      'Das Doppelte ist der ganze Grund für diese Funktion: Danach darf nur ' +
      'die Zeile in Farbe 4 übrig sein');
    const erf = await erfassungen();
    assert.deepEqual(erf.map(e => ({ farbe: e.farbe, menge: e.menge })),
      [{ farbe: 4, menge: 7 }, { farbe: 4, menge: 10 }],
      `Beide Erfassungen müssen in Farbe 4 stehen und BEIDE erhalten bleiben — ` +
      `da steht ${JSON.stringify(erf)}. Zusammen sind es 17 Stück, und keiner ` +
      'der beiden Kaufpreise darf verschwinden.');
  });

  await t.test('zwei Erfassungen vom GLEICHEN Tag werden addiert, nicht abgelehnt', async () => {
    await leeren();
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',0,'manual'), ($1,'3001',4,'manual')`, [UID]);
    await db.run(`INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                  VALUES ($1,'3001',0,7,0.50,'N', NOW()),
                         ($1,'3001',4,10,0.50,'N', NOW())`, [UID]);

    const a = await aendere('3001', 0, { color_id: 4 });
    // Ohne das Addieren VOR dem Umzug läuft das UPDATE in idx_part_acq_tag_zustand
    // und die ganze Anfrage scheitert mit 500 — aber nur an einem Tag, an dem
    // beide Erfassungen zufällig zusammenfallen.
    assert.equal(a.status, 200,
      `Status ${a.status}: ${JSON.stringify(a.body)} — bricht die Anfrage am ` +
      'eindeutigen Tagesindex ab, hängt die Korrektur von der Uhr ab.');
    assert.equal(a.body.vereint, 1, 'Eine Erfassung musste addiert werden');
    assert.deepEqual((await erfassungen()).map(e => ({ farbe: e.farbe, menge: e.menge })),
      [{ farbe: 4, menge: 17 }],
      'Aus 7 und 10 vom gleichen Tag muss EINE Erfassung mit 17 werden — ' +
      'verschwindet eine der beiden, fehlen Marco Stücke.');
  });

  await t.test('verschiedene Preise vom gleichen Tag bleiben eigene Zeilen', async () => {
    await leeren();
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',0,'manual'), ($1,'3001',4,'manual')`, [UID]);
    await db.run(`INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                  VALUES ($1,'3001',0,7,0.40,'N', NOW()),
                         ($1,'3001',4,10,0.50,'N', NOW())`, [UID]);
    const a = await aendere('3001', 0, { color_id: 4 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual((await erfassungen()).map(e => e.menge).sort((x, y) => x - y), [7, 10],
      'Seit Migration 0047 kein Mischpreis: zwei Käufe, zwei Zeilen, zusammen 17');
  });

  await t.test('der Lagerort zieht mit, wenn die Zielzeile keinen hat', async () => {
    await leeren();
    await db.run(`INSERT INTO storage_locations (user_id,name) VALUES ($1,'Kiste 3')`, [UID]);
    const ORT = (await db.get(`SELECT id FROM storage_locations WHERE name='Kiste 3'`)).id;
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,source,storage_id)
                  VALUES ($1,'3001',0,'manual',$2), ($1,'3001',4,'manual',NULL)`, [UID, ORT]);

    assert.equal((await aendere('3001', 0, { color_id: 4 })).status, 200);
    const zeilen = await bestand();
    assert.equal(zeilen.length, 1);
    assert.equal(zeilen[0].storage_id, ORT,
      '„Kiste 3" ist eine Angabe des Menschen und darf durch eine Farbkorrektur ' +
      'nicht verschwinden');
  });

  await t.test('ohne color_id gibt es eine Absage, keine stille 0', async () => {
    await leeren();
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',4,'manual')`, [UID]);
    const a = await aendere('3001', 4, {});
    assert.equal(a.status, 400,
      `Status ${a.status} — fehlt die Farbe, macht V.colorId() daraus eine 0, und ` +
      '0 IST eine Farbe („ohne Angabe"). Das wäre ein stilles Leeren mit ' +
      'Erfolgsmeldung.');
    assert.deepEqual((await bestand()).map(r => r.color_id), [4],
      'Die abgelehnte Anfrage darf nichts geändert haben');
  });

  await t.test('ein Teil AUS EINEM SET bleibt unberührt', async () => {
    await leeren();
    await db.run(`INSERT INTO sets (user_id,set_number) VALUES ($1,'10497-1') ON CONFLICT DO NOTHING`, [UID]);
    await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,source)
                  VALUES ($1,'10497-1','3001',0,'set')`, [UID]);
    const a = await aendere('3001', 0, { color_id: 4 });
    assert.equal(a.status, 404,
      `Status ${a.status} — die Farbe eines Set-Teils kommt aus der Teileliste ` +
      'von Rebrickable. Sie hier zu ändern hiesse, die Teileliste zu ' +
      'bestreiten, und der nächste Set-Import setzte sie zurück.');
    assert.deepEqual((await bestand()).map(r => r.color_id), [0],
      'Das Set-Teil darf nicht angetastet worden sein');
  });

  await t.test('dieselbe Farbe nochmal ist keine Änderung', async () => {
    // Die Gegenrichtung: Die Fälle oben wären auch grün, wenn die Funktion
    // einfach JEDES Mal löschte und neu schriebe. Hier passiert nichts, und
    // die Antwort sagt es.
    await leeren();
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',4,'manual')`, [UID]);
    await db.run(`INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,condition,created_at)
                  VALUES ($1,'3001',4,5,'N', NOW())`, [UID]);
    const a = await aendere('3001', 4, { color_id: 4 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual({ v: a.body.verschoben, u: a.body.vereint, z: a.body.zusammengelegt },
      { v: 0, u: 0, z: false },
      'Gleiche Farbe heisst: nichts verschoben, nichts vereint, nichts zusammengelegt');
    assert.deepEqual((await erfassungen()).map(e => e.menge), [5],
      'Die Erfassung muss unverändert dastehen');
  });

  // ── Das Bild der neuen Farbe (Marcos Befund vom 20.10.) ────────────────────
  //
  // „Wenn ich die Farbe der manuell erfassten Teile ändere wird das Bild nicht
  //  aktualisiert."
  //
  // part_color_catalog führt das Bild je Teil UND Farbe. Vorher schrieb die
  // Änderung die Zielzeile ohne Bild und verliess sich auf einen Job, der
  // dafür nie zuständig war — die Kachel zeigte danach den Platzhalter.

  await t.test('ein schon vorhandenes Farbbild wird nicht überschrieben', async () => {
    await leeren();
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',4,'manual')`, [UID]);
    await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name,image_url)
                  VALUES ('3001',7,'Blue','https://cdn.example/schon-da.jpg')`);

    const a = await aendere('3001', 4, { color_id: 7 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.bild, 'vorhanden',
      `Die Antwort sagt „${a.body.bild}" — erwartet „vorhanden"`);
    assert.equal((await farbBild(7))?.image_url, 'https://cdn.example/schon-da.jpg',
      'Das dastehende Bild gilt. Es bei jeder Farbänderung zu ersetzen hiesse, ' +
      'ein genau für diese Farbe geholtes Bild gegen das erste beliebige aus ' +
      'einer Set-Teileliste zu tauschen.');
  });

  await t.test('kennt niemand ein Bild, sagt die Antwort das — die Farbe ändert sich trotzdem', async () => {
    await leeren();
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',4,'manual')`, [UID]);
    await db.run(`INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,condition,created_at)
                  VALUES ($1,'3001',4,5,'N', NOW())`, [UID]);

    const a = await aendere('3001', 4, { color_id: 7 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    // Ohne Rebrickable-Schlüssel gibt lookupPart() sofort null zurück; in
    // dieser Umgebung gibt es keinen. Gemessen wird also der Fall „nichts
    // gefunden" — und der darf die Änderung NICHT mitnehmen.
    assert.equal(a.body.bild, null,
      `Die Antwort sagt „${a.body.bild}" — erwartet null. Ein geratenes ` +
      '„vorhanden" würde die Oberfläche um ihren Hinweis bringen.');
    assert.deepEqual((await bestand()).map(r => r.color_id), [7],
      'Die Farbe muss geändert sein, auch wenn kein Bild zu finden war — ' +
      'ein fehlendes Bild ist kein Grund, die Korrektur zurückzunehmen');
    assert.deepEqual((await erfassungen()).map(e => ({ farbe: e.farbe, menge: e.menge })),
      [{ farbe: 7, menge: 5 }], 'Die Erfassung zieht mit');
  });
});
