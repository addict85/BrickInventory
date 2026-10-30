/**
 * Ein erneuter Import der Figuren und Teile eines Sets lässt die vorhandenen
 * Bestandszeilen stehen — mit Kennung, Lagerort und Datum —, legt neue an und
 * entfernt nur die weggefallenen. Vorher löschte er alle Set-Zeilen und legte
 * sie neu an; aus {id:1, storage_id:1} wurde {id:2, storage_id:null}.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in importiereFiguren wieder zuerst `DELETE … source='set'` ohne
 *      Bedingung → rot: „die Figur behält Kennung und Lagerort“
 *   B  dasselbe in importiereTeile → rot: „das Teil behält Kennung, Lagerort
 *      und Datum“
 *   C  das gezielte DELETE in importiereFiguren entfernt → rot: „eine
 *      weggefallene Figur geht, eine eingetippte bleibt“
 *   D  in merkeSetTeile das Zusammenfassen je Teil und Farbe entfernt → rot:
 *      „Bau- und Ersatzteil derselben Farbe“ (ON CONFLICT DO UPDATE command
 *      cannot affect row a second time) und als Folge die beiden Teile-Tests
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('erneuter Set-Import behält Lagerort und Kennung', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const { importiereFiguren } = _req('utils/minifigsImport.js');
  const { importiereTeile } = _req('utils/partsImport.js');
  const NAME = `nachimport-${process.pid}`;
  const SN = `8${process.pid % 10000}-1`;
  const INV = 900000000 + (process.pid % 100000);
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const ort = (await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Regal') RETURNING id`, [uid])).id;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, SN]);
  await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ('fig-t1', 'Eins'), ('fig-t2', 'Zwei')
                ON CONFLICT (fig_number) DO UPDATE SET fig_name = EXCLUDED.fig_name`);
  await db.run(`INSERT INTO set_figuren (set_number, fig_number, quantity)
                VALUES ($1, 'fig-t1', 1), ($1, 'fig-t2', 2)`, [SN]);
  await db.run(`INSERT INTO minifigs (user_id, set_number, fig_number, source) VALUES ($1, NULL, 'fig-t9', 'manual')`, [uid]);
  await db.run('INSERT INTO rb_inventories (id, set_num, version) VALUES ($1, $2, 1)', [INV, SN]);
  await db.run(`INSERT INTO rb_inventory_parts (inventory_id, part_num, color_id, quantity, is_spare)
                VALUES ($1, 'tp-1', 1, 4, 0), ($1, 'tp-1', 1, 1, 1), ($1, 'tp-2', 5, 2, 0)`, [INV]);

  const figur = (nr) => db.get('SELECT id, storage_id FROM minifigs WHERE user_id=$1 AND fig_number=$2', [uid, nr]);
  const teil = (nr) => db.get(`SELECT id, storage_id, added_at::text AS added_at FROM parts WHERE user_id=$1 AND part_number=$2`, [uid, nr]);

  try {
    await t.test('die Figur behält Kennung und Lagerort', async () => {
      assert.equal(await importiereFiguren(SN, uid), 2);
      await db.run('UPDATE minifigs SET storage_id=$1 WHERE user_id=$2 AND fig_number=$3', [ort, uid, 'fig-t1']);
      const vorher = await figur('fig-t1');
      assert.equal(vorher.storage_id, ort);
      assert.equal(await importiereFiguren(SN, uid), 2);
      assert.deepEqual(await figur('fig-t1'), vorher);
    });

    await t.test('eine weggefallene Figur geht, eine eingetippte bleibt', async () => {
      await db.run(`DELETE FROM set_figuren WHERE set_number=$1 AND fig_number='fig-t2'`, [SN]);
      assert.equal(await importiereFiguren(SN, uid), 1);
      assert.equal(await figur('fig-t2'), undefined);
      assert.ok(await figur('fig-t1'));
      assert.ok(await figur('fig-t9'), 'die eingetippte Figur ohne Set gehört nicht zum Import');
    });

    await t.test('Bau- und Ersatzteil derselben Farbe', async () => {
      assert.equal(await importiereTeile(SN, uid), 3);
      const liste = await db.get(`SELECT quantity, is_spare FROM set_teile WHERE set_number=$1 AND part_number='tp-1'`, [SN]);
      assert.deepEqual(liste, { quantity: 4, is_spare: 0 }, 'die Bauteilmenge zählt, nicht die Ersatzteile');
    });

    await t.test('das Teil behält Kennung, Lagerort und Datum', async () => {
      await db.run(`UPDATE parts SET storage_id=$1, added_at='2020-01-02T00:00:00Z' WHERE user_id=$2 AND part_number='tp-1'`, [ort, uid]);
      const vorher = await teil('tp-1');
      assert.equal(vorher.storage_id, ort);
      await importiereTeile(SN, uid);
      assert.deepEqual(await teil('tp-1'), vorher);
    });

    await t.test('ein weggefallenes Teil geht', async () => {
      await db.run(`DELETE FROM rb_inventory_parts WHERE inventory_id=$1 AND part_num='tp-2'`, [INV]);
      await importiereTeile(SN, uid);
      assert.equal(await teil('tp-2'), undefined);
      assert.ok(await teil('tp-1'));
    });
  } finally {
    await db.run('DELETE FROM rb_inventory_parts WHERE inventory_id=$1', [INV]);
    await db.run('DELETE FROM rb_inventories WHERE id=$1', [INV]);
    await db.run('DELETE FROM set_figuren WHERE set_number=$1', [SN]);
    await db.run('DELETE FROM set_teile WHERE set_number=$1', [SN]);
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.pool.end().catch(() => {});
  }
});
