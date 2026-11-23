/**
 * The web UI shows an entry in its own currency and an
 * inserted market price with “≈” — on the real bundle in jsdom.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  in erfassungsPreis() `a.currency ||` omitted → red: “every entry
 *      in its currency” (CHF formatted as EUR)
 *   B  the branch for price_estimated removed → red: “an estimated price
 *      carries ≈”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor, tick } = require('./helpers/ui');

const RESPONSES = {
  '/v2/parts/manual': {
    success: true,
    parts: [
      {
        part_number: '3001',
        color_id: 4,
        part_name: 'Brick 2 x 4',
        color_name: 'Red',
        quantity: 3,
        user_id: 1,
        source: 'manual',
      },
    ],
  },
  '/v2/parts/3001/4/acquisitions': {
    success: true,
    acquisitions: [
      {
        id: 7,
        quantity: 2,
        unit_price: 3.5,
        condition: 'U',
        price_estimated: true,
        currency: 'CHF',
        created_at: '2026-10-28T08:00:00Z',
        owner_user_id: 1,
      },
      {
        id: 8,
        quantity: 1,
        unit_price: 1.25,
        condition: 'N',
        price_estimated: false,
        currency: 'EUR',
        created_at: '2026-10-27T08:00:00Z',
        owner_user_id: 1,
      },
    ],
    totals: { quantity: 3, amount: 8.25, priced_rows: 2 },
  },
};

async function detail() {
  const o = await openUi(RESPONSES);
  const button = o.d.createElement('button');
  Object.assign(button.dataset, { click: 'openManDetail', arg: 'part', arg2: '3001', arg3: '4' });
  o.d.body.appendChild(button);
  button.click();
  await waitFor(() => /3[.,]50/.test(o.d.getElementById('man-detail-body')?.textContent || ''));
  await tick(20);
  return o;
}

test('every acquisition in its currency', async () => {
  const { w, d } = await detail();
  try {
    const text = d.getElementById('man-detail-body').textContent;
    // jsdom formats as “CHF 3.50” without full ICU data, a browser as
    // “3,50 CHF” — what is checked is the currency at the amount, not the notation.
    const flat = text.replace(/\s+/g, ' ');
    assert.match(flat, /CHF ?3[.,]50|3[.,]50 ?CHF/, `CHF is missing: ${flat.slice(0, 600)}`);
    assert.match(flat, /(EUR|€) ?1[.,]25|1[.,]25 ?(EUR|€)/, 'the EUR acquisition stays in EUR');
  } finally {
    w.close();
  }
});

test('an estimated price carries ≈', async () => {
  const { w, d } = await detail();
  try {
    const chars = [...d.querySelectorAll('#man-detail-body [role="img"]')].filter(e => e.textContent === '≈');
    assert.equal(chars.length, 1, 'exactly the estimated acquisition carries ≈');
    assert.match(chars[0].getAttribute('aria-label'), /geschätzt/i);
  } finally {
    w.close();
  }
});
