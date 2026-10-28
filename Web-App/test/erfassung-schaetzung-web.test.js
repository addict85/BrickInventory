/**
 * Die Weboberfläche zeigt eine Erfassung in ihrer eigenen Währung und einen
 * eingesetzten Marktpreis mit „≈“ — am echten Bündel in jsdom.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in erfassungsPreis() `a.currency ||` weggelassen → rot: „jede Erfassung
 *      in ihrer Währung“ (CHF als EUR formatiert)
 *   B  den Zweig für price_estimated entfernt → rot: „ein geschätzter Preis
 *      trägt ≈“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt } = require('./helpers/oberflaeche');

const ANTWORTEN = {
  '/v1/parts/manual': { success: true, parts: [
    { part_number: '3001', color_id: 4, part_name: 'Brick 2 x 4', color_name: 'Red', quantity: 3, user_id: 1, source: 'manual' },
  ] },
  '/v1/parts/3001/4/acquisitions': { success: true, acquisitions: [
    { id: 7, quantity: 2, unit_price: 3.5, condition: 'U', price_estimated: true, currency: 'CHF',
      created_at: '2026-10-28T08:00:00Z', owner_user_id: 1 },
    { id: 8, quantity: 1, unit_price: 1.25, condition: 'N', price_estimated: false, currency: 'EUR',
      created_at: '2026-10-27T08:00:00Z', owner_user_id: 1 },
  ], totals: { quantity: 3, amount: 8.25, priced_rows: 2 } },
};

async function detail() {
  const o = await oeffneOberflaeche(ANTWORTEN);
  const knopf = o.d.createElement('button');
  Object.assign(knopf.dataset, { click: 'openManDetail', arg: 'part', arg2: '3001', arg3: '4' });
  o.d.body.appendChild(knopf);
  knopf.click();
  await warte(() => /3[.,]50/.test(o.d.getElementById('man-detail-body')?.textContent || ''));
  await takt(20);
  return o;
}

test('jede Erfassung in ihrer Währung', async () => {
  const { w, d } = await detail();
  try {
    const text = d.getElementById('man-detail-body').textContent;
    // jsdom formatiert ohne volle ICU-Daten als „CHF 3.50“, ein Browser als
    // „3,50 CHF“ — geprüft wird die Währung am Betrag, nicht die Schreibweise.
    const flach = text.replace(/\s+/g, ' ');
    assert.match(flach, /CHF ?3[.,]50|3[.,]50 ?CHF/, `CHF fehlt: ${flach.slice(0, 600)}`);
    assert.match(flach, /(EUR|€) ?1[.,]25|1[.,]25 ?(EUR|€)/, 'die EUR-Erfassung bleibt in EUR');
  } finally { w.close(); }
});

test('ein geschätzter Preis trägt ≈', async () => {
  const { w, d } = await detail();
  try {
    const zeichen = [...d.querySelectorAll('#man-detail-body [role="img"]')].filter(e => e.textContent === '≈');
    assert.equal(zeichen.length, 1, 'genau die geschätzte Erfassung trägt ≈');
    assert.match(zeichen[0].getAttribute('aria-label'), /Geschätzt/);
  } finally { w.close(); }
});
