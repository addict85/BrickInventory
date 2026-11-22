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
  assert.equal(v.unit_price, 148.72, 'besser der andere Zustand als gar kein Wert');
});

test('no price at all yields null, not 0', () => {
  const v = valueSet(SN, [{ quantity: 1, condition: 'N' }], new Map());
  assert.equal(v.unit_price, null);
  assert.equal(v.total, null, 'eine 0 sähe in den Summen wie ein bekannter Wert aus');
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
  assert.ok(von > 0 && bis > von, 'setPrice() nicht gefunden');
  const sets = roh.slice(0, von) + roh.slice(bis);
  assert.equal((sets.match(/qty_avg_price/g) || []).length, 0, 'Set-Kern: Set-Preise müssen über avg_price laufen');
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
    assert.doesNotMatch(code, /guideType = 'stock'/, `${f}: Parametervorgabe ist noch 'stock'`);
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
  assert.equal(
    cacheUsable({ avg_price: '0', fetched_at: ago(1) }, 24, JETZT),
    true,
    'ein frischer 0-Eintrag antwortet',
  );
  assert.equal(
    cacheUsable({ avg_price: '0', fetched_at: ago(7) }, 24, JETZT),
    false,
    'ein alter 0-Eintrag muss durchfallen und einen Neuabruf auslösen',
  );
  assert.equal(cacheUsable({ avg_price: '0' }, 24, JETZT), false, 'ohne fetched_at ist das Alter unbekannt');
  assert.equal(cacheUsable({ avg_price: '0', fetched_at: ago(3) }, 2, JETZT), false, 'die kürzere Frist gewinnt');
  assert.equal(
    cacheUsable({ avg_price: '12.5', fetched_at: ago(20) }, 24, JETZT),
    true,
    'ein Preis gilt das volle Fenster',
  );
  assert.equal(
    cacheUsable({ avg_price: '0', qty_avg_price: '9', fetched_at: ago(7) }, 24, JETZT),
    true,
    'ein Mengenschnitt allein ist ein Preis (marketPriceFrom) und gilt das volle Fenster',
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
    'Die Total-Spalte muss über avg_price laufen, nicht über qty_avg',
  );
  assert.match(
    fin,
    /parseFloat\(d\.totals\.avg\s*\|\|\s*'?0'?\)/,
    'Die Summen sind als „Ø Marktpreis" beschriftet und müssen totals.avg nehmen',
  );
  assert.match(
    fin,
    /(?:parseFloat|Number)\(it\.avg_price \?\? it\.qty_avg_price \?\? 0\)/,
    'Teile- und Minifiguren-Zeilen: avg_price zuerst',
  );
  assert.doesNotMatch(fin, /parseFloat\(d\.totals\.qty_avg/, 'Keine Summe darf mehr auf qty_avg basieren');

  // The second market price column has meanwhile been dropped entirely — the target form
  // is checked by the test “finances: purchase price instead of a second market price column”.
  // finance.qty_avg was removed with the column — no dead key.
  const i18n = require('./helpers/sources').i18nAll();
  assert.doesNotMatch(i18n, /'finance\.qty_avg':/, 'Der Schlüssel gehört mit der Spalte entfernt');
});

test('finances: purchase price instead of a second market price column', () => {
  const fin = fs.readFileSync(path.join(ROOT, 'public', 'js', 'finances.js'), 'utf8');
  // The sets table had two price columns for the same concept.
  assert.doesNotMatch(fin, /t\('finance\.qty_avg'\)/, 'Die mengengewichtete Spalte ist entfallen');
  // Cost (quantity × purchase price) before market price, the same for all three tables.
  // The header may be a sort button (sortButton), the order stays.
  assert.match(
    fin,
    /<th[^>]*>(?:<abbr[^>]*>)?\$\{(?:t(?:Raw)?\('finance\.col\.purchase'\)|sortButton\('kauf', \w+, tRaw\('finance\.col\.purchase'\)\))\}(?:<\/abbr>)?<\/th>`(?:\s*\+ `|\}\$\{html`)<th[^>]*>\$\{(?:t(?:Raw)?\('(?:detail\.market_price|finance\.grand\.value)'\)|sortButton\('value', \w+, tRaw\('finance\.grand\.value'\)\))\}/,
    'Sets-Tabelle: Kaufpreis vor Marktpreis, wie bei Teilen und Minifiguren',
  );
  // fmtMoney instead of fmtN: a purchase price of 0 (gift) stands there as „0,00 €“.
  assert.match(fin, /if \(n <= 1\) return fmtMoney\(p, cur\);/, 'Die Kaufpreis-Spalte muss den Wert auch anzeigen');

  // The weighting of the purchase price has moved from the SQL into weightedPurchase()
  // — it is now computed over the same rows that also stand in
  // the table. Thus row sum and header number can no longer
  // auseinanderlaufen.
  const sv = fs.readFileSync(path.join(ROOT, 'src/finances/setValue.ts'), 'utf8');
  assert.match(
    sv,
    /withCost\.reduce\(\(s, r\) => s \+ \(r\.purchase_price as number\) \* r\.quantity, 0\) \/ qty/,
    'Der Kaufpreis muss mengengewichtet gemittelt werden: 2x100 + 1x160 ergibt 120, nicht 130',
  );
  assert.match(sv, /r\.purchase_price != null/, 'Erfassungen ohne Kaufpreis dürfen den Nenner nicht aufblähen');

  // The valuation takes exclusively the weighted purchase price from the
  // acquisitions, no fallback to a column of the inventory row.
  const fc = require('./helpers/sources').finanzQuelle();
  assert.match(
    fc,
    /const purchase = weightedPurchase\(rows\);/,
    'Die Bewertung muss den Kaufpreis aus den Erfassungen nehmen, ohne Rueckfall',
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
  assert.ok(i > 0, 'Die Nachfrage nach dem Preisverlauf fehlt');
  const fn = src.slice(i, i + 500);
  assert.match(
    fn,
    /!openSet \|\| openSet\.set_number !== sn/,
    'Die späte Antwort prüft nicht, ob noch dasselbe Set offen ist',
  );
});

test('preview generation is capped', () => {
  // Marco's measurement
  const server = require('./helpers/sources').serverAll();
  const parallel = server.match(/const THUMB_MAX_PARALLEL = (\d+)/);
  assert.ok(parallel, 'THUMB_MAX_PARALLEL nicht gefunden');
  assert.ok(
    parseInt(parallel[1], 10) <= 1,
    `THUMB_MAX_PARALLEL = ${parallel[1]} — im Cluster vervielfacht sich das je ` +
      'Arbeitsprozess. Einer je Prozess genügt: Die Vorschau ist eine ' +
      'Beschleunigung für später, nichts, worauf jemand wartet.',
  );
  assert.match(
    server,
    /_thumbQueue\.length >= THUMB_MAX_QUEUE/,
    'Die Warteschlange hat keine Obergrenze — wer schnell durchscrollt, staut ' +
      'den halben Katalog auf, und der Server rechnet ihn stur ab',
  );

  // And the limit must apply to the WHOLE server
  assert.match(
    server,
    /pg_try_advisory_lock\(\$1\)/,
    'Die Vorschau-Erzeugung hat keine prozessübergreifende Sperre — dann rechnet ' +
      'jeder Arbeitsprozess für sich, und die Grenze oben ist wirkungslos',
  );
  // try, do not wait: whoever does not get the lock leaves it. A waiting
  // run would hold a database connection and back up the work again after all.
  assert.doesNotMatch(
    server,
    /pg_advisory_lock\(\$1\)/,
    'Ein WARTENDER Lock staut die Arbeit nur an anderer Stelle auf',
  );
  assert.match(
    server,
    /pg_advisory_unlock\(\$1\)/,
    'Ohne Freigabe blockiert der erste Lauf alle folgenden bis zum Neustart',
  );

  // And the catalog produces no previews at all
  assert.match(
    server,
    /const createMay = req\.query\.gen !== '0'/,
    'Der Proxy kennt kein „Vorschau nutzen, aber keine erzeugen"',
  );
  const kat = fs.readFileSync(path.join(ROOT, 'public', 'js', 'catalog.js'), 'utf8');
  assert.match(kat, /imgUrl\(thumbUrl\(src\), 'only'\)/, 'Die Katalog-Kachel lässt weiter Verkleinerungen erzeugen');
  // The gallery does NOT — there it pays off.
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', 'collection.js'), 'utf8');
  assert.match(
    gal,
    /imgUrl\(thumbUrl\(src\)\s*\|\|\s*src,\s*true\)/,
    'Der eigene Bestand sollte weiterhin Vorschauen bekommen',
  );
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
      `acq_count=${acq}, used_count=${used}: Bewertung und Anzeige weichen ab`,
    );
  }
  assert.equal(effectiveCondition({ acq_count: 2, used_count: 1 }), 'U', 'eine gebrauchte Erfassung genügt');
  assert.equal(effectiveCondition(null), 'N', 'ohne Erfassungen gilt „Neu“');
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
  assert.deepEqual(d.x, ['2026-01-02', '2026-01-03'], 'Die Achse trägt die Messtage beider Reihen');
  assert.deepEqual(
    d.values[1].values.map((/** @type {any} */ p) => p.y),
    [0, 7],
    'Leere Positionen werden mit 0 aufgefüllt',
  );
  assert.equal(
    d.values[1].firstRealIndex,
    1,
    'Ohne diesen Index kann ein Renderer die aufgefüllten Nullen nicht überspringen',
  );
  assert.equal(d.values[0].firstRealIndex, 0);
  assert.equal(
    buildChart([{ name: 'empty-state', rows: [] }]).values[0].firstRealIndex,
    0,
    'Eine leere Reihe zeigt hinter ihr Ende',
  );

  // All three history endpoints must use it.
  const ph = fs.readFileSync(path.join(ROOT, 'src/finances/priceHistory.ts'), 'utf8');
  // Since hardened-96 parts and minifigure history are also in
  // src/finances/priceHistory.ts (the Android routes need the same response) — they
  // share ONE build there, hence buildChart stands twice in the
  // file: once for sets, once for both manual kinds.
  const uses = (ph.match(/buildChart\(/g) || []).length;
  assert.equal(uses, 2, `${uses} statt 2 buildChart-Aufrufe in src/finances/priceHistory.ts`);
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
  assert.match(admin, /slice\(sd\.firstRealIndex \?\? 0\)/, 'priceChartSVG muss führende Nullen überspringen');
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

  assert.equal(rows.length, 2, 'Zwei Kaufpreise → zwei Zeilen');
  assert.equal(rows[0].avg_price, 148.72, 'Die Neu-Zeile bekommt den Neupreis');
  assert.equal(rows[1].avg_price, 92.68, 'Die Gebraucht-Zeile bekommt den Gebrauchtpreis');
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
  assert.equal(rows[0].purchase_price, null, 'nicht erfasst bleibt null, nicht 0');
  assert.equal(rows[0].pnl_pct, null, 'gegen nichts gerechnet ergibt keine Zahl');
  assert.equal(rows[1].purchase_price, 0, 'ein Geschenk ist erfasst: 0, nicht null');
  assert.equal(rows[1].pnl_pct, null, 'gegen 0 gerechnet gibt es keine Prozentzahl');
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
  assert.equal(weightedPurchase([]), null, 'keine Zeile mit Preis → kein Kaufpreis');
});

test('row sums and set unit price match', () => {
  // The table shows both. If they differ, two truths stand
  // side by side — exactly that was the reason to bring the calculation here.
  const acqs = [acq(1, 'N', 2, 100), acq(2, 'U', 1, 60)];
  const p = prices(150, 90);
  const rows = valueAcquisitionRows(SN, acqs, p);
  const v = valueSet(SN, acqs, p);
  const sumRows = rows.reduce((s, r) => s + parseFloat(r.total_avg), 0);
  assert.equal(sumRows, v.total, 'Σ Zeilen = Gesamtwert des Sets');
  assert.equal(
    Math.round(v.unit_price * v.quantity * 100) / 100,
    v.total,
    'Stückpreis × Menge = Gesamtwert (so rechnen Webapp und Android)',
  );
});

test('purchase price 0 yields no percentage, no jump to infinity', () => {
  assert.equal(pnlPct(0, 50), null);
  assert.equal(pnlPct(40, 50), '25.0');
  assert.equal(pnlPct(null, 50), null);
  assert.equal(pnlPct(50, null), null);
});
