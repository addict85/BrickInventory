/**
 * Price history: one point per day for parts and figures too. Figure prices
 * from part prices are marked as an estimate and never count as a
 * BrickLink price.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  the DELETE statements removed in migration 0056 → red: “the migration
 *      clears duplicate daily points …” (the unique index fails)
 *   B  „AND NOT estimated“ removed in fetchMinifigPrice → red: “an
 *      estimate in the cache does not count as a BrickLink price” (5 instead of 20)
 *   C  in estimateMinifigsPrice the coverage no longer read → red: “the
 *      estimate carries its coverage”
 *
 * BrickLink itself is not asked: https.get is replaced by a dummy
 * that always delivers 20.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

// @ts-expect-error — dummy with exactly what clients/bricklink.ts uses.
https.get = (_url, _opts, cb) => {
  const req = new EventEmitter();
  setImmediate(() => {
    cb(
      /** @type {any} */ (
        Object.assign(
          Readable.from([
            JSON.stringify({
              meta: { code: 200 },
              data: {
                avg_price: '20.00',
                qty_avg_price: '19.00',
                min_price: '15',
                max_price: '25',
                total_quantity: '4',
              },
            }),
          ]),
          { statusCode: 200, headers: {} },
        )
      ),
    );
  });
  return req;
};

test('price history per day and marked estimates', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const ID = String(process.pid);
  const TEIL = `t${ID}`,
    FIGUR = `sw${ID}`,
    RBFIGUR = `fig-${ID}`;
  const zugang = ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'];
  const alterAccess = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [zugang]);
  for (const k of zugang)
    await db.run(
      `INSERT INTO global_settings (key, value) VALUES ($1, 'test')
                  ON CONFLICT (key) DO UPDATE SET value = 'test'`,
      [k],
    );
  await _req('src/settings/settings.js').reencryptLegacyGlobalValues();
  const aufraeumen = async () => {
    await db.run('DELETE FROM part_price_history WHERE part_number = $1', [TEIL]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = ANY($1)', [[FIGUR, RBFIGUR]]);
    await db.run('DELETE FROM minifig_price_history WHERE fig_number = ANY($1)', [[FIGUR, RBFIGUR]]);
  };
  await aufraeumen();
  t.after(async () => {
    await aufraeumen();
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [zugang]);
    for (const z of alterAccess)
      await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.pool.end().catch(() => {});
  });

  await t.test('a second part point on the same day stays out', async () => {
    const neu = p =>
      db.run(
        `INSERT INTO part_price_history (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
      VALUES ($1, 5, 'N', 'EUR', $2, $2) ON CONFLICT DO NOTHING`,
        [TEIL, p],
      );
    await neu(1);
    await neu(2);
    const z = await db.all('SELECT avg_price FROM part_price_history WHERE part_number = $1', [TEIL]);
    assert.deepEqual(
      z.map(r => Number(r.avg_price)),
      [1],
    );
  });

  await t.test('the migration clears duplicate daily points and keeps the first', async () => {
    const sql = fs.readFileSync(path.join(ROOT, 'db/migrations/0056-preisverlauf-je-tag.sql'), 'utf8');
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DROP INDEX idx_part_price_history_day');
      await c.query('DROP INDEX idx_minifig_price_history_day');
      for (const [p, zeit] of [
        [3, '08:00'],
        [4, '12:00'],
      ])
        await c.query(
          `INSERT INTO part_price_history (part_number, color_id, condition, currency_code, avg_price, qty_avg_price, recorded_at)
          VALUES ($1, 7, 'N', 'EUR', $2, $2, $3)`,
          [TEIL, p, `2026-01-02T${zeit}:00Z`],
        );
      for (const [p, zeit] of [
        [6, '09:00'],
        [5, '07:00'],
      ])
        await c.query(
          `INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
          VALUES ($1, 'N', 'EUR', $2, $2, $3)`,
          [FIGUR, p, `2026-01-02T${zeit}:00Z`],
        );
      await c.query(sql);
      const teile = await c.query(`SELECT avg_price FROM part_price_history WHERE part_number = $1 AND color_id = 7`, [
        TEIL,
      ]);
      const figuren = await c.query(`SELECT avg_price FROM minifig_price_history WHERE fig_number = $1`, [FIGUR]);
      assert.deepEqual(
        teile.rows.map(r => Number(r.avg_price)),
        [3],
      );
      assert.deepEqual(
        figuren.rows.map(r => Number(r.avg_price)),
        [5],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  });

  await t.test('an estimate in the cache does not count as a BrickLink price', async () => {
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, estimated, coverage)
      VALUES ($1, 'N', 'EUR', 5, 5, TRUE, 0.5)`,
      [FIGUR],
    );
    const { fetchMinifigPrice } = _req('src/finances/financeCalc.js');
    const p = await fetchMinifigPrice(FIGUR, 'N', 'EUR', 24);
    assert.equal(Number(p.avg_price), 20);
    const zeile = await db.get(
      'SELECT estimated AS geschaetzt, coverage AS abdeckung FROM minifig_price_cache WHERE fig_number = $1',
      [FIGUR],
    );
    assert.equal(zeile.geschaetzt, false, 'der echte Preis trägt noch die Schätzmarke');
    assert.equal(zeile.abdeckung, null);
  });

  await t.test('the estimate carries its coverage', async () => {
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, estimated, coverage)
      VALUES ($1, 'N', 'EUR', 8, 8, TRUE, 0.75)`,
      [RBFIGUR],
    );
    const { estimateMinifigsPrice } = _req('src/finances/marketPrice.js');
    const s = await estimateMinifigsPrice(RBFIGUR, 0, 'N');
    assert.deepEqual(s, { preis: 8, abdeckung: 0.75 });
  });
});
