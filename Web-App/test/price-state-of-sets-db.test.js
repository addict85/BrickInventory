/**
 * Marktpreis und Preisverlauf eines Sets nehmen den Zustand DES SETS, nicht den
 * globalen Standard ('U'): Ein neu gekauftes Set zeigte sonst den Gebrauchtpreis und
 * eine erfundene Entwicklung. Gegen die echten Routen; ersetzt zwei Quelltextprüfungen
 * aus set-condition-aggregate.test.js.
 *
 * Gegenproben (15.11.2026 gemessen):
 *   A  in src/sets/prices.ts (setPrice) `await sk.finances.setState(blickfeld, sn)`
 *      durch 'U' ersetzt → rot: „/price nimmt den Neupreis“ (50 statt 100)
 *   B  in src/finances/priceHistory.ts (priceHistorySet) den Zustand fest auf
 *      DEFAULT_PRICE_CONDITION gesetzt → rot: „/price-history im Zustand des Sets“ ('U')
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

test('Preis und Verlauf eines neuen Sets kommen im Zustand N', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = 'preiszustand-n',
    SET = '42201-1';
  await db.run(`DELETE FROM users WHERE username = $1`, [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  await db.run(
    `INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')
       ON CONFLICT (user_id, key) DO UPDATE SET value = 'CHF'`,
    [uid],
  );
  await db.run(`DELETE FROM price_cache WHERE set_number = $1`, [SET]);
  await db.run(`DELETE FROM price_history WHERE set_number = $1`, [SET]);
  await holdsSet(db, uid, SET, 0);
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, purchase_price, condition, quantity) VALUES ($1, $2, 90, 'N', 1)`,
    [uid, SET],
  );
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
     VALUES ($1, 'N', 'CHF', 90, 100, 110, 100, 3, NOW()), ($1, 'U', 'CHF', 40, 50, 60, 50, 3, NOW())`,
    [SET],
  );
  await db.run(
    `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
     SELECT $1, c, 'CHF', p, p, (CURRENT_DATE - d)::timestamptz
       FROM (VALUES ('N', 100), ('U', 50)) AS z(c, p), generate_series(1, 5) d`,
    [SET],
  );
  const { base, srv } = testServer(_req, { sitzung: { userId: uid, username: NAME, isAdmin: false }, t });
  try {
    let j = await (await fetch(`${base}/api/v1/sets/${SET}/price`)).json();
    assert.equal(j.avg_price, 100, '/price nimmt den Neupreis');
    j = await (await fetch(`${base}/api/v1/sets/${SET}/price-history`)).json();
    assert.equal(j.success, true);
    assert.equal(j.condition, 'N', '/price-history im Zustand des Sets');
  } finally {
    await db.run(`DELETE FROM users WHERE username = $1`, [NAME]);
    await db.run(`DELETE FROM price_cache WHERE set_number = $1`, [SET]);
    await db.run(`DELETE FROM price_history WHERE set_number = $1`, [SET]);
    await new Promise(r => srv.close(r));
    await db.pool.end();
  }
});
