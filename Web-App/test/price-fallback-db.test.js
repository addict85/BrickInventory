/**
 * Finances: a used set without a used price gets the price for
 * „new" — even if that one only lies old in the cache.
 *
 * Counter-checks (measured on 25.10.):
 *   A  the fetch of the other condition removed in the null branch (the state before
 *      the fix) → red: „kein Marktpreis"
 *   B  the condition „both fresh without price → do not fetch" removed →
 *      red in the third case (a price comes again, because it was fetched
 *      again)
 *
 * Second case: „BrickLink does not know this set" (catalog_cache NONE) applied
 * forever. A new set that was not yet in the BrickLink catalog at the first lookup
 * never got a market price — with a green check mark.
 *   C  the deadline in withoutBricklinkPrice() removed → red: „alte Markierung
 *      verhindert den Abruf"
 *
 * Since 05.11.2026 the valuation only reads the cache; fetching happens in the job
 * preise_nachladen (executed by hand here). Counter-check (measured):
 *   D  in setPriceFromStock() the fallback to the other condition removed →
 *      red: „kein Marktpreis“
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { holdsSet, catalogSet } = require('./helpers/inventory');

// Recreate BrickLink — as in price-write-route-db: esbuild exports via
// getters, so replace the entry in the require cache.
const blPath = require.resolve(path.join(ROOT, 'dist', 'src/catalog/bricklinkPrices.js'));
const echt = require(blPath);
let fetches = [];
require.cache[blPath].exports = Object.assign({}, echt, {
  priceGuideQuery: async (_k, _sn, cond) => {
    fetches.push(cond);
    return cond === 'N'
      ? { min_price: '100', avg_price: '111', max_price: '120', qty_avg_price: '110', total_quantity: '7' }
      : { min_price: '0', avg_price: '0', max_price: '0', qty_avg_price: '0', total_quantity: '0' };
  },
});

/** Runs the job that the valuation queued for missing prices. */
async function reload() {
  const a = await db.get(
    `SELECT id, payload FROM jobs WHERE type = 'price_refresh' AND status = 'pending' ORDER BY id DESC LIMIT 1`,
  );
  if (!a) return false;
  const { reloadPrices } = _req('src/finances/reloadPrices.js');
  await reloadPrices(a.payload, { signal: new AbortController().signal, progress: async () => true });
  await db.run(`DELETE FROM jobs WHERE type = 'price_refresh'`);
  return true;
}

/** An account with a used set, currency EUR. */
async function konto(name, set) {
  await db.run('DELETE FROM users WHERE username = $1', [name]).catch(() => {});
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, 'x', true, true) RETURNING id`,
      [name],
    )
  ).id;
  // The currency explicitly: without an own setting the global default would apply.
  await db.run(
    `INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')
                ON CONFLICT (user_id, key) DO UPDATE SET value = 'EUR'`,
    [uid],
  );
  await catalogSet(db, set, { name: 'Rückfallprobe', year: 2026 });
  await holdsSet(db, uid, set, 1, { preis: 119, condition: 'U' });
  return uid;
}

test('used set without a used price: the new price is fetched', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `rueckfall_${process.pid}`,
    SET = `9${process.pid % 10000}-1`;
  const aufraeumen = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    for (const tab of ['price_cache', 'price_history', 'set_catalog', 'catalog_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number = ANY($1)`, [[SET, SET.replace(/-1$/, '')]]).catch(() => {});
  };
  await aufraeumen();
  t.after(aufraeumen);

  const uid = await konto(NAME, SET);
  // Used: fresh, without a price. New: price present, but three days old.
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                VALUES ($1,'U','EUR',0,0,0,0,0,NOW()), ($1,'N','EUR',90,99,105,98,3,NOW() - INTERVAL '3 days')`,
    [SET],
  );

  const { valueSets } = _req('src/finances/financeCalc.js');
  fetches = [];
  const vorher = await valueSets(uid, [uid]);
  assert.deepEqual(fetches, [], 'the valuation fetches from BrickLink itself');
  assert.equal(vorher.prices_pending, 1, 'the missing price is not queued as a job');
  assert.ok(await reload());
  const row = (await valueSets(uid, [uid])).sets.find(s => s.set_number === SET);
  assert.ok(row, 'set missing in the valuation');
  assert.equal(
    row.avg_price,
    111,
    `no market price: ${JSON.stringify({ avg: row.avg_price, no_price: row.no_price, fetches })}`,
  );
  assert.deepEqual(fetches, ['N'], 'Used is freshly checked and must not be fetched again');

  // Now both are fresh — the next call gets by without BrickLink.
  fetches = [];
  assert.equal(await reload(), false, 'a fresh price queues no job');
  const zweite = (await valueSets(uid, [uid])).sets.find(s => s.set_number === SET);
  assert.equal(zweite.avg_price, 111);
  assert.deepEqual(fetches, [], 'fetches from BrickLink again although both conditions are fresh in the cache');

  // Both fresh without a price: no fetch, no price.
  await db.run(
    `UPDATE price_cache SET avg_price = 0, min_price = 0, max_price = 0, qty_avg_price = 0, fetched_at = NOW() WHERE set_number = $1`,
    [SET],
  );
  fetches = [];
  const thirdItem = (await valueSets(uid, [uid])).sets.find(s => s.set_number === SET);
  assert.equal(await reload(), false, 'both fresh without a price: no job');
  assert.equal(thirdItem.avg_price, 0);
  assert.deepEqual(fetches, [], 'fetches from BrickLink again although both conditions are fresh without a price');
});

test('“BrickLink does not know the set” only applies for a while', { concurrency: 1 }, async t => {
  t.after(() => db.pool.end().catch(() => {}));
  const NAME = `unbekannt_${process.pid}`,
    SET = `8${process.pid % 10000}-1`;
  const aufraeumen = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    for (const tab of ['price_cache', 'price_history', 'set_catalog', 'catalog_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number = $1`, [SET]).catch(() => {});
  };
  await aufraeumen();
  t.after(aufraeumen);
  const uid = await konto(NAME, SET);
  const { valueSets } = _req('src/finances/financeCalc.js');
  const value = async () => (await valueSets(uid, [uid])).sets.find(s => s.set_number === SET);

  // Freshly marked: no fetch, no price, and the reason stands with it.
  await db.run(
    `INSERT INTO catalog_cache (set_number, bl_type, is_gear, fetched_at) VALUES ($1, 'NONE', true, NOW())`,
    [SET],
  );
  fetches = [];
  const frisch = await value();
  assert.deepEqual(fetches, [], 'fresh marker: it is fetched anyway');
  assert.equal(frisch.no_price, true);
  assert.equal(frisch.bl_unknown, true, 'the reason is missing — the display cannot name it');

  // Ten days old: it is asked again, and the price arrives.
  await db.run(`UPDATE catalog_cache SET fetched_at = NOW() - INTERVAL '10 days' WHERE set_number = $1`, [SET]);
  fetches = [];
  await value();
  assert.ok(
    (await reload()) && fetches.length > 0,
    'an old marker prevents the fetch — the set would stay without a price forever',
  );
  const alt = await value();
  assert.equal(alt.avg_price, 111);
});
