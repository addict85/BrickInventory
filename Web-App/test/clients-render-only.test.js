/**
 * Neither UI recomputes money amounts.
 *
 * Counter-checks (measured 08.11.2026): in finanzen.js add up the total value
 * itself again (`const grandTotal = setsQtyAvg + extra`) → red: “the
 * web app shows the server's total value”. That the server delivers it
 * is checked by gift-guv-db.test.js (“the total value comes finished …”, C).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');
const { openUi, reiter, warte } = require('./helpers/ui');

/** Field names whose sum would be a business rule. */
const GELDFELDER =
  'display_value|total_value|purchase_price|unit_price|current_price|avg_price|qty_avg_price|market_price|price';

/**
 * Places that MAY form a sum — with rationale.
 *
 * Keep it short: every line here is an exception to the rule and should
 * explain why the server cannot deliver it.
 */
const ALLOWED = [
  // Progress bars compute percent from done/total — not money.
];

test('the web app sums no money amounts itself', () => {
  const dir = path.join(ROOT, 'public', 'js');
  const treffer = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js') && x !== 'app.bundle.js')) {
    const src = ohneKommentare(fs.readFileSync(path.join(dir, f), 'utf8'));
    const re = new RegExp(String.raw`reduce\((?:\([^)]*\)|\w+)\s*=>[^;]{0,120}?\.(${GELDFELDER})\b`, 'g');
    for (const m of src.matchAll(re)) {
      const row = src.slice(0, m.index).split('\n').length;
      const eintrag = `${f}:${row} summiert .${m[1]}`;
      if (!ALLOWED.includes(eintrag)) treffer.push(eintrag);
    }
  }
  assert.deepEqual(
    treffer,
    [],
    'Die Oberfläche bildet eine Geldsumme selbst:\n  ' +
      treffer.join('\n  ') +
      '\nDer Server liefert solche Summen fertig (total_value, totals.grand_total). ' +
      'Zwei Rechenwege bedeuten zwei Ergebnisse, sobald sich die Regel ändert.',
  );
});

test("the web app shows the server's total value", async () => {
  // Without a market price on the items the header number carries the total value; the server says 777,
  // the tables' own sum would be 0.
  const { w, d } = await openUi({
    '/v2/finance/pnl': {
      success: true,
      currency: 'EUR',
      sets: [],
      totals: { purchase: '0', current: '777.00', grand_total: '777.00' },
    },
  });
  try {
    await reiter(w, 'finance');
    assert.ok(
      await warte(() => /777/.test(d.getElementById('portfolio-current')?.textContent || '')),
      `Kopfzahl: ${d.getElementById('portfolio-current')?.textContent}`,
    );
  } finally {
    w.close();
  }
});
