/**
 * Market value of a set per condition (src/finances/setValue.ts).
 *
 * Counter-checks (measured 08.11.2026, each reverted):
 *   cacheUsable without the short period for 0 entries → red “a cached
 *   zero price …”; effectiveCondition always 'N' with acquisitions → red
 *   „Bewertung und Anzeige …“; buildChart() with firstRealIndex always 0 or
 *   without filling with 0 → red “the history endpoints …”. Deleted because set-state-aggregate-db.test.js
 *   executes it: “the P&L path chooses per set …” (priceFor() always new price →
 *   red there) and “there is a diagnostics endpoint …” (without price_cache → red);
 *   “only 404 is remembered negatively, no 403” runs in image-proxy-deckel.test.js.
 *   Deleted on 08.11.2026: “priceGuideQuery fetches the new price without a setting” and
 *   “without a sale in six months it falls back to 'stock'” →
 *   bricklink-price-guide-db.test.js (counter-checks A–D there).
 *   Deleted on 09.11.2026: three SQL searches in files without SQL (checked nothing) and “the price job
 *   fetches all conditions …” → price-run-states-db.test.js executes statesJeSet().
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Build into dist/ instead of in place — see helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { valueSet } = _req('src/finances/setValue.js');

const SN = '10290-1';
const prices = (n, u) => {
  const m = new Map();
  if (n) m.set(`${SN}|N`, n);
  if (u) m.set(`${SN}|U`, u);
  return m;
};

test('only new entered → new price, no fallback to used', () => {
  // The reported case: one new acquisition, both prices in the cache.
  const v = valueSet(SN, [{ quantity: 1, condition: 'N' }], prices(148.72, 92.68));
  assert.equal(v.unit_price, 148.72);
  assert.equal(v.total, 148.72);
});

test('one copy each new and used', () => {
  const v = valueSet(
    SN,
    [
      { quantity: 1, condition: 'N' },
      { quantity: 1, condition: 'U' },
    ],
    prices(148.72, 92.68),
  );
  // unit price = mean of both, sum = both together
  assert.equal(v.unit_price, Math.round(((148.72 + 92.68) / 2) * 100) / 100);
  assert.equal(v.total, 241.4);
  assert.equal(v.quantity, 2);
});

test('display × quantity always yields the sum', () => {
  // Generalization to unequal piece counts: a pure mean over
  // the occurring conditions would be inconsistent with the sum here.
  const v = valueSet(
    SN,
    [
      { quantity: 2, condition: 'N' },
      { quantity: 1, condition: 'U' },
    ],
    prices(100, 40),
  );
  assert.equal(v.total, 240); // 2×100 + 1×40
  assert.equal(v.unit_price, 80); // 240 / 3
  assert.equal(v.unit_price * v.quantity, v.total);
});

test('missing price for one condition falls back to the other', () => {
  const v = valueSet(SN, [{ quantity: 1, condition: 'U' }], prices(148.72, null));
  assert.equal(v.unit_price, 148.72, 'rather the other condition than no value at all');
});

test('no price at all yields null, not 0', () => {
  const v = valueSet(SN, [{ quantity: 1, condition: 'N' }], new Map());
  assert.equal(v.unit_price, null);
  assert.equal(v.total, null, 'a 0 would look like a known value in the totals');
});

// valueSet() is also used for manual parts and minifigures; there
// the acquisition is actually optional. For SETS since migration 0032 there is
// no row without an acquisition any more — but the fallback path stays reachable
// and must compute correctly.
test('without entries the passed fallback values count', () => {
  const v = valueSet(SN, [], prices(148.72, 92.68), 'U', 3);
  assert.equal(v.unit_price, 92.68);
  assert.equal(v.total, 278.04);
});

test('by_condition shows the composition', () => {
  const v = valueSet(
    SN,
    [
      { quantity: 2, condition: 'N' },
      { quantity: 1, condition: 'U' },
    ],
    prices(100, 40),
  );
  const n = v.by_condition.find(b => b.condition === 'N');
  const u = v.by_condition.find(b => b.condition === 'U');
  assert.deepEqual([n.quantity, n.unit_price], [2, 100]);
  assert.deepEqual([u.quantity, u.unit_price], [1, 40]);
});

test('qty_avg_price is no longer read anywhere for set prices', () => {
  // The set core works exclusively with set prices — the identifier must not
  // occur there. Exception is setPrice(): the price response of the
  // app carries the field qty_avg_price and only passes it through.
  const roh = require('./helpers/sources').setCoreSource();
  const von = roh.indexOf('export async function setPrice');
  const bis = roh.indexOf('export async function currencyOf', von);
  assert.ok(von > 0 && bis > von, 'setPrice() not found');
  const sets = roh.slice(0, von) + roh.slice(bis);
  assert.equal((sets.match(/qty_avg_price/g) || []).length, 0, 'set core: set prices must go via avg_price');
});

test("guide_type is 'sold' everywhere, not 'stock'", () => {
  // 'sold' = actually achieved prices of the last six months.
  // 'stock' would be listed offers, i.e. also what nobody pays.
  for (const f of [
    'clients/bricklink.ts',
    'src/catalog/bricklinkPrices.ts',
    'routes/api/sets.ts',
    'src/finances/financeCalc.ts',
    'src/finances/priceRun.ts',
  ]) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // 'stock' is allowed as a FALLBACK (no sale in six months), but
    // never as the first query. Recognizable by the preceding spread or by the
    // explicit argument to getPriceGuideRaw.
    for (const m of code.matchAll(/guide_type:\s*'stock'/g)) {
      const before = code.slice(Math.max(0, m.index - 40), m.index);
      assert.match(
        before,
        /\.\.\.qp,\s*$/,
        `${f}: guide_type 'stock' als Erstabfrage — erlaubt ist es nur als Rückfall`,
      );
    }
    assert.doesNotMatch(code, /'price_guide_type',\s*'stock'/, `${f}: Vorgabe der Einstellung ist noch 'stock'`);
    assert.doesNotMatch(code, /guideType = 'stock'/, `${f}: parameter default is still 'stock'`);
  }
});

test('a cached zero price does not permanently block the fallback', () => {
  // A 0 entry counted as the final answer for the full TTL window; the
  // logic then fell back to the OTHER condition. An entry with a price applies
  // the whole window, one without only briefly.
  const { cacheUsable } = _req('src/finances/calculation/prices.js');
  // Time is a parameter: a fixed instant instead of the computer's clock.
  const JETZT = Date.UTC(2026, 0, 10, 12);
  const ago = (/** @type {number} */ h) => new Date(JETZT - h * 3600000).toISOString();
  assert.equal(cacheUsable({ avg_price: '0', fetched_at: ago(1) }, 24, JETZT), true, 'a fresh 0 entry answers');
  assert.equal(
    cacheUsable({ avg_price: '0', fetched_at: ago(7) }, 24, JETZT),
    false,
    'an old 0 entry must fall through and trigger a refetch',
  );
  assert.equal(cacheUsable({ avg_price: '0' }, 24, JETZT), false, 'without fetched_at the age is unknown');
  assert.equal(cacheUsable({ avg_price: '0', fetched_at: ago(3) }, 2, JETZT), false, 'the shorter period wins');
  assert.equal(
    cacheUsable({ avg_price: '12.5', fetched_at: ago(20) }, 24, JETZT),
    true,
    'a price is valid for the full window',
  );
  assert.equal(
    cacheUsable({ avg_price: '0', qty_avg_price: '9', fetched_at: ago(7) }, 24, JETZT),
    true,
    'a quantity average alone is a price (marketPriceFrom) and is valid for the full window',
  );
});

