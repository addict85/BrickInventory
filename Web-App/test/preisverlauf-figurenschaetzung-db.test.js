/**
 * Preisverlauf: ein Punkt je Tag auch für Teile und Figuren. Figurenpreise
 * aus Teilepreisen sind als Schätzung markiert und gelten nie als
 * BrickLink-Preis.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in Migration 0056 die DELETE-Anweisungen entfernt → rot: „die Migration
 *      räumt doppelte Tagespunkte ab …“ (der eindeutige Index scheitert)
 *   B  in fetchMinifigPrice „AND NOT geschaetzt“ entfernt → rot: „eine
 *      Schätzung im Cache gilt nicht als BrickLink-Preis“ (5 statt 20)
 *   C  in schaetzeFigurenpreis die Abdeckung nicht mehr gelesen → rot: „die
 *      Schätzung trägt ihre Abdeckung“
 *
 * BrickLink selbst wird nicht gefragt: https.get ist durch eine Attrappe
 * ersetzt, die immer 20 liefert.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

// @ts-ignore — Attrappe mit genau dem, was clients/bricklink.ts benutzt.
https.get = (_opts, cb) => {
  const req = new EventEmitter();
  setImmediate(() => {
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    cb(res);
    res.emit('data', JSON.stringify({ meta: { code: 200 },
      data: { avg_price: '20.00', qty_avg_price: '19.00', min_price: '15', max_price: '25', total_quantity: '4' } }));
    res.emit('end');
  });
  return req;
};

test('Preisverlauf je Tag und markierte Schätzungen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const ID = String(process.pid);
  const TEIL = `t${ID}`, FIGUR = `sw${ID}`, RBFIGUR = `fig-${ID}`;
  const zugang = ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'];
  const alterZugang = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [zugang]);
  for (const k of zugang)
    await db.run(`INSERT INTO global_settings (key, value) VALUES ($1, 'test')
                  ON CONFLICT (key) DO UPDATE SET value = 'test'`, [k]);
  const aufraeumen = async () => {
    await db.run('DELETE FROM part_price_history WHERE part_number = $1', [TEIL]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = ANY($1)', [[FIGUR, RBFIGUR]]);
    await db.run('DELETE FROM minifig_price_history WHERE fig_number = ANY($1)', [[FIGUR, RBFIGUR]]);
  };
  await aufraeumen();
  t.after(async () => {
    await aufraeumen();
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [zugang]);
    for (const z of alterZugang)
      await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.pool.end().catch(() => {});
  });

  await t.test('ein zweiter Teilepunkt am selben Tag bleibt aus', async () => {
    const neu = (p) => db.run(`INSERT INTO part_price_history (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
      VALUES ($1, 5, 'N', 'EUR', $2, $2) ON CONFLICT DO NOTHING`, [TEIL, p]);
    await neu(1); await neu(2);
    const z = await db.all('SELECT avg_price FROM part_price_history WHERE part_number = $1', [TEIL]);
    assert.deepEqual(z.map(r => Number(r.avg_price)), [1]);
  });

  await t.test('die Migration räumt doppelte Tagespunkte ab und behält den ersten', async () => {
    const sql = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '0056-preisverlauf-je-tag.sql'), 'utf8');
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DROP INDEX idx_part_price_history_tag');
      await c.query('DROP INDEX idx_minifig_price_history_tag');
      for (const [p, zeit] of [[3, '08:00'], [4, '12:00']])
        await c.query(`INSERT INTO part_price_history (part_number, color_id, condition, currency_code, avg_price, qty_avg_price, recorded_at)
          VALUES ($1, 7, 'N', 'EUR', $2, $2, $3)`, [TEIL, p, `2026-01-02T${zeit}:00Z`]);
      for (const [p, zeit] of [[6, '09:00'], [5, '07:00']])
        await c.query(`INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
          VALUES ($1, 'N', 'EUR', $2, $2, $3)`, [FIGUR, p, `2026-01-02T${zeit}:00Z`]);
      await c.query(sql);
      const teile = await c.query(`SELECT avg_price FROM part_price_history WHERE part_number = $1 AND color_id = 7`, [TEIL]);
      const figuren = await c.query(`SELECT avg_price FROM minifig_price_history WHERE fig_number = $1`, [FIGUR]);
      assert.deepEqual(teile.rows.map(r => Number(r.avg_price)), [3]);
      assert.deepEqual(figuren.rows.map(r => Number(r.avg_price)), [5]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  });

  await t.test('eine Schätzung im Cache gilt nicht als BrickLink-Preis', async () => {
    await db.run(`INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, geschaetzt, abdeckung)
      VALUES ($1, 'N', 'EUR', 5, 5, TRUE, 0.5)`, [FIGUR]);
    const { fetchMinifigPrice } = _req('utils/financeCalc.js');
    const p = await fetchMinifigPrice(FIGUR, 'N', 'EUR', 24);
    assert.equal(Number(p.avg_price), 20);
    const zeile = await db.get('SELECT geschaetzt, abdeckung FROM minifig_price_cache WHERE fig_number = $1', [FIGUR]);
    assert.equal(zeile.geschaetzt, false, 'der echte Preis trägt noch die Schätzmarke');
    assert.equal(zeile.abdeckung, null);
  });

  await t.test('die Schätzung trägt ihre Abdeckung', async () => {
    await db.run(`INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, geschaetzt, abdeckung)
      VALUES ($1, 'N', 'EUR', 8, 8, TRUE, 0.75)`, [RBFIGUR]);
    const { schaetzeFigurenpreis } = _req('utils/marketPrice.js');
    const s = await schaetzeFigurenpreis(RBFIGUR, 0, 'N');
    assert.deepEqual(s, { preis: 8, abdeckung: 0.75 });
  });
});
