/**
 * Dieselben Namen und Schreibweisen wie die Android-App: „Bauliste“ / „Build
 * list“ statt „Teileliste“, Mengen als „×N“, Zustand „Neuware“ statt „Neu“.
 * Am echten Bündel in jsdom, in beiden Sprachen.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln):
 *   A  nav.partslist (de) wieder „Teileliste“ → rot: „de: Bauliste …“
 *   B  partsCard wieder `${…}×` → rot: „Teilekachel zeigt ×N“
 *   C  common.condition_new (de) wieder „Neu“ → rot: „de: Bauliste …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

for (const [sprache, bauliste, neu] of [['de', 'Bauliste', 'Neuware'], ['en', 'Build list', 'New']]) {
  test(`${sprache}: ${bauliste} in Leiste und Überschrift, Zustand „${neu}“`, async () => {
    const { w, d } = await oeffneOberflaeche({}, { sprache });
    try {
      assert.equal(d.querySelector('.ntab[data-tab="partslist"] .tab-label').textContent.trim(), bauliste);
      assert.equal(d.querySelector('#tab-partslist .ptitle').textContent.trim(), bauliste);
      assert.equal(d.querySelector('#add-condition option[value="N"]').textContent.trim(), neu);
    } finally { w.close(); }
  });
}

test('Teilekachel zeigt ×N', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/parts': { success: true, total: 1, parts: [{ part_number: '3001', part_name: 'Brick 2 x 4', color_id: 5, color_name: 'Red', total_quantity: 12 }] },
  });
  try {
    await reiter(w, 'parts');
    await warte(() => !!d.querySelector('.part-card .part-qty'));
    assert.equal(d.querySelector('.part-card .part-qty').textContent.trim(), '×12');
  } finally { w.close(); }
});
