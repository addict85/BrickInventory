/**
 * Das Wertdiagramm in Finanzen — am echten Bündel in jsdom.
 *
 *   - Vorgewählt ist „Max“; die erste Abfrage fragt period=max.
 *   - Mit weniger als zwei echten Messpunkten (der Server ergänzt dann einen
 *     künstlichen Startwert) steht ein Leerzustand statt einer flachen Linie,
 *     und neben dem Titel steht keine Veränderung.
 *   - Mit Verlauf steht die Veränderung mit ihrem Zeitraum da.
 *   - Der Leerzustand ist übersetzt (vorher fest „Noch keine Verlaufsdaten.“).
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in loadPortfolioChart die Bedingung `messpunkte < 2` entfernt → rot:
 *      „ein Messpunkt: Leerzustand statt Linie“ (es stand ein <svg> da)
 *   B  _chartPeriod wieder 'week' → rot: „Vorwahl Max, Veränderung mit
 *      Zeitraum“ (die erste Abfrage fragte period=week)
 *   C  'finance.chart.too_few_title' aus locales/en.js entfernt → rot:
 *      „en: Leerzustand übersetzt“ (deutscher Rückfall)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const punkte = (werte) => werte.map((value, i) => ({ x_label: `0${i + 1}.10`, value, y_frac: 0.5 }));
const PNL = { '/v1/finance/pnl': { success: true, currency: 'EUR', sets: [], totals: { grand_total: '500', pnl_pct: 22.7 } } };

test('ein Messpunkt: Leerzustand statt Linie', async () => {
  const { w, d } = await oeffneOberflaeche({ ...PNL,
    '/v1/finance/portfolio-history': { success: true, currency: 'EUR', points: punkte([500, 500]), y_axis: [], period_change_pct: 0, messpunkte: 1 } });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart .diagramm-leer, #portfolio-chart svg'));
    assert.equal(d.querySelector('#portfolio-chart svg'), null, 'Es steht eine Linie da');
    assert.match(d.querySelector('#portfolio-chart .diagramm-leer').textContent, /Noch zu wenig Verlauf/);
    assert.equal(d.getElementById('portfolio-pnl').textContent.trim(), '');
  } finally { w.close(); }
});

test('Vorwahl Max, Veränderung mit Zeitraum', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche({ ...PNL,
    '/v1/finance/portfolio-history': { success: true, currency: 'EUR', points: punkte([400, 450, 500]), y_axis: [], period_change_pct: 25, messpunkte: 3 } });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart svg'));
    const erste = aufrufe.find(a => a.url.includes('/v1/finance/portfolio-history'));
    assert.match(erste.url, /period=max/, 'Vorwahl Max');
    assert.ok(d.querySelector('.period-btn[data-period="max"]').classList.contains('active'));
    const text = d.getElementById('portfolio-pnl').textContent;
    assert.ok(text.includes('seit Beginn der Aufzeichnung'), `„${text}“`);
  } finally { w.close(); }
});

test('en: Leerzustand übersetzt', async () => {
  const { w, d } = await oeffneOberflaeche({ ...PNL,
    '/v1/finance/portfolio-history': { success: true, currency: 'EUR', points: [], y_axis: [], period_change_pct: null, messpunkte: 0 } }, { sprache: 'en' });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart .diagramm-leer'));
    assert.match(d.querySelector('#portfolio-chart .diagramm-leer').textContent, /^Not enough history yet/);
  } finally { w.close(); }
});
