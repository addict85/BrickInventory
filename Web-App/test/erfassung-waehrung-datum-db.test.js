/**
 * Eine neue Erfassung trägt den Preis in der Kontowährung, und ein
 * CSV-Datum landet in genau der Erfassung, die der Import anlegt.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in priceForNewAcquisition wieder die globale Währung (`'EUR'` fest)
 *      → rot: „die Mengenerhöhung nimmt den Preis in der Kontowährung“
 *      (500 statt 800)
 *   B  addSetWithDate wieder mit dem nachträglichen UPDATE auf die höchste id
 *      → rot: „das CSV-Datum trifft nur die neue Erfassung“ (der Kauf vom
 *      1.10. stand danach auf dem 5.5.2020)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = _echtesRequire.apply(this, arguments);
  if (typeof name === 'string' && /jobs[/\\]nachErfassung(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => (k === 'zieheNach' || k === 'zieheNachNeuanlage') ? () => {} : t[k] });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltSet } = require('./helpers/bestand');

test('Erfassungen: Kontowährung und CSV-Datum', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NAME = `waehr-datum-${process.pid}`, SN = `31160-${process.pid % 1000}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')`, [uid]);
  await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
  for (const [w, p] of [['EUR', 500], ['CHF', 800]])
    await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                  VALUES ($1,'N',$2,$3,$3,3)`, [SN, w, p]);
  const { updateSet, addSetWithDate } = _req('utils/setService.js');

  try {
    await t.test('die Mengenerhöhung nimmt den Preis in der Kontowährung', async () => {
      await haeltSet(db, uid, SN, 1, { preis: 700, am: '2026-09-01T10:00:00Z' });
      await updateSet(uid, SN, { quantity: 2 });
      const neu = await db.get(
        `SELECT purchase_price, currency, price_estimated FROM set_acquisitions
          WHERE user_id=$1 AND set_number=$2 ORDER BY id DESC LIMIT 1`, [uid, SN]);
      assert.equal(Number(neu.purchase_price), 800);
      assert.equal(neu.currency, 'CHF');
      assert.equal(neu.price_estimated, true);
    });

    await t.test('das CSV-Datum trifft nur die neue Erfassung', async () => {
      await db.run('DELETE FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [uid, SN]);
      await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                    VALUES ($1,$2,1,100,'N',NOW()), ($1,$2,1,50,'N','2026-10-01T12:00:00Z')`, [uid, SN]);
      await addSetWithDate(SN, 1, uid, 100, 'N', '2020-05-05');
      const zeilen = await db.all(
        `SELECT quantity, purchase_price::float AS preis, (created_at AT TIME ZONE 'UTC')::date::text AS tag
           FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY tag`, [uid, SN]);
      const heute = new Date().toISOString().slice(0, 10);
      assert.deepEqual(zeilen, [
        { quantity: 1, preis: 100, tag: '2020-05-05' },
        { quantity: 1, preis: 50, tag: '2026-10-01' },
        { quantity: 1, preis: 100, tag: heute },
      ]);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await db.pool.end().catch(() => {});
  }
});
