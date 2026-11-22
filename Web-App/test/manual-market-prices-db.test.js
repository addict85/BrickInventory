/**
 * Manually captured parts and figures carry their market price along.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, handlerModule, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testData();
const H = handlerModule(_req);
const MF = _req('src/minifigs/queries.js');
const { holdsMinifig, holdsPart } = require('./helpers/inventory');

const U = 990701;
const FIG = 'mp-fig-1',
  TEIL = 'mp-teil-1',
  FARBE = 4;

test('manual lists carry the market price from the cache', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('no test database reachable');
  }

  const aufraeumen = async () => {
    for (const tab of ['parts', 'minifigs']) await db.run(`DELETE FROM ${tab} WHERE user_id=$1`, [U]).catch(() => {});
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [FIG]).catch(() => {});
    await db.run('DELETE FROM part_price_cache WHERE part_number = $1', [TEIL]).catch(() => {});
  };

  try {
    await aufraeumen();
    await db.run("INSERT INTO users (id,username,password_hash) VALUES ($1,'mpreis','x') ON CONFLICT (id) DO NOTHING", [
      U,
    ]);
    // The color must map onto itself, otherwise the
    // cache key lies elsewhere — fetchPartPrice translates both before it reads.
    await db.run(
      "INSERT INTO rb_colors (id,name,bl_color_id) VALUES ($1,'Rot',$1) ON CONFLICT (id) DO UPDATE SET bl_color_id=$1",
      [FARBE],
    );
    // Since migration 0035 the condition stands in the acquisition. This test
    // checks the market price WITHOUT an acquisition, so it stays at the default value
    // 'N' that conditionFromAcquisitions() delivers without acquisitions.
    // bl_fig_number is gone with migration 0037; the same number in both …
    await holdsMinifig(db, U, FIG, { menge: 1 });
    await holdsPart(db, U, TEIL, { menge: 1, colorId: FARBE });

    // ── 2 first: WITHOUT a cache entry ───────────────────────────────────────
    // This order is intended. If it stood at the end, an error in
    // assertion 1 could never reach it — and precisely it protects against
    // the list failing instead of staying empty when a price is missing.
    const figsWithout = await MF.readManualMinifigs([U], U);
    const partsWithout = await H.manualPartsList([U], U);
    assert.equal(figsWithout.length, 1, 'die Figur muss auch ohne Preis in der Liste stehen');
    assert.equal(partsWithout.length, 1, 'das Teil muss auch ohne Preis in der Liste stehen');
    assert.equal(figsWithout[0].avg_price, null, 'ohne Cache-Eintrag bleibt der Marktpreis leer');
    assert.equal(partsWithout[0].avg_price, null, 'ohne Cache-Eintrag bleibt der Marktpreis leer');

    // ── 1. WITH a cache entry ───────────────────────────────────────────────
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number,condition,currency_code,avg_price,qty_avg_price,fetched_at)
                  VALUES ($1,'N','EUR',12.5,12,NOW())`,
      [FIG],
    );
    await db.run(
      `INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price,qty_avg_price,fetched_at)
                  VALUES ($1,$2,'N','EUR',0.75,0.7,NOW())`,
      [TEIL, FARBE],
    );

    const figs = await MF.readManualMinifigs([U], U);
    const teile = await H.manualPartsList([U], U);
    assert.equal(
      Number(figs[0].avg_price),
      12.5,
      `der Marktpreis der Figur fehlt (avg_price=${JSON.stringify(figs[0].avg_price)}) — genau das war Marcos Befund`,
    );
    assert.equal(
      Number(teile[0].avg_price),
      0.75,
      `der Marktpreis des Teils fehlt (avg_price=${JSON.stringify(teile[0].avg_price)})`,
    );
  } finally {
    await aufraeumen();
    await db.run('DELETE FROM users WHERE id=$1', [U]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
