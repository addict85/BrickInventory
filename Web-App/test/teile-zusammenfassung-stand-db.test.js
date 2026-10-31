/**
 * Die Teile-Zusammenfassung veraltet, wenn sich ein kopierter Text ändert:
 * der Name eines Lagerorts oder ein Katalogeintrag.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in 0052 den Trigger auf storage_locations weggelassen → rot: „ein
 *      umbenannter Lagerort entwertet die Zusammenfassung“
 *   B  in ensureFresh den Vergleich des Katalogstands entfernt → rot: „ein
 *      geänderter Teilename entwertet sie ebenso“ (seit Migration 0079: „ein
 *      geänderter Teilename ist sofort nachgezogen“, siehe
 *      teile-katalog-inkrementell-db.test.js)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltSet, haeltTeil } = require('./helpers/bestand');

test('Teile-Zusammenfassung: Stand', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  const PS = _req('src/teile/partsSummary.js');
  const NAME = `stand-${process.pid}`, SN = `31170-${process.pid % 1000}`, TEIL = `stand${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const ort = (await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Kiste 1') RETURNING id`, [uid])).id;
  await haeltSet(db, uid, SN, 1);
  await haeltTeil(db, uid, TEIL, { setNumber: SN, menge: 2, colorId: 4, storageId: ort });
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ($1, 'Alter Name')
                ON CONFLICT (part_number) DO UPDATE SET part_name = 'Alter Name'`, [TEIL]);

  try {
    await t.test('ein umbenannter Lagerort entwertet die Zusammenfassung', async () => {
      await PS.rebuildNow(uid);
      assert.equal(await PS.ensureFresh(uid, { strict: true }), true, 'Vorbedingung: frisch');
      await db.run(`UPDATE storage_locations SET name = 'Regal B' WHERE id = $1`, [ort]);
      assert.equal(await PS.ensureFresh(uid, { strict: true }), false);
      await PS.rebuildNow(uid);
      const z = await db.get('SELECT storage FROM parts_summary WHERE user_id=$1', [uid]);
      assert.equal(z.storage, 'Regal B');
    });

    await t.test('ein geänderter Teilename ist sofort nachgezogen', async () => {
      await PS.rebuildNow(uid);
      assert.equal(await PS.ensureFresh(uid, { strict: true }), true, 'Vorbedingung: frisch');
      await db.run(`UPDATE part_catalog SET part_name = 'Neuer Name' WHERE part_number = $1`, [TEIL]);
      assert.equal(await PS.ensureFresh(uid, { strict: true }), true, 'der Nachzug läuft in ensureFresh');
      assert.equal((await db.get('SELECT part_name FROM parts_summary WHERE user_id=$1', [uid])).part_name, 'Neuer Name');
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.run('DELETE FROM part_catalog WHERE part_number=$1', [TEIL]);
    await db.pool.end().catch(() => {});
  }
});
