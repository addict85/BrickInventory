/**
 * Was der CSV-Export schreibt, liest der Import wieder ein — für Sets, Teile
 * und Figuren. Geprüft am Rundlauf selbst: Konto A erfasst, exportiert;
 * die Datei geht in Konto B (Sets: durch den Zeilenleser des Imports), und
 * Menge, Preis, Zustand, Farbe und Datum kommen unverändert an.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in importiereTeileCsv() die Farbe nicht mehr lesen (immer KEINE_FARBE)
 *      → rot: „Teile kommen unverändert an“ (color_id 4 → 9999)
 *   B  in csvGemeinsameFelder() acquired_at nicht mehr lesen → rot: „Teile …“
 *      und „Figuren …“ (Datum des Imports statt des Kaufs)
 *   C  in setCsvZeilen() den Zustand nicht mehr lesen → rot: „Sets …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('CSV-Rundlauf: Export und Import passen zueinander', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const konto = async (n) => {
    await db.run('DELETE FROM users WHERE username=$1', [`${n}-${process.pid}`]);
    return (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [`${n}-${process.pid}`])).id;
  };
  const A = await konto('rundlauf-a'), B = await konto('rundlauf-b');
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[A, B]]);
    await db.pool.end().catch(() => {});
  });
  for (const u of [A, B]) await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')`, [u]);

  // Konto A: je Art zwei Käufe mit allen Feldern, die der Export kennt.
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,'RL3001',4,'manual')`, [A]);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES ('RL3001',4,'Red')
                ON CONFLICT (part_number, color_id) DO NOTHING`);
  await db.run(`INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, currency, created_at)
                VALUES ($1,'RL3001',4,3,0.15,'U','CHF','2026-02-01T12:00:00Z'), ($1,'RL3001',4,2,0.2,'N','CHF','2026-03-05T12:00:00Z')`, [A]);
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,'fig-rl001','manual')`, [A]);
  await db.run(`INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, currency, created_at)
                VALUES ($1,'fig-rl001',1,12.5,'N','CHF','2026-01-10T12:00:00Z')`, [A]);
  await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1,'RL10001-1')`, [A]);
  await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
                VALUES ($1,'RL10001-1',2,99.9,'U','CHF','2025-12-24T12:00:00Z')`, [A]);

  const { buildPartsCsv, buildFigsCsv } = _req('utils/bestandExport.js');
  const { buildSetsCsv } = _req('utils/setService.js');
  const { importiereTeileCsv } = _req('utils/manuelleTeile.js');
  const { importiereFigurenCsv } = _req('utils/manuelleFiguren.js');
  const { setCsvZeilen } = _req('utils/dienste/sets.js');

  const erfassungen = (tabelle, nummer, farbe, u) => db.all(
    `SELECT ${nummer}${farbe ? ', color_id' : ''}, quantity, ${tabelle === 'set_acquisitions' ? 'purchase_price' : 'unit_price'}::text AS preis,
            condition, tag::text AS tag
       FROM ${tabelle} WHERE user_id=$1 ORDER BY tag, condition`, [u]);

  await t.test('Teile kommen unverändert an', async () => {
    const r = await importiereTeileCsv(B, await buildPartsCsv(A));
    assert.equal(r.errors, 0, JSON.stringify(r.results));
    assert.deepEqual(await erfassungen('part_acquisitions', 'part_number', true, B),
                     await erfassungen('part_acquisitions', 'part_number', true, A));
  });

  await t.test('Figuren kommen unverändert an', async () => {
    const r = await importiereFigurenCsv(B, await buildFigsCsv(A));
    assert.equal(r.errors, 0, JSON.stringify(r.results));
    assert.deepEqual(await erfassungen('minifig_acquisitions', 'fig_number', false, B),
                     await erfassungen('minifig_acquisitions', 'fig_number', false, A));
  });

  await t.test('Sets: der Zeilenleser des Imports liest jede Spalte des Exports', async () => {
    const { rows } = setCsvZeilen(await buildSetsCsv(A));
    assert.deepEqual(rows, [{ sn: 'RL10001-1', qty: 2, purchasePrice: 99.9, condition: 'U', acquiredAt: '2025-12-24' }]);
  });
});
