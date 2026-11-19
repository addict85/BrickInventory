import { ladeAnzeige, verstaendlicherGrund, pnlBadge } from './bausteine.js';
import { registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { html } from './escaping.js';
import { api } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtDatum } from './format.js';
import { scopeMode } from './kontofilter.js';
import { accountCurrency, financeHeaderValue } from './state.js';
import { diagrammBreite, portfolioChartSVG, zeitpunkt, diagrammLeer } from './diagramme.js';

// Value trend of the holdings: period, curve and its reference line (cost basis) from the metrics.
// The longest period is preselected: a week often has only one data point on a fresh collection and
// then showed a flat line reading "0 %".
let _chartPeriod = 'max';
/**
 * @param {string} period
 */
function setChartPeriod(period) {
  _chartPeriod = period;
  // Only the period buttons: the filter chips below share the same class.
  document.querySelectorAll('.zeitraum-wahl .period-btn').forEach(b => {
    const on = /** @type {HTMLElement} */ (b).dataset.period === period;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  loadPortfolioChart();
}

/** Last drawn curve — redrawn in the new width when the phone is rotated.
 * @type {{ day: string, total: number, zeit?: number }[] | null} */
let _lastCurve = null;
/** Is a curve already showing? Then it stays put if the metrics fail to load. */
export const hasCurve = () => !!_lastCurve;
let _curveWidth = 0;
/** Cost basis and currency from the metrics — the reference line in the value chart. */
let _costBasis = 0,
  _currency = '',
  _costBasisText = '';
/** The metrics set the reference line; `text` names it when not all positions are valued.
 * @param {number} costBasis @param {string} currency @param {string} text */
export function setCostBasis(costBasis, currency, text) {
  _costBasis = costBasis;
  _currency = currency;
  _costBasisText = text;
}
/** Redraw at the container's current width. Hidden (width 0), the curve stays as it is: otherwise a
 * rotation on another tab would draw it at the fallback width, and back on Finances the font would be
 * half the size. Becoming visible triggers this again. */
function redrawCurve() {
  const el = G('portfolio-chart');
  if (!_lastCurve || !el?.querySelector('svg') || !el.clientWidth) return;
  const b = diagrammBreite(el);
  if (Math.abs(b - _curveWidth) < 24) return;
  _curveWidth = b;
  setzeHtml(
    el,
    portfolioChartSVG(
      _lastCurve,
      _chartPeriod,
      b,
      _costBasis,
      _currency || accountCurrency,
      _costBasisText || undefined,
    ),
  );
}
window.addEventListener('resize', redrawCurve);
{
  const el = G('portfolio-chart');
  // Only on the next frame: redrawing changes the height of the observed element, and in the same pass
  // Chrome reported a "ResizeObserver loop …" for it.
  if (el && typeof ResizeObserver === 'function')
    new ResizeObserver(() => requestAnimationFrame(redrawCurve)).observe(el);
}

/** Notice instead of a curve, when history could not be fetched — same pattern as a list's error state,
 * just smaller.
 * @param {boolean} offline @param {{ networkError?: boolean, status?: number, error?: unknown } | null | undefined} d */
function chartUnavailable(offline, d) {
  const { grund, details } = offline ? { grund: tRaw('api.unreachable') } : verstaendlicherGrund(d);
  return html`${html`<div class="empty leer klein fehler-zustand" role="status"><div class="leer-ico">${ico('warnung')}</div>`}${html`<h2>${tRaw('chart.unavailable')}</h2><p>${grund}</p>`}${details ? html`<details class="fehler-details"><summary>${tRaw('liste.details')}</summary><code>${details}</code></details>` : ''}${html`<button type="button" class="btn bs" data-lesend data-click="loadPortfolioChart">${ico('aktualisieren')}<span>${tRaw('liste.erneut')}</span></button></div>`}`;
}

export async function loadPortfolioChart() {
  const el = G('portfolio-chart');
  if (!el) return;
  setzeHtml(el, ladeAnzeige(tRaw('common.loading'), { klein: true }));

  const d = await api(
    'GET',
    `/v1/finance/portfolio-history?period=${_chartPeriod}${scopeMode('finance') !== 'all' ? '&accounts=' + scopeMode('finance') : ''}`,
  );
  if (!d.success) {
    if (d.status === 401) return;
    // Without history no period selects anything; "retry" is the only available action.
    document.querySelectorAll('.zeitraum-wahl .period-btn').forEach(b => {
      /** @type {HTMLButtonElement} */ (b).disabled = true;
    });
    setzeHtml(el, chartUnavailable(!!d.networkError, d));
    return;
  }
  // Fewer than two real data points is not a history: the server then adds an artificial starting value,
  // and the line would claim no movement. The contract (PortfolioHistoryResponse) doesn't name messpunkte
  // and chart; the server sends them anyway.
  const untyped = /** @type {{ messpunkte?: number, chart?: { values?: { values?: { x: string }[] }[] } }} */ (
    /** @type {unknown} */ (d)
  );
  const dataPoints = untyped.messpunkte ?? d.points?.length ?? 0;
  _lastCurve = null;
  // With no history at all ("Max" empty) there is no period to choose from.
  const fullyEmpty = (!d.points?.length || dataPoints < 2) && _chartPeriod === 'max';
  /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.zeitraum-wahl .period-btn')).forEach(b => {
    b.disabled = fullyEmpty;
  });
  if (!d.points?.length || dataPoints < 2) {
    setzeHtml(el, diagrammLeer());
    const emptyPnl = G('portfolio-pnl');
    if (emptyPnl) emptyPnl.replaceChildren();
    return;
  }

  const cur = d.currency || accountCurrency;
  // New API: points has {x_label, value, y_frac}, y_axis has {label, value, frac} Convert to legacy format
  // for portfolioChartSVG: [{day, total}]
  const grandTotal = financeHeaderValue || d.points[d.points.length - 1].value;
  const lastVal = d.points[d.points.length - 1].value || 1;
  const scale = lastVal > 0 ? grandTotal / lastVal : 1;
  // The timestamps live in d.chart (same order as points); with them the points sit on a real time axis
  // instead of by index.
  const times = untyped.chart?.values?.[0]?.values?.map(v => zeitpunkt(v.x)) || [];
  const withTime = times.length === d.points.length && times.every(Number.isFinite);
  const finalChartData = d.points.map((p, i) => ({
    day: p.x_label || '',
    zeit: withTime ? times[i] : undefined,
    total: i === d.points.length - 1 ? grandTotal : parseFloat((p.value * scale).toFixed(2)),
  }));
  _lastCurve = finalChartData;
  _curveWidth = diagrammBreite(el);
  setzeHtml(
    el,
    portfolioChartSVG(finalChartData, _chartPeriod, _curveWidth, _costBasis, cur, _costBasisText || undefined),
  );

  // P&L: use server-computed period_change_pct (compares period start vs current)
  const pnlEl = G('portfolio-pnl');
  if (pnlEl) {
    // Without a market value there is no trend: the history then only carries the purchase price, and
    // "0.0 %" next to "—" would claim no movement.
    const zeitraumText = {
      week: 'finance.change.week',
      month: 'finance.change.month',
      year: 'finance.change.year',
      max: 'finance.change.max',
    }[_chartPeriod];
    // "since Sept 4" instead of "since the start": the percentage's reference point stays visible.
    const start = finalChartData[0]?.zeit;
    const since =
      _chartPeriod === 'max' && start !== undefined && Number.isFinite(start)
        ? tRaw('finance.change.seit', { datum: fmtDatum(new Date(start)) })
        : '';
    const zeitraum = zeitraumText ? html`<span class="pnl-zeitraum">${since ? since : tRaw(zeitraumText)}</span>` : '';
    if (!(financeHeaderValue > 0)) pnlEl.replaceChildren();
    else if (d.period_change_pct != null) {
      setzeHtml(pnlEl, html`${pnlBadge(d.period_change_pct)}${zeitraum}`);
    } else {
      // Fallback: first chart point vs current
      const purchaseBaseline = parseFloat(d.purchase_total || '0');
      const firstVal = purchaseBaseline > 0 && finalChartData.length <= 2 ? purchaseBaseline : finalChartData[0].total;
      if (firstVal > 0 && grandTotal > 0) {
        const pct = ((grandTotal - firstVal) / firstVal) * 100;
        setzeHtml(pnlEl, html`${pnlBadge(pct)}${zeitraum}`);
      }
    }
  }
}

// ── Register handlers with the dispatcher (see js/registry.js) ──────────────
registerActions({
  loadPortfolioChart,
  setChartPeriod,
});
