/**
 * BrickLink link resolution for catalog sets (src/catalog/bricklinkLink.ts).
 *
 * Counter-checks (measured 08.11.2026, on the bundle in jsdom):
 *   A  in openCatModal back to `blBtn.style.display = bl ? '' : 'none'` → red:
 *      “the buy button takes the server's address …” (case without resolution)
 *   B  `blBtn.href` built from the set number again
 *      (`…catalogitem.page?S=${s.set_number}`) → red: the same check
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

// Build to dist/ instead of in place — see helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { withVariant, bareNumber, blAddress, blSearchUrl } = _req('src/catalog/bricklinkLink.js');

test('withVariant adds the Rebrickable suffix', () => {
  assert.equal(withVariant('75192'), '75192-1');
  assert.equal(withVariant('75192-1'), '75192-1');
  assert.equal(withVariant('10179-2'), '10179-2');
  assert.equal(withVariant('  75192  '), '75192-1');
});

test('bareNumber removes it again — BrickLink lists gear/book without suffix', () => {
  assert.equal(bareNumber('5005358-1'), '5005358');
  assert.equal(bareNumber('5005358'), '5005358');
  assert.equal(bareNumber('10179-2'), '10179');
});

test('blAddress uses the right parameter per item type', () => {
  const set = blAddress('SET', '75192-1');
  assert.match(set, /\?S=75192-1/);
  assert.match(set, /#T=S/);

  const gear = blAddress('GEAR', '5005358');
  assert.match(gear, /\?G=5005358/);
  assert.match(gear, /#T=G/, 'Der For-Sale-Tab muss zum Item-Typ passen, sonst öffnet BrickLink den falschen Reiter');

  const book = blAddress('BOOK', 'b12ab');
  assert.match(book, /\?B=b12ab/);
  assert.match(book, /#T=B/);
});

test('blAddress also knows MINIFIG', () => {
  const m = blAddress('MINIFIG', 'col325');
  assert.match(m, /\?M=col325/);
  assert.match(m, /#T=M/);
});

test('blAddress returns null for NONE — the caller falls back to the search', () => {
  assert.equal(blAddress('NONE', 'x-1'), null);
});

test('blSearchUrl applies where no deep link can be constructed', () => {
  // Collectible minifigures: Rebrickable lists them as a set (71021-1), BrickLink as
  // MINIFIG with another number (col325). The mapping exists in neither of the
  // two data sources — a deep link cannot be derived in principle.
  const u = blSearchUrl('71021-1');
  assert.match(u, /search\.page\?q=71021/);
  assert.ok(!u.includes('-1'), 'Der Variantensuffix engt die Suche unnötig ein');
});

test('blAddress encodes special characters in the number', () => {
  const url = blAddress('SET', '10 30-1');
  assert.ok(!/\?S=10 30/.test(url), 'Leerzeichen muss kodiert werden');
  assert.match(url, /\?S=10%2030-1/);
});

test('set links keep the suffix, gear links do not', () => {
  // That is the actual bug that was fixed: the same
  // Rebrickable number yields two different URLs depending on the BrickLink type.
  assert.match(blAddress('SET', withVariant('5005358')), /\?S=5005358-1/);
  assert.match(blAddress('GEAR', bareNumber('5005358-1')), /\?G=5005358(?!-)/);
});

test("the buy button takes the server's address and is never hidden", async () => {
  const SEARCH = 'https://www.bricklink.com/v2/search.page?q=col001';
  const GEAR = 'https://www.bricklink.com/v2/catalog/catalogitem.page?G=5005358';
  const set = (nr, bricklink) => ({ set_number: nr, name: `Artikel ${nr}`, year: 2020, num_parts: 1, bricklink });
  const { w, d } = await openUi({
    '/v2/catalog/sets': { success: true, total: 3, sets: [set('col001-1'), set('5005358-1'), set('99999-1')] },
    '/v2/catalog/sets/col001-1': {
      success: true,
      set: set('col001-1', { url: SEARCH, exact: false, type: 'MINIFIG', number: 'col001' }),
    },
    '/v2/catalog/sets/5005358-1': {
      success: true,
      set: set('5005358-1', { url: GEAR, exact: true, type: 'GEAR', number: '5005358' }),
    },
    '/v2/catalog/sets/99999-1': { success: true, set: set('99999-1', null) },
  });
  try {
    await reiter(w, 'catalog');
    const knopf = () => d.getElementById('cat-m-bricklink');
    for (const [nr, href, text] of [
      ['col001-1', SEARCH, 'Auf BrickLink suchen'],
      ['5005358-1', GEAR, 'Auf BrickLink kaufen'],
      // Without resolution the search for the number — not a hidden button.
      ['99999-1', 'https://www.bricklink.com/v2/search.page?q=99999-1', 'Auf BrickLink kaufen'],
    ]) {
      assert.ok(await warte(() => d.querySelector(`[data-click="openCatModal"][data-arg="${nr}"]`)), `Kachel ${nr}`);
      d.querySelector(`[data-click="openCatModal"][data-arg="${nr}"]`).click();
      assert.ok(await warte(() => d.getElementById('cat-m-sub').textContent === nr), `Dialog ${nr}`);
      assert.deepEqual(
        [knopf().style.display, knopf().getAttribute('href'), knopf().textContent.trim()],
        ['', href, text],
        nr,
      );
    }
  } finally {
    w.close();
  }
});
