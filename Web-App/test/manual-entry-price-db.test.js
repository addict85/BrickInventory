/**
 * Manual parts and minifigures: every capture books an acquisition, priced in the captured
 * condition and dated as entered; without a BrickLink price the figure books the parts estimate.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  additionalAcquisition() returns before bookDailyEntry → red “part” (1 row instead of 3)
 *   B  manualPartPurchase passes null instead of the condition to marketPriceWithOrigin → red “part” (100 instead of 60)
 *   C  createdAt: acquiredAt dropped when creating a part → red “part” (date of today)
 *   D  the re-capture branch of addManualMinifigInternal returns before booking → red “figure” (1 row instead of 2)
 *   E  figMarketPriceWithOrigin tries only [blFigNumber] → red “figure” (estimate null instead of 60)
 *   F  estimateMinifigsPrice called with DEFAULT_PRICE_CONDITION instead of effCond → red “estimate” (3 instead of 2)
 *   G  price: acquisitionPrice replaced by null when creating a figure → red “estimate” (null instead of 2)
 *   H  valueMinifigs queues the figure price with a fixed 'N' instead of cond → red “valuation” (N instead of U)
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

const P = process.pid;
const PART = `mep${P}`,
  FIG = `fig-mep${P}`,
  EST = `fig-mee${P}`,
  EPART = `mee${P}`,
  QFIG = `fig-meq${P}`;

test('manual captures: price of the condition, one entry per capture', { concurrency: 1 }, async t => {
  const db = testData();
  if (!(await dataOrSkip(t, _req))) return;
  const weg = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [`mep-${P}`]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = ANY($1)', [[PART, EPART]]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = ANY($1)', [[FIG, EST]]);
    await db.run('DELETE FROM minifig_price_history WHERE fig_number = ANY($1)', [[FIG, EST]]);
    await db.run('DELETE FROM minifig_parts_cache WHERE fig_number = ANY($1)', [[FIG, EST]]);
    await db.run(`DELETE FROM jobs WHERE type = 'price_refresh'`);
  };
  await weg();
  t.after(async () => {
    await weg().catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [`mep-${P}`]))
    .id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','CHF')`, [uid]);
  // New 100, used 60: a price from the wrong condition shows as the wrong number.
  for (const [z, preis] of [
    ['N', 100],
    ['U', 60],
  ]) {
    await db.run(
      `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price) VALUES ($1,77,$2,'CHF',$3)`,
      [PART, z, preis],
    );
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price) VALUES ($1,$2,'CHF',$3)`,
      [FIG, z, preis],
    );
  }
  const rows = (table, col, key) =>
    db.all(
      `SELECT quantity, unit_price::float AS price, condition, to_char(created_at, 'YYYY-MM-DD') AS day
         FROM ${table} WHERE user_id = $1 AND ${col} = $2 ORDER BY created_at`,
      [uid, key],
    );

  await t.test('part: every capture books an entry in its condition and on its date', async () => {
    const { addManualPart } = _req('src/parts/manualParts.js');
    const base = { part_number: PART, part_name: 'Probe', color_id: 77 };
    await addManualPart(uid, { ...base, condition: 'U', acquired_at: '2026-01-05' });
    await addManualPart(uid, { ...base, condition: 'U', quantity: 2, acquired_at: '2026-02-07' });
    // A typed 0 means “no price”, not “bought for nothing”.
    await addManualPart(uid, { ...base, condition: 'N', unit_price: '0', acquired_at: '2026-03-01' });
    assert.deepEqual(await rows('part_acquisitions', 'part_number', PART), [
      { quantity: 1, price: 60, condition: 'U', day: '2026-01-05' },
      { quantity: 2, price: 60, condition: 'U', day: '2026-02-07' },
      { quantity: 1, price: null, condition: 'N', day: '2026-03-01' },
    ]);
  });

  await t.test('figure without its own BrickLink number: price of its condition, every capture', async () => {
    const { addManualMinifig } = _req('src/minifigs/manualMinifigs.js');
    await addManualMinifig(uid, { fig_number: FIG, fig_name: 'Probe', condition: 'U', acquired_at: '2026-01-05' });
    await addManualMinifig(uid, { fig_number: FIG, condition: 'U', acquired_at: '2026-02-07' });
    assert.deepEqual(await rows('minifig_acquisitions', 'fig_number', FIG), [
      { quantity: 1, price: 60, condition: 'U', day: '2026-01-05' },
      { quantity: 1, price: 60, condition: 'U', day: '2026-02-07' },
    ]);
  });

  await t.test('figure without a BrickLink price books the parts estimate of its condition', async () => {
    await db.run(`INSERT INTO minifig_parts_cache (fig_number, data) VALUES ($1,$2)`, [
      EST,
      JSON.stringify([{ part_num: EPART, color_id: 777, quantity: 2 }]),
    ]);
    for (const [z, preis] of [
      ['N', 1],
      ['U', 1.5],
    ])
      await db.run(
        `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price) VALUES ($1,777,$2,'CHF',$3)`,
        [EPART, z, preis],
      );
    const { addManualMinifig } = _req('src/minifigs/manualMinifigs.js');
    await addManualMinifig(uid, { fig_number: EST, fig_name: 'Probe', condition: 'N', acquired_at: '2026-01-05' });
    assert.deepEqual(await rows('minifig_acquisitions', 'fig_number', EST), [
      { quantity: 1, price: 2, condition: 'N', day: '2026-01-05' },
    ]);
  });

  await t.test('valuation: a figure without a price queues its fetch in the condition of its entry', async () => {
    await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual')`, [uid, QFIG]);
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, currency)
         VALUES ($1,$2,1,5,'U','CHF')`,
      [uid, QFIG],
    );
    const { valueMinifigs } = _req('src/finances/financeCalc.js');
    await asAccount(uid, () => valueMinifigs(uid, [uid]));
    const items = (
      await db.all(`SELECT payload->'items' AS items FROM jobs WHERE type = 'price_refresh' AND user_id = $1`, [uid])
    ).flatMap(r => r.items);
    assert.deepEqual(
      items.filter(i => i.number === QFIG),
      [{ kind: 'figur', number: QFIG, condition: 'U' }],
    );
  });
});
