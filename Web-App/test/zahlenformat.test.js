/**
 * Beträge stehen in der Landesform des Browsers, wenn sie zur Sprache passt:
 * de-DE mit Tausenderpunkt und Dezimalkomma, de-CH mit Hochkomma und Punkt.
 * Ohne passende Region (Browser „de“ oder englisch) entscheidet die
 * Kontowährung: CHF schreibt Schweizer, sonst deutsches Format.
 *
 * Gegenproben:
 *   (28.10.2026) locale() fest 'de-CH' → rot: „de-DE“ (1’097.93 statt 1.097,93)
 *   (05.11.2026) Rückfall wieder fest 'de-CH' → rot: „ohne passende Region:
 *     EUR deutsch“ (1’097.93); Rückfall fest 'de-DE' → rot: „… CHF schweizerisch“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const antwort = (waehrung) => ({
  '/v1/settings/raw': { success: true, settings: { currency: waehrung, language: 'de', rebrickable_api_key: 'probe' } },
  '/v1/finance/valuation': { success: true, currency: waehrung, totals: { min: '0', avg: '0', max: '0' },
    sets: [{ set_number: '10294-1', name: 'Titanic', quantity: 1, purchase_price: 1097.93, avg_price: 0, total_avg: '0',
             acquisitions: [{ id: 1, condition: 'N', quantity: 1, purchase_price: 1097.93 }] }] },
  '/v1/finance/pnl': { success: true, currency: waehrung, sets: [], totals: { purchase: '1097.93', sets_purchase: '1097.93' } },
});

async function einstand(browserSprache, waehrung = 'EUR') {
  const o = await oeffneOberflaeche(antwort(waehrung), { browserSprache });
  try {
    await reiter(o.w, 'finance');
    await warte(() => o.d.getElementById('fin-einstand').textContent.includes('1'));
    return o.d.getElementById('fin-einstand').textContent.replace(/ /g, ' ');
  } finally { o.w.close(); }
}

test('de-DE', async () => {
  assert.match(await einstand('de-DE'), /1\.097,93/);
});

// Das Hochkomma hängt an der ICU-Fassung: Node 22 setzt ’, Node 26 setzt '.
test('de-CH bleibt schweizerisch, auch in EUR', async () => {
  assert.match(await einstand('de-CH'), /1['’]097\.93/);
});

test('ohne passende Region: EUR deutsch', async () => {
  for (const b of ['de', 'en-US']) assert.match(await einstand(b), /^1\.097,93\s€$/, b);
});

test('ohne passende Region: CHF schweizerisch', async () => {
  assert.match(await einstand('en-US', 'CHF'), /1['’]097\.93/);
});
