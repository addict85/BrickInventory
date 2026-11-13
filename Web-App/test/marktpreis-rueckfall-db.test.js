/**
 * Eine Preiszeile mit avg_price 0 und qty_avg_price > 0 hat EINEN Marktpreis
 * (den Mengenschnitt), und Bewertung, G&V, Wertkurve und Preisverlauf zeigen
 * denselben — für Set, Teil und Figur. Echter Code, echte Datenbank.
 *
 * Gegenproben (13.11.2026 gemessen, jeweils zurückgenommen):
 *   A  marktpreisAus() (src/katalog/bricklinkPreise.ts) nur noch avg_price → rot:
 *      „Bewertung“ (Stückpreis 0 statt 37.5), „G&V“, „Preisverlauf“; Wertkurve grün
 *   B  marktpreisSql() (db/geldSql.ts) nur noch avg_price → rot: „Wertkurve“
 *      (60, der Kaufpreis als Startpunkt, statt 75) und „Preisverlauf“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { zugangOderSkip } = require('./helpers/db');
const { haeltSet, haeltTeil, haeltFigur, katalogSet } = require('./helpers/bestand');

const NAME = `mengenschnitt_${process.pid}`;
const SET = `7${process.pid}2-1`,
  TEIL = `mt${process.pid}`,
  FARBE = 11,
  FIGUR = `mf${process.pid}`;
const SET_PREIS = 37.5,
  TEIL_PREIS = 0.25,
  FIGUR_PREIS = 8;

test('avg_price 0 neben einem Mengenschnitt: überall derselbe Wert', { concurrency: 1 }, async t => {
  const db = await zugangOderSkip(t, _req);
  if (!db) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SET]);
    await db.run('DELETE FROM price_history WHERE set_number = $1', [SET]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = $1', [TEIL]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [FIGUR]);
    await db.pool.end().catch(() => {});
  });
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')`, [uid]);
  await katalogSet(db, SET, { name: SET });
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, fetched_at)
     VALUES ($1, 'N', 'CHF', 30, 0, 45, $2, NOW())`,
    [SET, SET_PREIS],
  );
  await db.run(
    `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
     VALUES ($1, 'N', 'CHF', 0, $2, NOW() - INTERVAL '2 days')`,
    [SET, SET_PREIS],
  );
  await db.run(
    `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price, fetched_at)
     VALUES ($1, $2, 'N', 'CHF', 0, $3, NOW())`,
    [TEIL, FARBE, TEIL_PREIS],
  );
  await db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, fetched_at)
     VALUES ($1, 'N', 'CHF', 0, $2, NOW())`,
    [FIGUR, FIGUR_PREIS],
  );
  await haeltSet(db, uid, SET, 2, { preis: 30 });
  await haeltTeil(db, uid, TEIL, { colorId: FARBE, menge: 4, preis: 0.2 });
  await haeltFigur(db, uid, FIGUR, { menge: 1, preis: 5 });

  const f = _req('src/finanzen/financeCalc.js');

  await t.test('Bewertung', async () => {
    const sets = await f.computeSetsValuation(uid, [uid]);
    const s = sets.sets.find(z => z.set_number === SET);
    assert.equal(s.avg_price, SET_PREIS);
    assert.equal(s.wert_gesamt, 75);
    const teile = await f.computePartsValuation(uid, [uid]);
    assert.equal(teile.parts.find(z => z.part_number === TEIL).avg_price, TEIL_PREIS);
    assert.equal(teile.wert_gesamt, 1);
    const figuren = await f.computeMinifigsValuation(uid, [uid]);
    assert.equal(figuren.figs.find(z => z.fig_number === FIGUR).avg_price, FIGUR_PREIS);
    assert.equal(figuren.wert_gesamt, FIGUR_PREIS);
  });

  await t.test('G&V', async () => {
    const pnl = await f.computePnl(uid, [uid]);
    assert.equal(pnl.sets.find(z => z.set_number === SET).current_price, SET_PREIS);
    // 2 × 37,50 + 4 × 0,25 + 1 × 8
    assert.equal(pnl.totals.grand_total, '84.00');
  });

  await t.test('Wertkurve', async () => {
    const { getPortfolioHistory } = _req('src/finanzen/portfolioHistory.js');
    const kurve = await getPortfolioHistory(uid, [uid], 'month');
    assert.ok(kurve.points.length > 0, 'keine Punkte');
    assert.equal(kurve.points.at(-1).value, 75);
  });

  await t.test('Preisverlauf', async () => {
    const pv = _req('src/finanzen/priceHistory.js');
    assert.equal((await pv.preisverlaufSet([uid], SET, 'CHF')).by_condition.N.market_price, SET_PREIS);
    assert.equal((await pv.preisverlaufTeil([uid], TEIL, FARBE, 'CHF')).by_condition.N.market_price, TEIL_PREIS);
    assert.equal((await pv.preisverlaufFigur([uid], FIGUR, 'CHF')).by_condition.N.market_price, FIGUR_PREIS);
  });
});
