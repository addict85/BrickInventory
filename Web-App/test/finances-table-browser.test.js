/**
 * Finances table on the desktop: the sum can be recomputed from the visible column,
 * and no table header wraps (1280 and 1440 px, DE and EN).
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  in setRow again `fmtMoney(purchase,cur)` instead of einstandZelle → red:
 *      “cost: column yields the sum” (column 250 €, sum 300 €)
 *   B  status column of the sets back to sp-40 and `.dt-fin th{white-space:nowrap;…}`
 *      removed → red: “headers in one line” (“Preis” two lines)
 *   C  in preisKoepfe() again the full header t('finance.total_pnl') → red:
 *      “headers in one line” (de 1280: Gewinn/Verlust sticks out over the column)
 *
 * Skipped without Chrome (CHROME_BIN, google-chrome, chromium).
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, sleep } = require('./helpers/app-browser');
const { holdsSet } = require('./helpers/inventory');

/** Visible text (without .vh) that wraps or sticks out over the cell. */
const WRAP = `[...document.querySelectorAll('.dt-fin thead th, .dt-sum thead th')].filter(e => e.getClientRects().length).map(th => {
  const tops = new Set(); let right = 0; const w = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim() || n.parentElement.closest('.vh')) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    for (const q of r.getClientRects()) { tops.add(Math.round(q.top)); right = Math.max(right, q.right); } }
  const cell = th.getBoundingClientRect();
  return (tops.size > 1 || right > cell.right + 0.5) ? th.textContent.trim() + ': ' + tops.size + ' Zeilen' : null; }).filter(Boolean)`;

test('finance table can be recalculated and without wrapping in the header', {
  concurrency: 1,
  timeout: 300_000,
}, async t => {
  const app = await startApp(t, {
    name: `fintab_${process.pid}`,
    holding: async (db, uid) => {
      await holdsSet(db, uid, '10294-1', 2, { price: 100 });
      await holdsSet(db, uid, '75192-1', 1, { price: 50 });
      for (const [nr, p] of [
        ['10294-1', 120],
        ['75192-1', 60],
      ])
        await db
          .run(
            `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                      VALUES ($1, 'N', 'EUR', $2, $2, $2, $2, 10, NOW()) ON CONFLICT DO NOTHING`,
            [nr, p],
          )
          .catch(() => {});
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await settle();
  const size = async w => {
    await b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
  };
  await b.evaluate(`location.hash = '#/finanzen'; true`);
  await until(`document.querySelectorAll('[data-fin-kind="sets"] tbody tr').length === 2`, 'Sets in the finance table');

  await t.test('cost basis: the column yields the sum', async () => {
    const m = await b.evaluate(`(() => {
      const tab = document.querySelector('[data-fin-kind="sets"] table');
      const column = [...tab.querySelectorAll('thead th')].findIndex(th => th.textContent.trim() === 'Kaufpreis');
      const num = s => Number(s.replace(/\\D/g, '')) / 100;
      const cells = [...tab.querySelectorAll('tbody tr')].map(tr => tr.children[column]);
      return { column, lines: cells.map(z => num(z.firstChild.textContent)), per: cells.map(z => z.querySelector('.fin-per')?.textContent || ''),
               sum: num(tab.querySelector('tfoot .fin-footer-value').textContent) }; })()`);
    assert.ok(m.column > 0, 'Column „Einstand“ is missing');
    assert.deepEqual(
      m.lines.slice().sort((a, b) => a - b),
      [50, 200],
    );
    assert.equal(
      m.lines.reduce((a, b) => a + b, 0),
      m.sum,
    );
    assert.ok(
      m.per.some(j => /^je .*100[.,]00/.test(j)),
      `Unit price is missing: ${JSON.stringify(m.per)}`,
    );
  });

  await t.test('headers in one line', async () => {
    const error = [];
    for (const language of ['de', 'en']) {
      if (language === 'en') {
        await b.evaluate(
          `(() => { const s = document.getElementById('lang-select'); s.value = 'en'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
        );
        await until(`document.documentElement.lang === 'en'`, 'Englisch');
        await b.evaluate(`location.hash = '#/sammlung'; true`);
        await sleep(300);
        await b.evaluate(`location.hash = '#/finanzen'; true`);
        await until(
          `document.querySelectorAll('[data-fin-kind="sets"] tbody tr').length === 2 && /Purchase price/.test(document.querySelector('.dt-fin thead').textContent)`,
          'englische Finanztabelle',
        );
      }
      for (const w of [1280, 1440]) {
        await size(w);
        for (const f of await b.evaluate(WRAP)) error.push(`${language} ${w}: ${f}`);
      }
    }
    assert.deepEqual(error, []);
  });
});
