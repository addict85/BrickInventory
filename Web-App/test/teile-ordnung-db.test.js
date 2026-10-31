/**
 * Die Teileliste lässt sich ohne Farbgruppen zeigen: nach Name oder nach
 * Menge. Der Server sortiert in beiden Wegen (Live-Abfrage und
 * Zusammenfassung, einzeln und im Haushalt) gleich, und die Oberfläche
 * zeichnet ungruppiert keine Farbkacheln.
 *
 * Die drei Teile sind so gewählt, dass jede Reihenfolge eine andere ist:
 *   Farbe: Blau ORD2, Gelb ORD3, Rot ORD1
 *   Name:  Axle ORD3, Brick ORD1, Plate ORD2
 *   Menge: ORD1 (9), ORD3 (7, im Haushalt 8), ORD2 (1)
 * Eigene Nummern, damit keine BrickLink-Zuordnung aus anderen Tests greift.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in ordnungSql() den Zweig 'name' entfernt (fällt auf Farbe zurück)
 *      → rot: „der Server sortiert in jedem Weg wie gewählt“ (name)
 *   B  im Haushaltszweig der Zusammenfassung `menge: 'total_quantity'` statt
 *      SUM(…) → rot: „der Server sortiert in jedem Weg wie gewählt“
 *   C  in appendParts() die Weiche für die ungruppierte Liste entfernt
 *      → rot: „ungruppiert zeichnet die Oberfläche keine Farbkacheln“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { haeltSet, haeltTeil } = require('./helpers/bestand');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const H = require('./helpers/sources').handlerModul(_req);
const PS = _req('src/teile/partsSummary.js');

const U = 990611, U2 = 990612;

test('Reihenfolge der Teileliste', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const aufraeumen = async () => {
    for (const tab of ['parts', 'set_acquisitions', 'sets', 'parts_summary', 'parts_summary_state'])
      await db.run(`DELETE FROM ${tab} WHERE user_id = ANY($1)`, [[U, U2]]);
    await db.run(`DELETE FROM set_teile WHERE set_number IN ('ORD-1', 'ORD-2')`);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[U, U2]]);
    for (const tab of ['part_color_catalog', 'part_catalog'])
      await db.run(`DELETE FROM ${tab} WHERE part_number = ANY($1)`, [['ORD1', 'ORD2', 'ORD3']]);
    await db.run(`DELETE FROM bl_zuordnung WHERE rb_id = ANY($1)`, [['ORD1', 'ORD2', 'ORD3']]);
  };
  await aufraeumen();
  t.after(async () => { await aufraeumen().catch(() => {}); await db.pool.end().catch(() => {}); });

  for (const [id, name] of [[U, 'ordnung_a'], [U2, 'ordnung_b']])
    await db.run('INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)', [id, name, 'x']);
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('ORD1','Brick'),('ORD2','Plate'),('ORD3','Axle')
                ON CONFLICT (part_number) DO UPDATE SET part_name = EXCLUDED.part_name, name_von = NULL`);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES ('ORD1',5,'Rot'),('ORD2',1,'Blau'),('ORD3',3,'Gelb')
                ON CONFLICT (part_number, color_id) DO UPDATE SET color_name = EXCLUDED.color_name`);
  await haeltSet(db, U, 'ORD-1', 1);
  await haeltTeil(db, U, 'ORD1', { setNumber: 'ORD-1', menge: 9, colorId: 5 });
  await haeltTeil(db, U, 'ORD2', { setNumber: 'ORD-1', menge: 1, colorId: 1 });
  await haeltTeil(db, U, 'ORD3', { setNumber: 'ORD-1', menge: 7, colorId: 3 });
  // Im Haushalt hat das zweite Konto dasselbe Teil: Die Menge muss summiert sortieren.
  await haeltSet(db, U2, 'ORD-2', 1);
  await haeltTeil(db, U2, 'ORD3', { setNumber: 'ORD-2', menge: 1, colorId: 3 });

  const ERWARTET = { farbe: ['ORD2', 'ORD3', 'ORD1'], name: ['ORD3', 'ORD1', 'ORD2'], menge: ['ORD1', 'ORD3', 'ORD2'] };
  const abfrage = (ordnung) => ({ exclude_manual: '1', page: 1, page_size: 50, ordnung });
  const reihe = (r) => r.parts.map(p => p.part_number);

  await t.test('der Server sortiert in jedem Weg wie gewählt', async () => {
    const ergebnisse = [];
    for (const ordnung of Object.keys(ERWARTET)) {
      await db.run('DELETE FROM parts_summary_state WHERE user_id = ANY($1)', [[U, U2]]);
      await db.run('DELETE FROM parts_summary WHERE user_id = ANY($1)', [[U, U2]]);
      const live = await H.getParts(U, abfrage(ordnung));
      const liveHaushalt = await H.getParts([U, U2], abfrage(ordnung));
      await PS.rebuildNow(U); await PS.rebuildNow(U2);
      const zsf = await H.getParts(U, abfrage(ordnung));
      const zsfHaushalt = await H.getParts([U, U2], abfrage(ordnung));
      for (const [weg, r, quelle] of [['Live', live, 'db'], ['Live Haushalt', liveHaushalt, 'db'],
        ['Zusammenfassung', zsf, 'summary'], ['Zusammenfassung Haushalt', zsfHaushalt, 'summary']])
        ergebnisse.push({ ordnung, weg, quelle: r.source, reihe: reihe(r), erwartet: { quelle, reihe: ERWARTET[ordnung] } });
    }
    assert.deepEqual(ergebnisse.map(e => `${e.ordnung}/${e.weg}: ${e.quelle} ${e.reihe}`),
      ergebnisse.map(e => `${e.ordnung}/${e.weg}: ${e.erwartet.quelle} ${e.erwartet.reihe}`));
  });

  await t.test('ein unbekannter Wert gilt als Farbe', async () => {
    assert.deepEqual(reihe(await H.getParts(U, abfrage('; DROP TABLE parts'))), ['ORD2', 'ORD3', 'ORD1']);
  });

  await t.test('ungruppiert zeichnet die Oberfläche keine Farbkacheln', async () => {
    const teile = [
      { part_number: '3003', part_name: 'Axle', color_id: 3, color_name: 'Yellow', total_quantity: 7 },
      { part_number: '3001', part_name: 'Brick', color_id: 5, color_name: 'Red', total_quantity: 3 },
    ];
    const { w, d, aufrufe } = await oeffneOberflaeche({ '/v1/parts': { success: true, parts: teile, total: 2 } });
    await reiter(w, 'parts');
    await warte(() => d.querySelectorAll('#parts-main .part-card').length === 2);
    assert.equal(d.querySelectorAll('#parts-main .group-hd').length, 2, 'nach Farbe: je Farbe eine Kachel');

    const feld = d.getElementById('parts-ordnung');
    feld.value = 'name';
    feld.dispatchEvent(new w.Event('change'));
    await warte(() => aufrufe.some(a => a.url.includes('ordnung=name')) && d.querySelectorAll('#parts-main .part-card').length === 2);
    assert.equal(d.querySelectorAll('#parts-main .group-hd').length, 0);
    assert.deepEqual([...d.querySelectorAll('#parts-main .part-card .part-num')].map(e => e.textContent), ['3003', '3001']);
    assert.equal(w.localStorage.getItem('bim_teile_ordnung'), 'name', 'die Wahl bleibt im Browser');
    w.close();
  });
});
