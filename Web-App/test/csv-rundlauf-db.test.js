/**
 * Was der CSV-Export schreibt, liest der Import wieder ein — für Sets, Teile
 * und Figuren. Geprüft am Rundlauf selbst: Konto A erfasst, exportiert;
 * die Datei geht in Konto B (Sets: durch den Zeilenleser des Imports), und
 * Menge, Preis, Zustand, Farbe und Datum kommen unverändert an.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in importPartsCsv() die Farbe nicht mehr lesen (immer KEINE_FARBE)
 *      → rot: „Teile kommen unverändert an“ (color_id 4 → 9999)
 *   B  in csvSharedFields() acquired_at nicht mehr lesen → rot: „Teile …“
 *      und „Figuren …“ (Datum des Imports statt des Kaufs)
 *   C  in setCsvRows() den Zustand nicht mehr lesen → rot: „Sets …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('CSV-Rundlauf: Export und Import passen zueinander', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const konto = async n => {
    await db.run('DELETE FROM users WHERE username=$1', [`${n}-${process.pid}`]);
    return (
      await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [`${n}-${process.pid}`])
    ).id;
  };
  const A = await konto('rundlauf-a'),
    B = await konto('rundlauf-b');
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[A, B]]);
    await db.pool.end().catch(() => {});
  });
  for (const u of [A, B])
    await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')`, [u]);

  // Konto A: je Art zwei Käufe mit allen Feldern, die der Export kennt.
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,'RL3001',4,'manual')`, [A]);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES ('RL3001',4,'Red')
                ON CONFLICT (part_number, color_id) DO NOTHING`);
  await db.run(
    `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, currency, created_at)
                VALUES ($1,'RL3001',4,3,0.15,'U','CHF','2026-02-01T12:00:00Z'), ($1,'RL3001',4,2,0.2,'N','CHF','2026-03-05T12:00:00Z')`,
    [A],
  );
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,'fig-rl001','manual')`, [A]);
  await db.run(
    `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, currency, created_at)
                VALUES ($1,'fig-rl001',1,12.5,'N','CHF','2026-01-10T12:00:00Z')`,
    [A],
  );
  await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1,'RL10001-1')`, [A]);
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
                VALUES ($1,'RL10001-1',2,99.9,'U','CHF','2025-12-24T12:00:00Z')`,
    [A],
  );

  const { partsCsv, figurenCsv } = _req('src/bestand/bestandExport.js');
  const { setsAlsCsv } = require('./helpers/sources').areaPage('sets');
  const { importPartsCsv } = _req('src/parts/manualParts.js');
  const { importMinifigsCsv } = _req('src/minifigs/manualMinifigs.js');
  const { setCsvRows } = require('./helpers/sources').areaPage('sets');

  const erfassungen = (tabelle, nummer, farbe, u) =>
    db.all(
      `SELECT ${nummer}${farbe ? ', color_id' : ''}, quantity, ${tabelle === 'set_acquisitions' ? 'purchase_price' : 'unit_price'}::text AS preis,
            condition, day::text AS tag
       FROM ${tabelle} WHERE user_id=$1 ORDER BY day, condition`,
      [u],
    );

  await t.test('Teile kommen unverändert an', async () => {
    const r = await importPartsCsv(B, await partsCsv(A));
    assert.equal(r.errors, 0, JSON.stringify(r.results));
    assert.deepEqual(
      await erfassungen('part_acquisitions', 'part_number', true, B),
      await erfassungen('part_acquisitions', 'part_number', true, A),
    );
  });

  await t.test('Figuren kommen unverändert an', async () => {
    const r = await importMinifigsCsv(B, await figurenCsv(A));
    assert.equal(r.errors, 0, JSON.stringify(r.results));
    assert.deepEqual(
      await erfassungen('minifig_acquisitions', 'fig_number', false, B),
      await erfassungen('minifig_acquisitions', 'fig_number', false, A),
    );
  });

  await t.test('Sets: der Zeilenleser des Imports liest jede Spalte des Exports', async () => {
    const { rows } = setCsvRows(await setsAlsCsv(A));
    assert.deepEqual(rows, [
      { sn: 'RL10001-1', qty: 2, zeile: 2, purchasePrice: 99.9, condition: 'U', acquiredAt: '2025-12-24' },
    ]);
  });
});
