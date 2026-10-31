/**
 * Mengenänderungen von zwei Geräten zugleich gehen nicht verloren: Ein
 * relativer Schritt (quantity_delta) zählt, und die Menge wird erst in der
 * Sperre gelesen.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in updateSet die Zielmenge aus dem Blick vorab statt in der Sperre
 *      genommen → rot: „zwei gleichzeitige +1 ergeben +2“ (3 statt 4)
 *   B  quantity_delta ignoriert (wie vor der Änderung) → rot: alle drei Fälle
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltSet, mengeVon } = require('./helpers/bestand');

test('Mengenänderung ohne verlorene Zugänge', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NAME = `delta-${process.pid}`, SN = `31170-${process.pid % 1000}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  // Ein Marktpreis im Cache: Der Zugang braucht ihn, und so fragt niemand BrickLink.
  await db.run('DELETE FROM price_cache WHERE set_number = $1', [SN]);
  await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, avg_price, qty_avg_price, total_quantity)
                VALUES ($1, 'N', 'EUR', 50, 50, 3)`, [SN]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SN]);
    await db.pool.end().catch(() => {});
  });
  const { updateSet } = _req('src/sets/setService.js');

  await t.test('zwei gleichzeitige +1 ergeben +2', async () => {
    await haeltSet(db, uid, SN, 2, { preis: 40 });
    await Promise.all([updateSet(uid, SN, { quantity_delta: 1 }), updateSet(uid, SN, { quantity_delta: 1 })]);
    assert.equal(await mengeVon(db, [uid], SN), 4);
  });

  await t.test('ein Schritt nach unten nimmt genau eines weg', async () => {
    const r = await updateSet(uid, SN, { quantity_delta: -1 });
    assert.equal(r.quantity, 3);
  });

  await t.test('ein ungültiger Schritt wird abgewiesen', async () => {
    await assert.rejects(updateSet(uid, SN, { quantity_delta: 1.5 }), (e) => e.status === 400);
  });
});
