/**
 * Die Teileliste lässt sich ohne Farbgruppen zeigen: nach Name oder nach
 * Menge. Der Server sortiert in beiden Wegen (Live-Abfrage und
 * Zusammenfassung, einzeln und im Haushalt) gleich, und die Oberfläche
 * zeichnet ungruppiert keine Farbkacheln.
 *
 * Die drei Teile sind so gewählt, dass jede Reihenfolge eine andere ist:
 *   Farbe: Blau 3002, Gelb 3003, Rot 3001
 *   Name:  Axle 3003, Brick 3001, Plate 3002
 *   Menge: 3001 (9), 3003 (7, im Haushalt 8), 3002 (1)
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
const PS = _req('utils/partsSummary.js');

const U = 990611, U2 = 990612;

test('Reihenfolge der Teileliste', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const aufraeumen = async () => {
    for (const tab of ['parts', 'sets', 'parts_summary', 'parts_summary_state'])
      await db.run(`DELETE FROM ${tab} WHERE user_id = ANY($1)`, [[U, U2]]);
    await db.run(`DELETE FROM set_teile WHERE set_number IN ('ORD-1', 'ORD-2')`);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[U, U2]]);
  };
  await aufraeumen();
  t.after(async () => { await aufraeumen().catch(() => {}); await db.pool.end().catch(() => {}); });

  for (const [id, name] of [[U, 'ordnung_a'], [U2, 'ordnung_b']])
    await db.run('INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)', [id, name, 'x']);
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('3001','Brick'),('3002','Plate'),('3003','Axle')
                ON CONFLICT (part_number) DO UPDATE SET part_name = EXCLUDED.part_name, name_von = NULL`);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES ('3001',5,'Rot'),('3002',1,'Blau'),('3003',3,'Gelb')
                ON CONFLICT (part_number, color_id) DO UPDATE SET color_name = EXCLUDED.color_name`);
  await haeltSet(db, U, 'ORD-1', 1);
  await haeltTeil(db, U, '3001', { setNumber: 'ORD-1', menge: 9, colorId: 5 });
  await haeltTeil(db, U, '3002', { setNumber: 'ORD-1', menge: 1, colorId: 1 });
  await haeltTeil(db, U, '3003', { setNumber: 'ORD-1', menge: 7, colorId: 3 });
  // Im Haushalt hat das zweite Konto dasselbe Teil: Die Menge muss summiert sortieren.
  await haeltSet(db, U2, 'ORD-2', 1);
  await haeltTeil(db, U2, '3003', { setNumber: 'ORD-2', menge: 1, colorId: 3 });

  const ERWARTET = { farbe: ['3002', '3003', '3001'], name: ['3003', '3001', '3002'], menge: ['3001', '3003', '3002'] };
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
    assert.deepEqual(reihe(await H.getParts(U, abfrage('; DROP TABLE parts'))), ['3002', '3003', '3001']);
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
