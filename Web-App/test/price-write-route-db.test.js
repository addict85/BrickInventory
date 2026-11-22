/**
 * A BrickLink price is written away on ONE path.
 *
 * Counter-checks (carried out):
 *   a) the price_history write removed in savePrice()
 *      → both substeps red. The comparison job/request path alone would
 *        NOT have noticed that (both lose the point equally) —
 *        hence below it additionally stands what should come out.
 *   b) only the old `return 'updated'` reinserted in the fallback
 *      → stayed GREEN, and rightly so: the null row now already stands before it,
 *        the early exit loses nothing any more.
 *      The effective counter-check is the old ORDER — null row only
 *      after the fallback, fallback jumps out. With that substep 1 is
 *      red: second run 'updated' instead of 'skipped'.
 *   c) a second INSERT INTO price_cache put in src/finances/priceRun.ts
 *      → substep 2 red.
 *   d) (13.11.2026) in savePrice() the history again with logAndContinue
 *      and without a transaction → substep 3 red (no refusal); only the
 *      transaction left out → red (the cache row stood there without a history point).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

// Set up BrickLink BEFORE financeCalc/priceJob pull out priceGuideQuery.
// esbuild exports via getters, a `bl.priceGuideQuery = …` would run into
// nothing — hence the entry in the require cache is replaced.
const blPath = require.resolve(path.join(ROOT, 'dist', 'src/catalog/bricklinkPrices.js'));
const echt = require(blPath);
let fetches = [];
require.cache[blPath].exports = Object.assign({}, echt, {
  priceGuideQuery: async (_k, _sn, cond) => {
    fetches.push(cond);
    // 'N' without a price, 'U' with one — exactly the situation in which the fallback applies.
    return cond === 'U'
      ? { min_price: '8', avg_price: '10', max_price: '12', qty_avg_price: '9', total_quantity: '4' }
      : { min_price: '0', avg_price: '0', max_price: '0', qty_avg_price: '0', total_quantity: '0' };
  },
});

/** price_cache and price_history of a set, prepared for comparison. */
async function traces(sn) {
  const cache = await db.all(
    'SELECT condition, avg_price::float AS avg FROM price_cache WHERE set_number=$1 ORDER BY condition',
    [sn],
  );
  const hist = await db.all(
    'SELECT condition, avg_price::float AS avg FROM price_history WHERE set_number=$1 ORDER BY condition',
    [sn],
  );
  return { cache, hist };
}