test('the finances view shows avg_price as market price', () => {
  // The detail dialog was right after the last fix, the finances tab
  // was not: there the column labeled „Marktpreis" showed qty_avg_price,
  // and the total column computed with it.
  const fin = fs.readFileSync(path.join(ROOT, 'public', 'js', 'finances.js'), 'utf8');
  assert.match(
    fin,
    /const total\s*=\s*acq \? acq\.value_total : s\.value_total;/,
    'The total column must go via avg_price, not via qty_avg',
  );
  assert.match(
    fin,
    /parseFloat\(d\.totals\??\.avg\s*\|\|\s*'?0'?\)/,
    'The totals are labelled „Ø Marktpreis“ and must take totals.avg',
  );
  assert.match(
    fin,
    /(?:parseFloat|Number)\(it\.avg_price \?\? it\.qty_avg_price \?\? 0\)/,
    'part and minifigure rows: avg_price first',
  );
  assert.doesNotMatch(fin, /parseFloat\(d\.totals\.qty_avg/, 'Keine Summe darf mehr auf qty_avg basieren');

  // The second market price column has meanwhile been dropped entirely — the target form
  // is checked by the test “finances: purchase price instead of a second market price column”.
  // finance.qty_avg was removed with the column — no dead key.
  const i18n = require('./helpers/sources').i18nAll();
  assert.doesNotMatch(i18n, /'finance\.qty_avg':/, 'The key must be removed together with the column');
});

test('finances: purchase price instead of a second market price column', () => {
  const fin = fs.readFileSync(path.join(ROOT, 'public', 'js', 'finances.js'), 'utf8');
  // The sets table had two price columns for the same concept.
  assert.doesNotMatch(fin, /t\('finance\.qty_avg'\)/, 'The quantity-weighted column has been dropped');
  // Cost (quantity × purchase price) before market price, the same for all three tables.
  // The header may be a sort button (sortButton), the order stays.
  assert.match(
    fin,
    /<th[^>]*>(?:<abbr[^>]*>)?\$\{(?:t(?:Raw)?\('finance\.col\.purchase'\)|sortButton\('purchase', \w+, tRaw\('finance\.col\.purchase'\)\))\}(?:<\/abbr>)?<\/th>`(?:\s*\+ `|\}\$\{html`)<th[^>]*>\$\{(?:t(?:Raw)?\('(?:detail\.market_price|finance\.grand\.value)'\)|sortButton\('value', \w+, tRaw\('finance\.grand\.value'\)\))\}/,
    'Sets-Tabelle: Kaufpreis vor Marktpreis, wie bei Teilen und Minifiguren',
  );
  // fmtMoney instead of fmtN: a purchase price of 0 (gift) stands there as „0,00 €“.
  assert.match(fin, /if \(n <= 1\) return fmtMoney\(p, cur\);/, 'The purchase price column must also show the value');

  // The weighting of the purchase price has moved from the SQL into weightedPurchase()
  // — it is now computed over the same rows that also stand in
  // the table. Thus row sum and header number can no longer
  // auseinanderlaufen.
  const sv = fs.readFileSync(path.join(ROOT, 'src/finances/setValue.ts'), 'utf8');
  assert.match(
    sv,
    /withCost\.reduce\(\(s, r\) => s \+ \(r\.purchase_price as number\) \* r\.quantity, 0\) \/ qty/,
    'The purchase price must be averaged weighted by quantity: 2x100 + 1x160 yields 120, not 130',
  );
  assert.match(
    sv,
    /r\.purchase_price != null/,
    'Acquisitions without a purchase price must not inflate the denominator',
  );

  // The valuation takes exclusively the weighted purchase price from the
  // acquisitions, no fallback to a column of the inventory row.
  const fc = require('./helpers/sources').finanzQuelle();
  assert.match(
    fc,
    /const purchase = weightedPurchase\(rows\);/,
    'The valuation must take the purchase price from the acquisitions, without a fallback',
  );
  assert.doesNotMatch(
    fc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''),
    /parseFloat\(set\.purchase_price\)/,
    'Kein Pfad darf auf eine Kaufpreis-Spalte der sets-Zeile zurueckfallen',
  );
});

test('a late response does not write into a foreign dialog', () => {
  const src = require('./helpers/sources').adminSource();
  // Since round 24 (N7) the figure count comes from the catalog; only the price history is loaded afterwards.
  const i = src.indexOf("api('GET', `/v2/sets/${sn}/price-history`)");
  assert.ok(i > 0, 'The request for the price history is missing');
  const fn = src.slice(i, i + 500);
  assert.match(
    fn,
    /!openSet \|\| openSet\.set_number !== sn/,
    'The late response does not check whether the same set is still open',
  );
});

test('preview generation is capped', () => {
  // Marco's measurement
  const server = require('./helpers/sources').serverAll();
  const parallel = server.match(/const THUMB_MAX_PARALLEL = (\d+)/);
  assert.ok(parallel, 'THUMB_MAX_PARALLEL not found');
  assert.ok(
    parseInt(parallel[1], 10) <= 1,
    `THUMB_MAX_PARALLEL = ${parallel[1]} — in the cluster that multiplies per ` +
      'worker process. One per process is enough: the preview is an ' +
      'acceleration for later, nothing anyone waits for.',
  );
  assert.match(
    server,
    /_thumbQueue\.length >= THUMB_MAX_QUEUE/,
    'The queue has no upper limit — whoever scrolls through quickly piles up ' +
      'half the catalogue, and the server stubbornly works through it',
  );

  // And the limit must apply to the WHOLE server
  assert.match(
    server,
    /pg_try_advisory_lock\(\$1\)/,
    'Preview generation has no cross-process lock — then every ' +
      'worker process computes on its own, and the limit above has no effect',
  );
  // try, do not wait: whoever does not get the lock leaves it. A waiting
  // run would hold a database connection and back up the work again after all.
  assert.doesNotMatch(server, /pg_advisory_lock\(\$1\)/, 'A WAITING lock only piles up the work somewhere else');
  assert.match(
    server,
    /pg_advisory_unlock\(\$1\)/,
    'Without a release the first run blocks all following ones until restart',
  );

  // And the catalog produces no previews at all
  assert.match(
    server,
    /const createMay = req\.query\.gen !== '0'/,
    'The proxy does not know „use a preview but do not generate one"',
  );
  const kat = fs.readFileSync(path.join(ROOT, 'public', 'js', 'catalog.js'), 'utf8');
  assert.match(kat, /imgUrl\(thumbUrl\(src\), 'only'\)/, 'The catalogue tile still lets downscalings be generated');
  // The gallery does NOT — there it pays off.
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', 'collection.js'), 'utf8');
  assert.match(gal, /imgUrl\(thumbUrl\(src\)\s*\|\|\s*src,\s*true\)/, 'The own stock should still get previews');
});

test('valuation and display use the same condition rule', () => {
  // The display derived the condition from the acquisitions, the valuation read
  // a stored value — the tile showed „Neu", the valuation was for used.
  const { effectiveCondition } = _req('src/finances/calculation/condition.js');
  const { conditionFromAcquisitions } = _req('src/inventory/shared.js');
  for (const [acq, used] of [
    [0, 0],
    [1, 0],
    [3, 0],
    [1, 1],
    [3, 1],
    [2, 2],
    ['2', '1'],
    [null, null],
  ]) {
    assert.equal(
      effectiveCondition({ acq_count: acq, used_count: used }),
      conditionFromAcquisitions(acq, used),
      `acq_count=${acq}, used_count=${used}: valuation and display differ`,
    );
  }
  assert.equal(effectiveCondition({ acq_count: 2, used_count: 1 }), 'U', 'one used acquisition is enough');
  assert.equal(effectiveCondition(null), 'N', 'without acquisitions „Neu“ applies');
});

test('the history endpoints deliver finished chart data', () => {
  // ── Why the server computes this ──────────────────────────────────────
  // Before, every client built the time axis itself: the web app in
  // priceChartSVG(), Android would have needed the same calculation a second time.
  // Exactly this pattern has already drifted apart several times in this project
  // (condition resolution, image allowlist, history route).
  const { buildChart } = _req('src/finances/chartData.js');
  const d = buildChart([
    {
      name: 'N',
      rows: [
        { recorded_at: '2026-01-02', avg_price: '10' },
        { recorded_at: '2026-01-03', avg_price: 11 },
      ],
    },
    { name: 'U', rows: [{ recorded_at: '2026-01-03', avg_price: null, qty_avg_price: '7' }] },
  ]);
  assert.deepEqual(d.x, ['2026-01-02', '2026-01-03'], 'The axis carries the measuring days of both series');
  assert.deepEqual(
    d.values[1].values.map((/** @type {any} */ p) => p.y),
    [0, 7],
    'Empty positions are padded with 0',
  );
  assert.equal(d.values[1].firstRealIndex, 1, 'Without this index a renderer cannot skip the padded zeros');
  assert.equal(d.values[0].firstRealIndex, 0);
  assert.equal(
    buildChart([{ name: 'empty-state', rows: [] }]).values[0].firstRealIndex,
    0,
    'An empty series points past its end',
  );

  // All three history endpoints must use it.
  const ph = fs.readFileSync(path.join(ROOT, 'src/finances/priceHistory.ts'), 'utf8');
  // Since hardened-96 parts and minifigure history are also in
  // src/finances/priceHistory.ts (the Android routes need the same response) — they
  // share ONE build there, hence buildChart stands twice in the
  // file: once for sets, once for both manual kinds.
  const uses = (ph.match(/buildChart\(/g) || []).length;
  assert.equal(uses, 2, `${uses} instead of 2 buildChart calls in src/finances/priceHistory.ts`);
  // Also where the history routes stand: an adapter builds no chart data.
  const v1fin = fs.readFileSync(path.join(ROOT, 'routes/api/finance.ts'), 'utf8');
  assert.doesNotMatch(
    v1fin,
    /buildChart\(/,
    'Die Routendatei ist ein Adapter — die Diagrammdaten baut der gemeinsame Helfer',
  );

  // The renderer must not draw the padded zeros — otherwise the
  // line begins at zero and jumps straight up: a price crash that never
  // gab.
  const admin = require('./helpers/sources').adminSource();
  assert.match(admin, /slice\(sd\.firstRealIndex \?\? 0\)/, 'priceChartSVG must skip leading zeros');
});

// ═══════════════════════════════════════════════════════════════════════════
// One row per purchase price (hardened-90)
// ═══════════════════════════════════════════════════════════════════════════
const { valueAcquisitionRows, weightedPurchase, pnlPct } = _req('src/finances/setValue.js');

const acq = (id, cond, qty, price, day) => ({
  id,
  condition: cond,
  quantity: qty,
  purchase_price: price,
  created_at: day ? `${day}T12:00:00Z` : null,
});

test('one row per entry, each with the price of ITS condition', () => {
  // The reported case: one copy bought new, one used. Before, the
  // whole set counted as used as soon as ONE acquisition was used — the
  // new copy was then also valued with the used price.
  const rows = valueAcquisitionRows(SN, [acq(1, 'N', 1, 100), acq(2, 'U', 1, 60)], prices(148.72, 92.68));

  assert.equal(rows.length, 2, 'two purchase prices → two rows');
  assert.equal(rows[0].avg_price, 148.72, 'The new row gets the new price');
  assert.equal(rows[1].avg_price, 92.68, 'The used row gets the used price');
  assert.equal(rows[0].total_avg, '148.72');
  assert.equal(rows[1].total_avg, '92.68');
});

test('the percentage is computed against the purchase price of THIS row', () => {
  const rows = valueAcquisitionRows(SN, [acq(1, 'N', 1, 100), acq(2, 'U', 1, 60)], prices(150, 90));
  assert.equal(rows[0].pnl_pct, '50.0', '150 gegen 100');
  assert.equal(rows[1].pnl_pct, '50.0', '90 gegen 60');
});

test('quantity counts: the row sum is price × quantity', () => {
  const rows = valueAcquisitionRows(SN, [acq(1, 'N', 3, 100)], prices(50, 20));
  assert.equal(rows[0].total_avg, '150.00');
});

test('without an entered purchase price no percentage — and none at 0 either', () => {
  const rows = valueAcquisitionRows(SN, [acq(1, 'N', 1, null), acq(2, 'N', 1, 0)], prices(50, 20));
  assert.equal(rows[0].purchase_price, null, 'not recorded stays null, not 0');
  assert.equal(rows[0].pnl_pct, null, 'computed against nothing yields no number');
  assert.equal(rows[1].purchase_price, 0, 'a gift is recorded: 0, not null');
  assert.equal(rows[1].pnl_pct, null, 'computed against 0 there is no percentage');
});

test('if the price of one condition is missing, the other steps in', () => {
  // Many older sets are only traded in one condition any more. Valuing the
  // acquisition with 0 would falsify the sum.
  const rows = valueAcquisitionRows(SN, [acq(1, 'U', 1, 60)], prices(148.72, null));
  assert.equal(rows[0].avg_price, 148.72);
});

test('the purchase price is only averaged over the rows that have one', () => {
  // 2×100 and 1×160 results in 120, not 130 — and an acquisition without
  // a captured price must not inflate the denominator.
  const rows = valueAcquisitionRows(
    SN,
    [acq(1, 'N', 2, 100), acq(2, 'N', 1, 160), acq(3, 'N', 5, null)],
    prices(50, 20),
  );
  assert.equal(weightedPurchase(rows), 120);
  assert.equal(weightedPurchase([]), null, 'no row with a price → no purchase price');
});

test('row sums and set unit price match', () => {
  // The table shows both. If they differ, two truths stand
  // side by side — exactly that was the reason to bring the calculation here.
  const acqs = [acq(1, 'N', 2, 100), acq(2, 'U', 1, 60)];
  const p = prices(150, 90);
  const rows = valueAcquisitionRows(SN, acqs, p);
  const v = valueSet(SN, acqs, p);
  const sumRows = rows.reduce((s, r) => s + parseFloat(r.total_avg), 0);
  assert.equal(sumRows, v.total, 'Σ rows = total value of the set');
  assert.equal(
    Math.round(v.unit_price * v.quantity * 100) / 100,
    v.total,
    'unit price × quantity = total value (that is how the web app and Android compute)',
  );
});

test('purchase price 0 yields no percentage, no jump to infinity', () => {
  assert.equal(pnlPct(0, 50), null);
  assert.equal(pnlPct(40, 50), '25.0');
  assert.equal(pnlPct(null, 50), null);
  assert.equal(pnlPct(50, null), null);
});
