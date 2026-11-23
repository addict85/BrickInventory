/**
 * Set acquisitions without a purchase price: the backfill, the history fallback of a new entry and
 * the first price fetch of a new set all work in the condition of the acquisition, not the default.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  run() no longer lists the step set-erfassungen → red “backfill” (null instead of 60)
 *      (row.condition replaced by null stays green: getSetValue prices per acquisition condition anyway)
 *   B  priceForNewEntry without the history fallback → red “history” (null instead of 55)
 *   C  currentMarketPrice passes null as hint to fetchPriceForSet → red “new set” (only N asked)
 *   D  conditionsNeededFor ignores hintCondition in fetchPriceForSet → red “new set” (only N asked)
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData, testSources, testServices, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

const fetches = [];
testSources(null, {
  bricklinkRequest: async (_method, path, params) => {
    fetches.push([path, params.new_or_used]);
    const p = params.new_or_used === 'U' ? '60' : '100';
    return { avg_price: p, qty_avg_price: p, min_price: p, max_price: p, total_quantity: '3' };
  },
});

const P = process.pid;
const BACK = `93${P}-1`,
  HIST = `94${P}-1`,
  NEW = `95${P}-1`;

test('set entries without a price: priced in their condition', { concurrency: 1 }, async t => {
  const db = testData();
  if (!(await dataOrSkip(t, _req))) return;
  const sets = [BACK, HIST, NEW];
  const route = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [`sepc-${P}`]);
    await db.run('DELETE FROM price_cache WHERE set_number = ANY($1)', [sets]);
    await db.run('DELETE FROM price_history WHERE set_number = ANY($1)', [sets]);
  };
  await route();
  t.after(async () => {
    await route().catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [`sepc-${P}`]))
    .id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','CHF')`, [uid]);
  const price = sn =>
    db
      .all(
        `SELECT purchase_price::float AS price, condition FROM set_acquisitions
          WHERE user_id = $1 AND set_number = $2 ORDER BY id`,
        [uid, sn],
      )
      .then(r => r.map(z => [z.price, z.condition]));

  await t.test('backfill: a used acquisition gets the used price', async () => {
    for (const [z, p] of [
      ['N', 100],
      ['U', 60],
    ])
      await db.run(
        `INSERT INTO price_cache (set_number, condition, currency_code, avg_price) VALUES ($1,$2,'CHF',$3)`,
        [BACK, z, p],
      );
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, BACK]);
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency)
         VALUES ($1,$2,1,NULL,'U','CHF')`,
      [uid, BACK],
    );
    await _req('src/inventory/purchasePriceBackfill.js').run();
    assert.deepEqual(await price(BACK), [[60, 'U']]);
  });

  await t.test('history: a new entry falls back to the history in the condition of the set', async () => {
    for (const [z, p] of [
      ['N', 99],
      ['U', 55],
    ])
      await db.run(
        `INSERT INTO price_history (set_number, condition, currency_code, avg_price) VALUES ($1,$2,'CHF',$3)`,
        [HIST, z, p],
      );
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, HIST]);
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
         VALUES ($1,$2,1,10,'U','CHF', now() - interval '10 days')`,
      [uid, HIST],
    );
    const { changeSet } = testServices().sets;
    await asAccount(uid, () => changeSet(uid, HIST, { quantity: 2 }));
    assert.deepEqual(await price(HIST), [
      [10, 'U'],
      [55, 'U'],
    ]);
  });

  await t.test('new set: the first price fetch asks for the requested condition', async () => {
    const { setGlobalSetting } = _req('src/settings/settings.js');
    await setGlobalSetting('bricklink_consumer_key', 'schluessel');
    fetches.length = 0;
    const { currentMarketPrice } = _req('src/finances/marketPrice.js');
    assert.equal(await currentMarketPrice(NEW, uid, 'U'), 60);
    assert.deepEqual(
      fetches.filter(([p]) => p.includes(NEW)).map(([, c]) => c),
      ['U'],
    );
  });
});
