/**
 * The value chart in finances — on the real bundle in jsdom.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  the condition `messpunkte < 2` removed in loadPortfolioChart → red:
 *      “one data point: empty state instead of a line” (an <svg> stood there)
 *   B  _chartPeriod again 'week' → red: “preselection max, change with
 *      period” (the first query asked period=week)
 *   C  'finance.chart.too_few_title' removed from locales/en.js → red:
 *      “en: empty state translated” (German fallback)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

const punkte = werte => werte.map((value, i) => ({ x_label: `0${i + 1}.10`, value, y_frac: 0.5 }));
const PNL = {
  '/v1/finance/pnl': { success: true, currency: 'EUR', sets: [], totals: { grand_total: '500', pnl_pct: '22.7' } },
};

test('one data point: empty state instead of a line', async () => {
  const { w, d } = await openUi({
    ...PNL,
    '/v1/finance/portfolio-history': {
      success: true,
      currency: 'EUR',
      points: punkte([500, 500]),
      y_axis: [],
      period_change_pct: 0,
      messpunkte: 1,
    },
  });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart .diagramm-leer, #portfolio-chart svg'));
    assert.equal(d.querySelector('#portfolio-chart svg'), null, 'Es steht eine Linie da');
    assert.match(d.querySelector('#portfolio-chart .diagramm-leer').textContent, /Noch zu wenig Verlauf/);
    assert.equal(d.getElementById('portfolio-pnl').textContent.trim(), '');
  } finally {
    w.close();
  }
});

test('preselection max, change with period', async () => {
  const { w, d, aufrufe } = await openUi({
    ...PNL,
    '/v1/finance/portfolio-history': {
      success: true,
      currency: 'EUR',
      points: punkte([400, 450, 500]),
      y_axis: [],
      period_change_pct: 25,
      messpunkte: 3,
    },
  });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart svg'));
    const erste = aufrufe.find(a => a.url.includes('/v1/finance/portfolio-history'));
    assert.match(erste.url, /period=max/, 'Vorwahl Max');
    assert.ok(d.querySelector('.period-btn[data-period="max"]').classList.contains('active'));
    const text = d.getElementById('portfolio-pnl').textContent;
    assert.ok(text.includes('seit Beginn der Aufzeichnung'), `„${text}“`);
  } finally {
    w.close();
  }
});

test('en: empty state translated', async () => {
  const { w, d } = await openUi(
    {
      ...PNL,
      '/v1/finance/portfolio-history': {
        success: true,
        currency: 'EUR',
        points: [],
        y_axis: [],
        period_change_pct: null,
        messpunkte: 0,
      },
    },
    { sprache: 'en' },
  );
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart .diagramm-leer'));
    assert.match(d.querySelector('#portfolio-chart .diagramm-leer').textContent, /^Not enough history yet/);
  } finally {
    w.close();
  }
});
