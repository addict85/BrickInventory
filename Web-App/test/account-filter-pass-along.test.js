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
const BACKGROUND = new Set(['/api/v1/sets/import/csv/status']);

/** What every tab must refetch after the change — with the filter. */
const NEW_LOADED = {
  gallery: ['/v1/sets', '/v1/stats'],
  parts: ['/v1/parts', '/v1/parts/manual', '/v1/parts/stats', '/v1/parts/colors', '/v1/parts/categories'],
  minifigs: ['/v1/minifigs', '/v1/minifigs/manual', '/v1/minifigs/stats'],
  finance: [
    '/v1/finance/valuation',
    '/v1/finance/parts-valuation',
    '/v1/finance/minifigs-valuation',
    '/v1/finance/pnl',
  ],
};

test('every fetch behind the account filter passes the account filter along', async () => {
  const { w, d, aufrufe, ruhig } = await openUi({
    '/v1/sets/household-members': {
      success: true,
      members: [
        { id: 1, username: 'anna', is_self: true, tiefe: 0 },
        { id: 2, username: 'ben', is_self: false, tiefe: 1 },
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
        `${ansicht}: kein Unterkonto im Filter`,
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
        `${ansicht}: nicht neu geladen`,
      );
      assert.deepEqual(
        neu.filter(u => u.searchParams.get('accounts') !== '2').map(u => u.pathname + u.search),
        [],
        `${ansicht}: ohne Kontofilter geholt`,
      );
    }
  } finally {
    w.close();
  }
});
