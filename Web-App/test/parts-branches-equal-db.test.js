/**
 * Die Teileliste hat ZWEI Wege — sie müssen dieselben Typen liefern.
 */
require('./helpers/system-frame');
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const { holdsSet, holdsPart } = require('./helpers/inventory');

const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

let db,
  H,
  PS,
  skip = null;
try {
  const _req = require('./helpers/sources').buildAndRequire();
  process.env.DATABASE_URL = DB_URL;
  environment({ SESSION_SECRET: 'test' });
  db = testData();
  H = require('./helpers/sources').handlerModule(_req);
  PS = _req('src/parts/summary.js');
} catch (e) {
  skip = e.message;
}

const U = 990601;

test('beide Wege der Teileliste liefern dieselben Typen', async t => {
  if (skip) return t.skip(skip);
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('keine Test-Datenbank erreichbar');
  }

  const aufraeumen = async () => {
    for (const tab of ['parts', 'sets', 'parts_summary', 'parts_summary_state'])
      await db.run(`DELETE FROM ${tab} WHERE user_id=$1`, [U]).catch(() => {});
    // Die Katalogzeilen haengen an keinem Konto und bleiben sonst stehen.
    await db.run(`DELETE FROM set_parts WHERE set_number='Z-1'`).catch(() => {});
  };

  try {
    await aufraeumen();
    await db.run("INSERT INTO users (id,username,password_hash) VALUES ($1,'zweige','x') ON CONFLICT (id) DO NOTHING", [
      U,
    ]);
    await holdsSet(db, U, 'Z-1', 1);
    // Ein Ersatzteil UND ein gewöhnliches: Wäre nur eines dabei, könnte ein
    // Zweig zufällig richtig liegen, ohne die Umwandlung zu machen.
    // Das Ersatzteilkennzeichen steht seit Migration 0034 in
    // set_parts_catalog — es gehoert zur TEILELISTE eines Sets, nicht zum …
    await db.run(`INSERT INTO set_parts (set_number,part_number,color_id,quantity,is_spare)
                  VALUES ('Z-1','3001',5,3,false),
                         ('Z-1','3002',1,1,true)
                  ON CONFLICT (set_number,part_number,color_id) DO UPDATE SET is_spare=EXCLUDED.is_spare`);
    // Name und Farbbezeichnung: Die Typpruefung unten vergleicht sie zwischen
    // den beiden Zweigen, also muessen sie gefuellt sein.
    await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3001','Brick'),('3002','Plate')
                  ON CONFLICT (part_number) DO NOTHING`);
    await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                  VALUES ('3001',5,'Rot'),('3002',1,'Blau')
                  ON CONFLICT (part_number,color_id) DO NOTHING`);
    await holdsPart(db, U, '3001', { setNumber: 'Z-1', menge: 3, colorId: 5 });
    await holdsPart(db, U, '3002', { setNumber: 'Z-1', menge: 1, colorId: 1 });

    const abfrage = { exclude_manual: '1', page: 1, page_size: 50 };

    // ── Weg 1: die Live-Abfrage (noch keine Zusammenfassung) ───────────────
    const live = await H.partsQuery(U, abfrage);
    assert.equal(live.source, 'db', 'ohne Zusammenfassung muss die Live-Abfrage antworten');

    // ── Weg 2: die Zusammenfassung ─────────────────────────────────────────
    await PS.rebuildNow(U);
    const zsf = await H.partsQuery(U, abfrage);
    assert.equal(zsf.source, 'summary', 'nach dem Aufbau muss die Zusammenfassung antworten');

    // ── Die Regel: gleiche Felder, gleiche Typen ───────────────────────────
    const typ = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    const nach = liste => new Map(liste.map(p => [`${p.part_number}|${p.color_id}`, p]));
    const a = nach(live.parts),
      b = nach(zsf.parts);

    assert.ok(a.size > 0, 'die Live-Abfrage lieferte keine Teile — dann prüft der Vergleich nichts');
    assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), 'beide Wege müssen dieselben Teile liefern');

    const deviations = [];
    for (const [schluessel, links] of a) {
      const rechts = b.get(schluessel);
      for (const feld of Object.keys(links)) {
        if (!(feld in rechts)) continue; // nur Felder, die BEIDE führen
        // null auf einer Seite ist kein Typkonflikt: Ein Feld darf leer sein.
        if (links[feld] === null || rechts[feld] === null) continue;
        if (typ(links[feld]) !== typ(rechts[feld]))
          deviations.push(
            `${schluessel} ${feld}: live=${typ(links[feld])} (${JSON.stringify(links[feld])}), ` +
              `Zusammenfassung=${typ(rechts[feld])} (${JSON.stringify(rechts[feld])})`,
          );
      }
    }
    assert.deepEqual(
      deviations,
      [],
      'Der JSON-Typ eines Feldes darf nicht davon abhängen, welcher Zweig antwortet — ' +
        'ein Client, der den einen Typ erwartet, scheitert sonst genau dann, wenn die ' +
        'Zusammenfassung zum ersten Mal frisch ist:\n  ' +
        deviations.join('\n  '),
    );

    // ── Und is_spare im Besonderen ─────────────────────────────────────────
    // Die Regel oben wäre auch erfüllt, wenn BEIDE Wege eine Zahl lieferten —
    // die Android-App bräuchte dann trotzdem einen Boolean.
    for (const [name, liste] of [
      ['Live-Abfrage', live.parts],
      ['Zusammenfassung', zsf.parts],
    ])
      for (const p of liste)
        assert.equal(
          typeof p.is_spare,
          'boolean',
          `${name}: is_spare ist ${typeof p.is_spare} (${JSON.stringify(p.is_spare)}) statt boolean — ` +
            'genau daran ist die Teileliste der App gescheitert',
        );

    // Und der Wert stimmt auch: 3002 ist das Ersatzteil.
    assert.equal(b.get('3002|1').is_spare, true, 'das Ersatzteil muss als true herauskommen');
    assert.equal(b.get('3001|5').is_spare, false, 'das gewöhnliche Teil muss als false herauskommen');
  } finally {
    await aufraeumen();
    await db.run('DELETE FROM users WHERE id=$1', [U]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
