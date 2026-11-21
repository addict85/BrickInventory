/**
 * One tile, several owners — which price and which P&L does it show?
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  in tileValues() with several rows take the last instead of the weighted
 *      one → red: “… weighted by quantity” (750 instead of 142.9)
 *   B  with one row pnl_pct before baseline_pnl_pct → red: “the server
 *      value stays” (1.1 instead of 77.7)
 *   C  in sammlung.js again `price: s.current_price` → red: “the web
 *      takes over the server values”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { tileValues } = _req('src/finances/setValue.js');
const kachel = (zeilen, nr) => tileValues(zeilen.map(z => ({ purchase_price: null, pnl_pct: null, ...z }))).get(nr);

test('several owners: the tile price is weighted by quantity', () => {
  // The measured case without acquisition rows: two accounts, one set, 600 and 100.
  const k = kachel(
    [
      { set_number: '75192-1', quantity: 1, baseline_price: 600, current_price: 850, baseline_pnl_pct: '41.7' },
      { set_number: '75192-1', quantity: 1, baseline_price: 100, current_price: 850, baseline_pnl_pct: '750.0' },
    ],
    '75192-1',
  );
  assert.equal(k.kachel_pnl_pct, 142.9, '(600+100)/2 = 350 gegen 850 — nicht die zuletzt gelesene Zeile');
  assert.equal(k.kachel_preis, 850, 'Der Marktpreis ist in beiden Zeilen derselbe');
});

test('several owners with entered purchase prices: unchanged', () => {
  const k = kachel(
    [
      { set_number: '75192-1', quantity: 1, baseline_price: 350, current_price: 850, baseline_pnl_pct: '142.9' },
      { set_number: '75192-1', quantity: 1, baseline_price: 350, current_price: 850, baseline_pnl_pct: '142.9' },
    ],
    '75192-1',
  );
  assert.equal(k.kachel_pnl_pct, 142.9);
});

test('different quantities weigh differently', () => {
  // Three copies at 100, one at 500: (3·100 + 500)/4 = 200.
  const k = kachel(
    [
      { set_number: '6346-1', quantity: 3, baseline_price: 100, current_price: 400, baseline_pnl_pct: '300.0' },
      { set_number: '6346-1', quantity: 1, baseline_price: 500, current_price: 400, baseline_pnl_pct: '-20.0' },
    ],
    '6346-1',
  );
  assert.equal(k.kachel_pnl_pct, 100, 'Gewichtet 200 gegen 400; ein einfacher Mittelwert ergäbe 33,3 %');
});

test('one row: the server value stays', () => {
  const k = kachel(
    [
      {
        set_number: '21318-1',
        quantity: 2,
        baseline_price: 7,
        current_price: 400,
        pnl_pct: '1.1',
        baseline_pnl_pct: '77.7',
      },
    ],
    '21318-1',
  );
  assert.equal(k.kachel_pnl_pct, 77.7, 'Bei einer Zeile wird nicht neu gerechnet — sonst stünde hier 5614,3 %');
});

test('without purchase price and without market price there is no percentage and no amount', () => {
  const k = kachel(
    [
      { set_number: '10290-1', quantity: 1, baseline_price: null, current_price: 0, baseline_pnl_pct: null },
      { set_number: '10290-1', quantity: 1, baseline_price: null, current_price: 0, baseline_pnl_pct: null },
    ],
    '10290-1',
  );
  assert.deepEqual(k, { kachel_preis: null, kachel_pnl_pct: null, kachel_quelle: null });
});

test('the web takes over the server values', () => {
  // Run enrichGalleryWithPrices() with a response and look at what
  // arrives at the tile — without a browser, via the module function itself.
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'collection.js'), 'utf8');
  const von = src.indexOf('  setPnlBySet({});');
  const bis = src.indexOf('  // Inject price data into cached sets');
  assert.ok(von > 0 && bis > von, 'enrichGalleryWithPrices() nicht gefunden — umgebaut?');
  const pnlBySet = {};
  // eslint-disable-next-line no-new-func
  new Function('pnl', 'pnlBySet', 'setPnlBySet', src.slice(von, bis))(
    {
      sets: [
        { set_number: 'A-1', current_price: 99, kachel_preis: 10.5, kachel_pnl_pct: 12.3, kachel_quelle: 'kauf' },
        { set_number: 'A-1', current_price: 99, kachel_preis: 10.5, kachel_pnl_pct: 12.3, kachel_quelle: 'kauf' },
      ],
    },
    pnlBySet,
    () => {},
  );
  assert.deepEqual(pnlBySet, { 'A-1': { price: 10.5, pnl_pct: 12.3, quelle: 'kauf' } });
});