test('a BrickLink price is written away on one path', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;

  const JOB = `schreibweg-${process.pid}-job`;
  const ROUTE = `schreibweg-${process.pid}-weg`;
  const FAIL = `schreibweg-${process.pid}-fehl`;
  const aufraeumen = async () => {
    await db.run('DELETE FROM price_cache   WHERE set_number = ANY($1)', [[JOB, ROUTE, FAIL]]).catch(() => {});
    await db.run('DELETE FROM price_history WHERE set_number = ANY($1)', [[JOB, ROUTE, FAIL]]).catch(() => {});
  };
  await aufraeumen();

  try {
    // 1. The job writes the null row too — otherwise the same set costs
    //    two requests again on every run.
    const { fetchAndCachePrice } = _req('src/finances/priceRun.js');
    fetches = [];
    assert.equal(await fetchAndCachePrice(JOB, 'N', 'sold', 'EUR', 24), 'updated');
    const nachLauf1 = fetches.length;
    assert.equal(
      await fetchAndCachePrice(JOB, 'N', 'sold', 'EUR', 24),
      'skipped',
      'Der zweite Lauf darf BrickLink nicht erneut fragen — die Antwort steht im Cache, ' +
        'auch wenn sie „kein Preis" lautet',
    );
    assert.equal(
      fetches.length,
      nachLauf1,
      `Zweiter Lauf hat ${fetches.length - nachLauf1} zusaetzliche BrickLink-Abrufe gekostet`,
    );

    // 2. The same case via the request path leaves behind the same.
    const { fetchPrice } = _req('src/finances/financeCalc.js');
    fetches = [];
    await fetchPrice(ROUTE, 'N', 'sold', 'EUR', 24);
    const fetchesRoute = fetches.length;

    const j = await traces(JOB),
      w = await traces(ROUTE);
    assert.deepEqual(j.cache, w.cache, 'Job und Anfrageweg hinterlassen unterschiedliche price_cache-Zeilen');
    assert.deepEqual(j.hist, w.hist, 'Job und Anfrageweg hinterlassen unterschiedliche price_history-Punkte');
    assert.equal(
      nachLauf1,
      fetchesRoute,
      `Job braucht ${nachLauf1} Abrufe, der Anfrageweg ${fetchesRoute} — fuer dieselbe Auskunft`,
    );

    // And what is left behind is also the right thing: the null row for the
    // requested condition, the price for the fallback, a history point
    // for the price and none for the null.
    assert.deepEqual(j.cache, [
      { condition: 'N', avg: 0 },
      { condition: 'U', avg: 10 },
    ]);
    assert.deepEqual(j.hist, [{ condition: 'U', avg: 10 }]);

    // 3. If the history point fails, the cache does not count either: otherwise it would hold back
    //    the next fetch, and nobody would fill the gap in the history any more.
    const fk = require('./helpers/sources').testContext('finances');
    /** The same context, whose history is not writable — outside and in the transaction. */
    const kaputt = z => ({
      ...z,
      preisCache: {
        ...z.preisCache,
        rememberSetHistory: async () => {
          throw new Error('Verlauf nicht schreibbar (Probe)');
        },
      },
      transaction: fn => z.transact(t => fn(kaputt(t))),
    });
    const k = kaputt(fk);
    const guide = { min_price: '8', avg_price: '10', max_price: '12', qty_avg_price: '9', total_quantity: '4' };
    await assert.rejects(
      require(path.join(ROOT, 'dist', 'src/finances/calculation/prices.js')).savePrice(k, FAIL, 'U', 'EUR', guide),
      /Verlauf nicht schreibbar/,
    );
    assert.deepEqual(await traces(FAIL), { cache: [], hist: [] });
  } finally {
    await aufraeumen();
    await db.pool.end();
  }
});

test('the write rule exists in only one place', () => {
  // Found, not enumerated: all .ts of the tree except tests and tooling.
  const dateien = [];
  const gehen = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (
        e.name === 'node_modules' ||
        e.name === 'dist' ||
        e.name === 'test' ||
        e.name === 'scripts' ||
        e.name.startsWith('.')
      )
        continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) gehen(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) dateien.push(abs);
    }
  };
  gehen(ROOT);
  // Self-proof: if the search found nothing, the rule below would be vacuously true.
  assert.ok(dateien.length >= 40, `Nur ${dateien.length} Quelldateien gefunden — die Suche greift nicht mehr`);

  const cacheWriter = [],
    historyWriter = [];
  for (const f of dateien) {
    const code = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
    const rel = path.relative(ROOT, f);
    for (const _ of code.matchAll(/INSERT INTO price_cache/g)) cacheWriter.push(rel);
    // Only the row-wise write. The daily snapshot in the job
    // copies via SELECT and is something other than „setting a point".
    for (const m of code.matchAll(/INSERT INTO price_history[\s\S]{0,220}?(VALUES|SELECT)/g))
      if (m[1] === 'VALUES') historyWriter.push(rel);
  }
  assert.deepEqual(
    cacheWriter,
    ['src/finances/repository/priceCache.ts'],
    'price_cache wird an mehr als einer Stelle beschrieben — genau daran sind die ' + 'beiden Wege auseinandergelaufen',
  );
  assert.deepEqual(
    historyWriter,
    ['src/finances/repository/priceCache.ts'],
    'Ein Verlaufspunkt wird an mehr als einer Stelle gesetzt',
  );
});
