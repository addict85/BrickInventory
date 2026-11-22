/**
 * Newly captured sets do NOT change the percentage of the portfolio curve.
 *
 * Counter-check (carried out): the backfill in src/finances/portfolioHistory.ts
 * removed (first entry again on its own day instead of at the start of the series) →
 * the first substep turns red, with +264 % instead of −0.18 %.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

test('the portfolio percentage measures prices, not additional purchases', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  const NUTZER = `pfz-${process.pid}`;
  const PREFIX = `86${(process.pid % 900) + 100}`;
  const SN = i => `${PREFIX}${String(i).padStart(2, '0')}-1`;

  const aufraeumen = async () => {
    await db.run(`DELETE FROM sets WHERE set_number LIKE $1`, [`${PREFIX}%`]).catch(() => {});
    await db.run(`DELETE FROM price_history WHERE set_number LIKE $1`, [`${PREFIX}%`]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  await aufraeumen();

  const { portfolioHistory } = _req('src/finances/portfolioHistory.js');
  const getSetting = async (_u, k, d) => (k === 'currency' ? 'CHF' : d);
  const kurve = async (period = 'week') => portfolioHistory(uid, [uid], period, db, getSetting);

  /** Create a set and give it a price history from `abTag` days before today. */
  const setWith = async (i, abTag, priceAtStart, priceToday) => {
    await holdsSet(db, uid, SN(i), 0); // quantity 0: the acquisition behind it carries it
    // Until migration 0032 the purchase price stood in the sets row. It now stands
    // in the acquisition — the same number, only in the single place where
    // portfolioHistory.ts still reads it.
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,$2,1,10,'N')`,
      [uid, SN(i)],
    );
    for (let d = abTag; d >= 0; d--) {
      const preis = abTag === 0 ? priceToday : priceAtStart + (priceToday - priceAtStart) * ((abTag - d) / abTag);
      await db.run(
        `INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price,recorded_at)
         VALUES ($1,'N','CHF',$2,$2, CURRENT_DATE - $3::int + interval '9 hours')`,
        [SN(i), preis.toFixed(2), d],
      );
    }
  };

  try {
    // Starting point: two sets with one week of history, price 100 → 110.
    await setWith(1, 6, 100, 110);
    await setWith(2, 6, 100, 110);
    const vorher = await kurve();
    assert.equal(vorher.period_change_pct, 10, `Grundfall stimmt nicht: ${vorher.period_change_pct} statt +10 %`);

    // The case from Marco's screenshot: 24 sets added today
    for (let i = 3; i <= 26; i++) await setWith(i, 1, 50, 50);
    const nachher = await kurve();
    assert.ok(
      nachher.period_change_pct <= vorher.period_change_pct + 0.01,
      `Das Erfassen hat die Prozentzahl ERHÖHT: ${vorher.period_change_pct} → ` +
        `${nachher.period_change_pct}. Genau das war Marcos Befund (+850 %).`,
    );
    assert.ok(
      nachher.period_change_pct >= 0,
      `Zukäufe dürfen das Vorzeichen nicht drehen, war: ${nachher.period_change_pct}`,
    );
    assert.ok(
      nachher.period_change_pct <= 10,
      'Kein Set hat sich um mehr als 10 % bewegt — mehr darf die Summe nicht zeigen',
    );

    // Opposite direction: if a PRICE moves, it must show — otherwise
    // a hard-wired zero would be green too.
    for (let i = 1; i <= 26; i++)
      await db.run(
        `UPDATE price_history SET avg_price = avg_price * 2, qty_avg_price = qty_avg_price * 2
          WHERE set_number=$1 AND recorded_at >= CURRENT_DATE`,
        [SN(i)],
      );
    const risen = await kurve();
    assert.ok(
      risen.period_change_pct > nachher.period_change_pct + 50,
      `Eine Preisverdopplung muss sich zeigen, war: ${risen.period_change_pct}`,
    );

    // And the curve itself must have no jump any more: the first point
    // already contains all 26 sets. Without the backfill only the value of the
    // two old ones would stand there.
    const p = risen.points.map(x => x.value);
    assert.ok(p[0] > 1000, `Der erste Punkt enthält nicht den ganzen Bestand (2×100 + 24×50 = 1400), war: ${p[0]}`);

    // All periods must make the same statement — the monthly resolution
    // (year/max) has its own path for the starting point, and that one has
    // already drifted apart once in this series.
    const values = {};
    for (const per of ['week', 'month', 'year', 'max']) values[per] = (await kurve(per)).period_change_pct;
    const only = [...new Set(Object.values(values))];
    assert.equal(
      only.length,
      1,
      `Die Zeiträume sind sich uneinig: ${JSON.stringify(values)} — bei Daten aus ` +
        'einer einzigen Woche müssen Woche, Monat, Jahr und Max dasselbe zeigen',
    );
  } finally {
    await aufraeumen();
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
