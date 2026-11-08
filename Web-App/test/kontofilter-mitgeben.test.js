/**
 * Was der Kontofilter neu lädt, muss den Kontofilter auch mitschicken. Am
 * echten Bündel in jsdom: Haushalt mit einem Unterkonto, je Reiter den Filter
 * auf das Unterkonto stellen und jede Anfrage danach ansehen.
 * Ausführlich: docs/begruendungen/test/kontofilter-mitgeben.test.js.md#kopf
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln):
 *   A  in onScopeChange beim Reiter Teile `loadManualParts()` gestrichen →
 *      rot (die manuellen Teile werden nicht neu geladen)
 *   B  in manuellQuery() `addScopeParam(p, view)` gestrichen → rot (die
 *      manuellen Teile und Figuren kommen ohne accounts)
 *   C  in onScopeChange beim Reiter Minifiguren `loadManualFigsTable()`
 *      gestrichen → grün: loadMinifigs() holt die manuellen Figuren selbst mit
 *      (mit Filter), der Fall ist also abgedeckt, nur nicht doppelt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter } = require('./helpers/oberflaeche');

/** Was jeder Reiter nach dem Wechsel neu holen muss — mit dem Filter. */
const NEU_GELADEN = {
  gallery: ['/v1/sets', '/v1/stats'],
  parts: ['/v1/parts', '/v1/parts/manual', '/v1/parts/stats', '/v1/parts/colors', '/v1/parts/categories'],
  minifigs: ['/v1/minifigs', '/v1/minifigs/manual', '/v1/minifigs/stats'],
  finance: ['/v1/finance/valuation', '/v1/finance/parts-valuation', '/v1/finance/minifigs-valuation', '/v1/finance/pnl'],
};

test('jeder Abruf hinter dem Kontofilter gibt den Kontofilter mit', async () => {
  const { w, d, aufrufe, ruhig } = await oeffneOberflaeche({
    '/v1/sets/household-members': { success: true, members: [
      { id: 1, username: 'anna', is_self: true, tiefe: 0 }, { id: 2, username: 'ben', is_self: false, tiefe: 1 }] },
  });
  try {
    for (const [ansicht, pfade] of Object.entries(NEU_GELADEN)) {
      await reiter(w, ansicht);
      await ruhig();
      const filter = d.getElementById(`scope-${ansicht}`);
      assert.ok([...filter.options].some(o => o.value === '2'), `${ansicht}: kein Unterkonto im Filter`);
      const ab = aufrufe.length;
      filter.value = '2';
      filter.dispatchEvent(new w.Event('change', { bubbles: true }));
      await ruhig();
      const neu = aufrufe.slice(ab).filter(a => a.method === 'GET').map(a => new URL(a.url, 'http://localhost'));
      const geholt = new Set(neu.map(u => u.pathname.replace(/^\/api/, '')));
      assert.deepEqual(pfade.filter(p => !geholt.has(p)), [], `${ansicht}: nicht neu geladen`);
      assert.deepEqual(neu.filter(u => u.searchParams.get('accounts') !== '2').map(u => u.pathname + u.search), [],
        `${ansicht}: ohne Kontofilter geholt`);
    }
  } finally { w.close(); }
});
