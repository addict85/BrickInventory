/**
 * Amounts stand in the country form of the browser if it matches the language:
 * de-DE with a thousands dot and decimal comma, de-CH with an apostrophe and dot.
 * Without a matching region (browser „de“ or English) the account currency
 * decides: CHF writes Swiss, otherwise German format.
 *
 * Counter-checks:
 *   (28.10.2026) locale() fixed 'de-CH' → red: “de-DE” (1’097.93 instead of 1.097,93)
 *   (05.11.2026) fallback again fixed 'de-CH' → red: “without a matching region:
 *     EUR German” (1’097.93); fallback fixed 'de-DE' → red: “… CHF Swiss”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor } = require('./helpers/ui');

const response = currency => ({
  '/v2/settings/raw': { success: true, settings: { currency: currency, language: 'de', rebrickable_api_key: 'probe' } },
  '/v2/finance/valuation': {
    success: true,
    currency: currency,
    totals: { min: '0', avg: '0', max: '0' },
    sets: [
      {
        set_number: '10294-1',
        name: 'Titanic',
        quantity: 1,
        purchase_price: 1097.93,
        avg_price: 0,
        total_avg: '0',
        acquisitions: [{ id: 1, condition: 'N', quantity: 1, purchase_price: 1097.93 }],
      },
    ],
  },
  '/v2/finance/pnl': {
    success: true,
    currency: currency,
    sets: [],
    totals: { purchase: '1097.93', sets_purchase: '1097.93' },
  },
});

async function entryPrice(browserLanguage, currency = 'EUR') {
  const o = await openUi(response(currency), { browserLanguage });
  try {
    await switchTab(o.w, 'finance');
    await waitFor(() => o.d.getElementById('fin-cost-basis').textContent.includes('1'));
    return o.d.getElementById('fin-cost-basis').textContent.replace(/ /g, ' ');
  } finally {
    o.w.close();
  }
}

test('de-DE', async () => {
  assert.match(await entryPrice('de-DE'), /1\.097,93/);
});

// The apostrophe depends on the ICU version: Node 22 sets ’, Node 26 sets '.
test('de-CH stays Swiss, even in EUR', async () => {
  assert.match(await entryPrice('de-CH'), /1['’]097\.93/);
});

test('without a matching region: EUR German', async () => {
  for (const b of ['de', 'en-US']) assert.match(await entryPrice(b), /^1\.097,93\s€$/, b);
});

test('without a matching region: CHF Swiss', async () => {
  assert.match(await entryPrice('en-US', 'CHF'), /1['’]097\.93/);
});
