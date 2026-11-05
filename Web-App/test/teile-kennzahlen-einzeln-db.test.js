/**
 * Die Kennzahlen „Sorten“ und „Farben“ über der Teileliste zählen auch die
 * einzeln erfassten Teile — auf beiden Wegen (Live-Abfrage und Zusammenfassung).
 * Vorher zeigte ein Konto mit vier einzelnen Teilen in vier Farben „0 / 0“.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  in kennzahlen() (Live) wieder `AND COALESCE(p.source,'set') <> 'manual'`
 *      in die WHERE-Klausel → rot: alle drei, „nur einzelne Teile: 4 Sorten
 *      in 4 Farben“ mit 0 statt 4
 *   B  im Zweig der Zusammenfassung den UNION-Teil mit den einzelnen Teilen
 *      entfernt → rot nur: „gemischt: Zusammenfassung und Live gleich“
 *   C  in der Live-Abfrage das FILTER an total_parts entfernt → rot: alle
 *      drei, zuerst total_parts 100 statt 0 (einzelne Teile doppelt gezählt)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { haeltSet, haeltTeil } = require('./helpers/bestand');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

test('Teile-Kennzahlen mit einzeln erfassten Teilen', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;
  const H = require('./helpers/sources').handlerModul(_req);
  const PS = _req('src/teile/partsSummary.js');
  const A = `kz-einzeln-${process.pid}`, B = `kz-gemischt-${process.pid}`;
  const SN = `KE${process.pid}-1`;
  const TEILE = ['ke1', 'ke2', 'ke3', 'ke4'];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[A, B]]);
  const UA = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [A])).id;
  const UB = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [B])).id;
  for (const nr of TEILE)
    await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ($1, $1) ON CONFLICT DO NOTHING`, [nr]);
  try {
    // Konto A: nur einzelne Teile, vier Sorten in vier Farben.
    for (const [i, nr] of TEILE.entries()) await haeltTeil(db, UA, nr, { colorId: [1, 4, 15, 0][i], menge: 25 });
    // Konto B: ein Set mit ke1/Farbe 1 (×3) und ke2/Farbe 4 (×2), dazu einzeln
    // ke1/Farbe 1 (dieselbe Sorte) und ke3/Farbe 15 (neue Sorte und Farbe).
    await haeltSet(db, UB, SN, 1);
    await haeltTeil(db, UB, 'ke1', { setNumber: SN, colorId: 1, menge: 3 });
    await haeltTeil(db, UB, 'ke2', { setNumber: SN, colorId: 4, menge: 2 });
    await haeltTeil(db, UB, 'ke1', { colorId: 1, menge: 7 });
    await haeltTeil(db, UB, 'ke3', { colorId: 15, menge: 1 });

    await t.test('nur einzelne Teile: 4 Sorten in 4 Farben', async () => {
      const s = await H.getPartsStats(UA);
      assert.equal(s.unique_parts, 4);
      assert.equal(s.unique_colors, 4);
      assert.equal(s.total_parts, 0, 'keine Set-Teile');
      assert.equal(s.manual_parts, 100);
    });
    await t.test('die Gesamtzahl zählt einzelne Teile nicht doppelt', async () => {
      const s = await H.getPartsStats(UB);
      assert.equal(s.total_parts, 5, 'Set-Teile 3 + 2');
      assert.equal(s.manual_parts, 8, 'einzeln 7 + 1');
      assert.equal(s.unique_parts, 3);
      assert.equal(s.unique_colors, 3);
    });
    await t.test('gemischt: Zusammenfassung und Live gleich', async () => {
      const live = await H.getPartsStats(UB);
      await PS.rebuildNow(UB);
      const repo = _req('src/teile/repository/teileListe.js');
      const zsf = await repo.kennzahlen([UB], true);
      assert.deepEqual(zsf, live);
      assert.deepEqual(await H.getPartsStats(UB), live);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[UA, UB]]);
    await db.run('DELETE FROM set_teile WHERE set_number=$1', [SN]);
    await db.run('DELETE FROM part_catalog WHERE part_number = ANY($1)', [TEILE]);
    await db.pool.end().catch(() => {});
  }
});
