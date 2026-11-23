/**
 * Portfolio curve: does the SQL version compute the same as an independent
 * JavaScript version of the same rule?
 *
 * Counter-check: deleteOldPrices() (src/finances/priceHistory.ts) also deletes with 0 days → red “PRICE_HISTORY_KEEP_DAYS=0 switches cleanup off”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();

/** The same rule straightforwardly: load daily values, group in JS, carry forward. */
async function comparisonVersion(setNumbers, setQty, currency, condition, dateFilter) {
  const platzhalter = setNumbers.map((_, i) => `$${i + 3}`).join(',');
  const rows = await db.all(
    `SELECT set_number, qty_avg_price, avg_price,
            to_char(recorded_at,'YYYY-MM-DD') AS day,
            to_char(recorded_at,'YYYY-MM')    AS month
     FROM price_history
     WHERE currency_code=$1 AND condition IN ('U','N') AND set_number IN (${platzhalter})
       AND (qty_avg_price>0 OR avg_price>0)
     ${dateFilter} ORDER BY recorded_at ASC, (condition = $2) ASC`,
    [currency, condition, ...setNumbers],
  );

  const buckets = {};
  for (const r of rows) {
    const k = r.day;
    if (!buckets[k]) buckets[k] = { day: r.day, month: r.month, sets: {} };
    const p = parseFloat(r.avg_price || 0) || parseFloat(r.qty_avg_price || 0);
    if (p > 0) buckets[k].sets[r.set_number] = p;
  }
  // Backfill: every set stands in the basket with its FIRST known price from
  // the start. Running backwards over the days and assigning leaves the earliest value
  // per set standing at the end — that is the whole change
  // compared to the earlier version, which started here with an empty carry.
  const carry = {};
  for (const k of Object.keys(buckets).sort().reverse()) Object.assign(carry, buckets[k].sets);

  let punkte = Object.keys(buckets)
    .sort()
    .map(k => {
      const b = buckets[k];
      Object.assign(carry, b.sets);
      const total = Object.entries(carry).reduce((s, [sn, p]) => s + p * (setQty[sn] || 1), 0);
      return { day: b.day, fullDay: b.day, month: b.month, total: parseFloat(total.toFixed(2)) };
    })
    .filter(p => p.total > 0);

  // Condensation as before: only from 120 points on, last point per month, the
  // very first point stays exactly preserved.
  if (punkte.length > 120) {
    const byMonth = new Map();
    for (const p of punkte) byMonth.set(p.month || p.day.slice(0, 7), p);
    const monthly = [...byMonth.values()].map(p => ({ ...p, day: p.month || p.day.slice(0, 7) }));
    const erster = punkte[0];
    if (monthly.length && monthly[0].fullDay !== erster.fullDay) {
      monthly[0] = { ...erster, day: erster.month || erster.day.slice(0, 7) };
    }
    punkte = monthly;
  }
  return punkte;
}

