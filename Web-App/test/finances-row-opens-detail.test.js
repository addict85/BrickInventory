/**
 * A part or minifigure row of the finances overview opens its detail (#man-detail-modal), even if a search
 * stands in the parts and minifigures tabs: the finances table shows the stock without these filters, so the
 * detail must find the entry without them as well.
 *
 * Counter-check (measured on 07.11.2026): openManDetail() in kauf-dialoge.js as before —
 * if the entry is missing in the cache, reload loadManualParts()/loadManualFigsTable() (with the tab's search)
 * → red: “with search in the tabs”, title { teil: null, figur: null } (the dialog stayed closed, only
 * /v2/parts/manual?search=Plate or /v2/minifigs/manual?search=Marty came). “without filter” stayed green.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte, ANMELDUNG } = require('./helpers/ui');

const teil = {
  id: 1,
  user_id: 1,
  part_number: '3001',
  color_id: 4,
  part_name: 'Brick 2 x 4',
  color_name: 'Red',
  quantity: 2,
  source: 'manual',
  avg_price: 0.5,
  value_total: 1,
  acquisitions: [],
};
const figur = {
  id: 2,
  user_id: 1,
  fig_number: 'fig-000002',
  fig_name: 'Doc Brown',
  quantity: 1,
  source: 'manual',
  avg_price: 3,
  value_total: 3,
  acquisitions: [],
};

// Like the server: with a search (that hits nothing) the list stays empty.
const filtered = (schluessel, entryRow) => url => ({
  success: true,
  [schluessel]: /[?&]search=/.test(String(url)) ? [] : [entryRow],
});

async function openIt() {
  const o = await openUi({
    '/v2/finance/parts-valuation': { ...ANMELDUNG['/v2/finance/parts-valuation'], parts: [teil], total_value: '1.00' },
    '/v2/finance/minifigs-valuation': {
      ...ANMELDUNG['/v2/finance/minifigs-valuation'],
      figs: [figur],
      total_value: '3.00',
    },
    '/v2/parts/manual': filtered('parts', teil),
    '/v2/minifigs/manual': filtered('figs', figur),
  });
  return o;
}

/** Click the row (not the row button) and return the dialog title; close it again afterwards. */
async function clickIt(o, kind) {
  const row = o.d.querySelector(`#fin-tbl [data-fin-kind="${kind}"] tbody tr[data-click="openManDetail"]`);
  assert.ok(row, `no ${kind} row in the finance table`);
  const m = o.d.getElementById('man-detail-modal');
  row.querySelector('td.fin-value').click();
  const open = await warte(() => m.classList.contains('open'), 2000);
  const titel = o.d.getElementById('man-detail-tit').textContent;
  if (open) m.querySelector('[data-click="closeManDetail"]').click();
  await o.ruhig();
  return open ? titel : null;
}

for (const [fall, suche] of [
  ['ohne Filter', false],
  ['mit Suche in den Reitern', true],
]) {
  test(`finances: part and figure row open the detail (${fall})`, async () => {
    const o = await openIt();
    try {
      if (suche) {
        o.d.getElementById('parts-search').value = 'Plate';
        o.d.getElementById('fig-search').value = 'Marty';
      }
      await reiter(o.w, 'finance');
      assert.ok(
        await warte(() => o.d.querySelectorAll('#fin-tbl tr[data-click="openManDetail"]').length === 2, 3000),
        'Test data: one part row and one minifig row each',
      );
      await o.ruhig();
      const titel = { teil: await clickIt(o, 'parts'), figur: await clickIt(o, 'figs') };
      assert.deepEqual(titel, { teil: 'Brick 2 x 4', figur: 'Doc Brown' }, 'every row opens its own detail');
      const urls = o.aufrufe.map(a => a.url);
      assert.ok(
        urls.some(u => u.includes('/v2/parts/3001/4/acquisitions')),
        'Purchase prices of the part loaded',
      );
      assert.ok(
        urls.some(u => u.includes('/v2/minifigs/fig-000002/acquisitions')),
        'Purchase prices of the minifig loaded',
      );
      assert.deepEqual(o.error, []);
    } finally {
      o.w.close();
    }
  });
}
