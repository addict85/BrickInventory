/**
 * Whatever the account filter reloads must also send the account filter. On the
 * real bundle in jsdom: household with a sub-account, per tab set the filter
 * to the sub-account and look at every request afterwards.
 *
 * Counter-checks (measured 08.11.2026, each alone):
 *   A  in onScopeChange for the parts tab `loadManualParts()` deleted →
 *      red (the manual parts are not reloaded)
 *   B  in manualQuery() `addScopeParam(p, view)` deleted → red (the
 *      manual parts and minifigures come without accounts)
 *   C  in onScopeChange for the minifigures tab `loadManualFigsTable()`
 *      deleted → green: loadMinifigs() fetches the manual minifigures itself
 *      (with filter), so the case is covered, just not twice.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter } = require('./helpers/ui');

// The CSV import status is polled on a timer, not by the filter change: if
// a poll falls into the window, it is not a fetch behind the account filter.
const BACKGROUND = new Set(['/api/v2/sets/import/csv/status']);

/** What every tab must refetch after the change — with the filter. */
const NEW_LOADED = {
  gallery: ['/v2/sets', '/v2/stats'],
  parts: ['/v2/parts', '/v2/parts/manual', '/v2/parts/stats', '/v2/parts/colors', '/v2/parts/categories'],
  minifigs: ['/v2/minifigs', '/v2/minifigs/manual', '/v2/minifigs/stats'],
  finance: [
    '/v2/finance/valuation',
    '/v2/finance/parts-valuation',
    '/v2/finance/minifigs-valuation',
    '/v2/finance/pnl',
  ],
};

test('every fetch behind the account filter passes the account filter along', async () => {
  const { w, d, aufrufe, ruhig } = await openUi({
    '/v2/sets/household-members': {
      success: true,
      members: [
        { id: 1, username: 'anna', is_self: true, depth: 0 },
        { id: 2, username: 'ben', is_self: false, depth: 1 },
      ],
    },
  });
  try {
    for (const [ansicht, pfade] of Object.entries(NEW_LOADED)) {
      await reiter(w, ansicht);
      await ruhig();
      const filter = d.getElementById(`scope-${ansicht}`);
      assert.ok(
        [...filter.options].some(o => o.value === '2'),
        `${ansicht}: no sub-account in the filter`,
      );
      const ab = aufrufe.length;
      filter.value = '2';
      filter.dispatchEvent(new w.Event('change', { bubbles: true }));
      await ruhig();
      const neu = aufrufe
        .slice(ab)
        .filter(a => a.method === 'GET')
        .map(a => new URL(a.url, 'http://localhost'))
        .filter(u => !BACKGROUND.has(u.pathname));
      const geholt = new Set(neu.map(u => u.pathname.replace(/^\/api/, '')));
      assert.deepEqual(
        pfade.filter(p => !geholt.has(p)),
        [],
        `${ansicht}: not reloaded`,
      );
      assert.deepEqual(
        neu.filter(u => u.searchParams.get('accounts') !== '2').map(u => u.pathname + u.search),
        [],
        `${ansicht}: fetched without account filter`,
      );
    }
  } finally {
    w.close();
  }
});
