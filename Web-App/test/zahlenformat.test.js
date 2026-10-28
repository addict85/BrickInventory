/**
 * Beträge stehen in der Landesform des Browsers: de-DE mit Tausenderpunkt
 * und Dezimalkomma, de-CH mit Hochkomma und Punkt. Vorher war es fest de-CH.
 *
 * Gegenprobe (am 28.10.2026 gemessen): locale() wieder fest 'de-CH' → rot:
 * „de-DE“ (1’097.93 statt 1.097,93).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const ANTWORT = {
  '/v1/finance/valuation': { success: true, currency: 'EUR', totals: { min: '0', avg: '0', max: '0' },
    sets: [{ set_number: '10294-1', name: 'Titanic', quantity: 1, purchase_price: 1097.93, avg_price: 0, total_avg: '0',
             acquisitions: [{ id: 1, condition: 'N', quantity: 1, purchase_price: 1097.93 }] }] },
  '/v1/finance/pnl': { success: true, currency: 'EUR', sets: [], totals: { purchase: '1097.93', sets_purchase: '1097.93' } },
};

async function einstand(browserSprache) {
  const o = await oeffneOberflaeche(ANTWORT, { browserSprache });
  try {
    await reiter(o.w, 'finance');
    await warte(() => o.d.getElementById('fin-einstand').textContent.includes('1'));
    return o.d.getElementById('fin-einstand').textContent.replace(/ /g, ' ');
  } finally { o.w.close(); }
}

test('de-DE', async () => {
  assert.match(await einstand('de-DE'), /1\.097,93/);
});

// Das Hochkomma hängt an der ICU-Fassung: Node 22 setzt ’, Node 26 setzt '.
test('de-CH und ohne Landesangabe', async () => {
  assert.match(await einstand('de-CH'), /1['’]097\.93/);
  assert.match(await einstand('en-US'), /1['’]097\.93/, 'deutsche Oberfläche, fremder Browser: de-CH');
});
