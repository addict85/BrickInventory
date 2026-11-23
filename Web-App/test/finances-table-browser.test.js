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
const { startApp, warte } = require('./helpers/app-browser');
const { holdsSet } = require('./helpers/inventory');

/** Visible text (without .vh) that wraps or sticks out over the cell. */
const WRAP = `[...document.querySelectorAll('.dt-fin thead th, .dt-sum thead th')].filter(e => e.getClientRects().length).map(th => {
  const tops = new Set(); let rechts = 0; const w = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim() || n.parentElement.closest('.vh')) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    for (const q of r.getClientRects()) { tops.add(Math.round(q.top)); rechts = Math.max(rechts, q.right); } }
  const zelle = th.getBoundingClientRect();
  return (tops.size > 1 || rechts > zelle.right + 0.5) ? th.textContent.trim() + ': ' + tops.size + ' Zeilen' : null; }).filter(Boolean)`;

test('finance table can be recalculated and without wrapping in the header', {
  concurrency: 1,
  timeout: 300_000,
}, async t => {
  const app = await startApp(t, {
    name: `fintab_${process.pid}`,
    holding: async (db, uid) => {
      await holdsSet(db, uid, '10294-1', 2, { preis: 100 });
      await holdsSet(db, uid, '75192-1', 1, { preis: 50 });
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
  const { b, bis, ruhig } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await ruhig();
  const groesse = async w => {
    await b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await warte(300);
  };
  await b.auswerten(`location.hash = '#/finanzen'; true`);
  await bis(`document.querySelectorAll('[data-fin-kind="sets"] tbody tr').length === 2`, 'Sets in the finance table');

  await t.test('cost basis: the column yields the sum', async () => {
    const m = await b.auswerten(`(() => {
      const tab = document.querySelector('[data-fin-kind="sets"] table');
      const spalte = [...tab.querySelectorAll('thead th')].findIndex(th => th.textContent.trim() === 'Kaufpreis');
      const zahl = s => Number(s.replace(/\\D/g, '')) / 100;
      const cells = [...tab.querySelectorAll('tbody tr')].map(tr => tr.children[spalte]);
      return { spalte, zeilen: cells.map(z => zahl(z.firstChild.textContent)), je: cells.map(z => z.querySelector('.fin-per')?.textContent || ''),
               summe: zahl(tab.querySelector('tfoot .fin-footer-value').textContent) }; })()`);
    assert.ok(m.spalte > 0, 'Column „Einstand“ is missing');
    assert.deepEqual(
      m.zeilen.slice().sort((a, b) => a - b),
      [50, 200],
    );
    assert.equal(
      m.zeilen.reduce((a, b) => a + b, 0),
      m.summe,
    );
    assert.ok(
      m.je.some(j => /^je .*100[.,]00/.test(j)),
      `Unit price is missing: ${JSON.stringify(m.je)}`,
    );
  });

  await t.test('headers in one line', async () => {
    const error = [];
    for (const language of ['de', 'en']) {
      if (language === 'en') {
        await b.auswerten(
          `(() => { const s = document.getElementById('lang-select'); s.value = 'en'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
        );
        await bis(`document.documentElement.lang === 'en'`, 'Englisch');
        await b.auswerten(`location.hash = '#/sammlung'; true`);
        await warte(300);
        await b.auswerten(`location.hash = '#/finanzen'; true`);
        await bis(
          `document.querySelectorAll('[data-fin-kind="sets"] tbody tr').length === 2 && /Purchase price/.test(document.querySelector('.dt-fin thead').textContent)`,
          'englische Finanztabelle',
        );
      }
      for (const w of [1280, 1440]) {
        await groesse(w);
        for (const f of await b.auswerten(WRAP)) error.push(`${language} ${w}: ${f}`);
      }
    }
    assert.deepEqual(error, []);
  });
});