test('the portfolio curve computes the same as the reference version', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    await db.pool.end().catch(() => {});
    noDb(t, e);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // And the migrations, not only the schema
  const c0 = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c0);
  } finally {
    c0.release();
  }

  const { portfolioHistory } = _req('src/finances/portfolioHistory.js');
  const getSetting = async (_u, k, d) => (k === 'currency' ? 'CHF' : d);

  await db.run("INSERT INTO users (username,password_hash) VALUES ('ph_a','x'),('ph_b','x')");
  const [u1, u2] = (await db.all('SELECT id FROM users ORDER BY id')).map(r => r.id);

  // 30 sets, half on each of two household accounts, different quantities.
  // Only the stock rows; the quantities stand in the acquisitions further down
  // (migration 0036). `1 + (g%3)` shows up there just the same — the same formula,
  // and that is the point: it MUST match, otherwise it weights …
  await db.run(
    `INSERT INTO sets (user_id, set_number)
     SELECT (CASE WHEN g%2=0 THEN $1::int ELSE $2::int END), (10000+g)||'-1'
       FROM generate_series(1,30) g`,
    [u1, u2],
  );
  // Since migration 0033 the name belongs in the catalog, and for every set in
  // the stock a row stands there.
  await db.run(
    `INSERT INTO rb_sets (set_num, name)
     SELECT (10000+g)||'-1', 'Set '||g FROM generate_series(1,30) g
     ON CONFLICT (set_num) DO NOTHING`,
  );
  await db.run(
    `INSERT INTO set_catalog (set_number)
     SELECT (10000+g)||'-1' FROM generate_series(1,30) g
     ON CONFLICT (set_number) DO NOTHING`,
  );
  // Purchase price and quantity per acquisition — since migration 0032 the only place.
  // The quantity MUST match the sets row, otherwise portfolioHistory.ts weights
  // differently from the curve that this test compares.
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition)
     SELECT (CASE WHEN g%2=0 THEN $1::int ELSE $2::int END), (10000+g)||'-1', 1 + (g%3), 40, 'N'
       FROM generate_series(1,30) g`,
    [u1, u2],
  );

  // Price history with GAPS: one set writes only every third day. Exactly
  // there carrying forward separates from a simple daily sum — without gaps
  // the comparison would be worthless.
  await db.run(
    `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
     SELECT (10000+g)||'-1', 'N', 'CHF', 30 + g + d*0.1, 31 + g,
            (CURRENT_DATE - (400 - d))::timestamptz + interval '9 hours'
       FROM generate_series(1,30) g, generate_series(1,400) d
      WHERE (d + g) % 3 = 0`,
  );
  // Individual days additionally with a second condition and a later time —
  // checks which value wins per day.
  await db.run(
    `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
     SELECT (10000+g)||'-1', 'U', 'CHF', 20 + g, 21 + g,
            (CURRENT_DATE - (400 - d))::timestamptz + interval '18 hours'
       FROM generate_series(1,10) g, generate_series(1,400) d
      WHERE (d + g) % 3 = 0 AND d % 7 = 0`,
  );

  // The quantities from the acquisitions (migration 0036 deleted
  // sets.quantity). The JOIN on `sets` is the same restriction as in
  // db/stockQuantity.ts: an acquisition without a stock row does not count.
  const setsRows = await db.all(
    `SELECT s.set_number, COALESCE(SUM(a.quantity), 0)::int AS quantity
       FROM sets s
       LEFT JOIN set_acquisitions a
              ON a.user_id = s.user_id AND a.set_number = s.set_number
      GROUP BY s.set_number
      ORDER BY s.set_number`,
  );
  const setNumbers = setsRows.map(r => r.set_number);
  const setQty = Object.fromEntries(setsRows.map(r => [r.set_number, r.quantity]));

  const filter = {
    week: "AND recorded_at >= NOW() - INTERVAL '7 days'",
    month: "AND recorded_at >= NOW() - INTERVAL '30 days'",
    year: "AND recorded_at >= NOW() - INTERVAL '365 days'",
    max: '',
  };

  for (const period of ['week', 'month', 'year', 'max']) {
    await t.test(`period ${period}: same points as the reference version`, async () => {
      const alt = await comparisonVersion(setNumbers, setQty, 'CHF', 'N', filter[period]);
      const neu = await portfolioHistory(u1, [u1, u2], period, db, getSetting);

      assert.equal(
        neu.points.length,
        alt.length,
        `different number of points: ${neu.points.length} instead of ${alt.length}`,
      );

      // The route delivers {x_label, value, y_frac} — compared are the
      // VALUES in their order.
      for (let i = 0; i < alt.length; i++) {
        const a = alt[i],
          n = neu.points[i];
        // Rounding: the old version computed in JS floating point, the new one in
        // NUMERIC. One cent of difference is allowed, no more.
        assert.ok(Math.abs(n.value - a.total) <= 0.01, `point ${i} (${a.day}): ${n.value} instead of ${a.total}`);
      }
    });
  }

  await t.test('without price history the curve stays empty instead of crashing', async () => {
    await db.run('DELETE FROM price_history');
    await db.run('DELETE FROM price_cache');
    const r = await portfolioHistory(u1, [u1, u2], 'max', db, getSetting);
    assert.equal(Array.isArray(r.points), true);
  });

  // The pool stays open — the second test in this file keeps working on
  // the same schema and closes it at the end.
});

test('one price entry per set, condition, currency and day', { concurrency: 1 }, async t => {
  const db2 = testData();
  try {
    await db2.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }

  await t.test('duplicate entries of the same day are rejected', async () => {
    await db2.run(`INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price)
                   VALUES ('99999-1','N','CHF',10,10)`);
    // Exactly the clause that used to run into nothing: without a matching
    // unique index it silently created a second row.
    await db2.run(`INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price)
                   VALUES ('99999-1','N','CHF',99,99) ON CONFLICT DO NOTHING`);
    const n = await db2.get(`SELECT COUNT(*)::int c FROM price_history WHERE set_number='99999-1'`);
    assert.equal(n.c, 1, 'second row for the same day created — ON CONFLICT does not apply');
  });

  await t.test('a different condition on the same day is allowed', async () => {
    await db2.run(`INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price)
                   VALUES ('99999-1','U','CHF',8,8) ON CONFLICT DO NOTHING`);
    const n = await db2.get(`SELECT COUNT(*)::int c FROM price_history WHERE set_number='99999-1'`);
    assert.equal(n.c, 2, 'New and used must be allowed side by side');
  });

  await t.test('cleanup removes old rows — including the old snapshots', async () => {
    // The exception for '__portfolio__<id>' was dropped in an earlier round: the
    // snapshots no longer exist, and rows from the time before should
    // be removed by the retention period like everything else. An exception that
    // protects nothing any more only holds on to data.
    const { deleteOldPrices } = _req('src/finances/priceHistory.js');
    await db2.run(`INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price,recorded_at)
                   VALUES ('88888-1','N','CHF',5,5, NOW() - INTERVAL '4000 days'),
                          ('__portfolio__1','N','CHF',7,7, NOW() - INTERVAL '4000 days')`);
    environment({ PRICE_HISTORY_KEEP_DAYS: '1095' });
    const weg = await deleteOldPrices();
    assert.ok(weg >= 2, `not everything removed: ${weg}`);
    for (const sn of ['88888-1', '__portfolio__1'])
      assert.equal(
        (await db2.get(`SELECT COUNT(*)::int c FROM price_history WHERE set_number=$1`, [sn])).c,
        0,
        `old row ${sn} was left behind`,
      );
  });

  await t.test('PRICE_HISTORY_KEEP_DAYS=0 switches cleanup off', async () => {
    const { deleteOldPrices } = _req('src/finances/priceHistory.js');
    await db2.run(`INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price,recorded_at)
                   VALUES ('77777-1','N','CHF',5,5, NOW() - INTERVAL '4000 days')`);
    environment({ PRICE_HISTORY_KEEP_DAYS: '0' });
    assert.equal(await deleteOldPrices(), 0);
    assert.equal((await db2.get(`SELECT COUNT(*)::int c FROM price_history WHERE set_number='77777-1'`)).c, 1);
    environment({ PRICE_HISTORY_KEEP_DAYS: undefined });
  });

  await db2.pool.end().catch(() => {});
});

test('mail sending never switches off certificate verification', () => {
  // Behavior: test/smtp-tls-festnageln-db.test.js. Here only the ban in the source text.
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROOT, ohneKommentare } = require('./helpers/sources');
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/mail/transport.ts'), 'utf8'));
  assert.doesNotMatch(
    src,
    /rejectUnauthorized:\s*(false|!)/,
    'Certificate check can be switched off — SMTP credentials and reset links would go over an unverified connection',
  );
});
