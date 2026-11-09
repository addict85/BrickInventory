import { ladeAnzeige, verstaendlicherGrund, pnlBadge } from './01-bausteine.js';
import { registerActions } from './00-registry.js';
import { tRaw } from '../i18n.js';
import { html } from './00-escapen.js';
import { api } from './01-api.js';
import { ico, G, setzeHtml } from './01-dom.js';
import { fmtDatum } from './01-format.js';
import { scopeMode } from './14-scope.js';
import { CURRENCY, _pnlCache } from './00-zustand.js';
import { diagrammBreite, portfolioChartSVG, zeitpunkt, diagrammLeer } from './01-diagramme.js';

// Wertentwicklung des Bestands: Zeitraum, Kurve und ihre Bezugslinie (Einstand) aus den Kennzahlen.
// Vorgewählt ist der längste Zeitraum: Eine Woche hat bei neuem Bestand oft nur einen Messpunkt und zeigte
// dann eine flache Linie mit „0 %“.
let _chartPeriod  = 'max';
/**
 * @param {string} period
 */
function setChartPeriod(period){
  _chartPeriod = period;
  // Nur die Zeitraum-Knöpfe: Die Filterchips darunter tragen dieselbe Klasse.
  document.querySelectorAll('.zeitraum-wahl .period-btn').forEach(b => {
    const an = /** @type {HTMLElement} */ (b).dataset.period === period;
    b.classList.toggle('active', an);
    b.setAttribute('aria-pressed', String(an));
  });
  loadPortfolioChart();
}

/** Zuletzt gezeichnete Kurve — beim Drehen des Telefons neu in der neuen Breite.
 * @type {{ day: string, total: number, zeit?: number }[] | null} */
let _letzteKurve = null;
/** Steht schon eine Kurve da? Dann bleibt sie beim Ladefehler der Kennzahlen stehen. */
export const kurveDa = () => !!_letzteKurve;
let _kurveBreite = 0;
/** Einstand und Währung der Kennzahlen — die Bezugslinie im Wertdiagramm. */
let _einstand = 0, _waehrung = '', _einstandText = '';
/** Die Kennzahlen setzen die Bezugslinie; `text` nennt sie, wenn nicht alle Positionen bewertet sind.
 * @param {number} einstand @param {string} waehrung @param {string} text */
export function setzeEinstand(einstand, waehrung, text) { _einstand = einstand; _waehrung = waehrung; _einstandText = text; }
/** Neu in der Breite des Behälters. Verborgen (Breite 0) bleibt die Kurve, wie sie ist:
 * Sonst zeichnete eine Drehung auf einem anderen Reiter sie in der Ersatzbreite, und
 * zurück auf Finanzen war die Schrift halb so gross. Sichtbar werden löst das erneut aus. */
function kurveNachzeichnen() {
  const el = G('portfolio-chart');
  if (!_letzteKurve || !el?.querySelector('svg') || !el.clientWidth) return;
  const b = diagrammBreite(el);
  if (Math.abs(b - _kurveBreite) < 24) return;
  _kurveBreite = b;
  setzeHtml(el, portfolioChartSVG(_letzteKurve, _chartPeriod, b, _einstand, _waehrung || CURRENCY, _einstandText || undefined));
}
window.addEventListener('resize', kurveNachzeichnen);
{
  const el = G('portfolio-chart');
  if (el && typeof ResizeObserver === 'function') new ResizeObserver(kurveNachzeichnen).observe(el);
}

/** Hinweis statt Kurve, wenn der Verlauf nicht zu holen war — im selben
 * Muster wie der Fehlerzustand einer Liste, nur kleiner.
 * @param {boolean} offline @param {{ networkError?: boolean, status?: number, error?: unknown } | null | undefined} d */
function diagrammNichtDa(offline, d){
  const { grund, details } = offline ? { grund: tRaw('api.unreachable') } : verstaendlicherGrund(d);
  return html`${html`<div class="empty leer klein fehler-zustand" role="status"><div class="leer-ico">${ico('warnung')}</div>`}${html`<h2>${tRaw('chart.unavailable')}</h2><p>${grund}</p>`}${details ? html`<details class="fehler-details"><summary>${tRaw('liste.details')}</summary><code>${details}</code></details>` : ''}${html`<button type="button" class="btn bs" data-lesend data-click="loadPortfolioChart">${ico('aktualisieren')}<span>${tRaw('liste.erneut')}</span></button></div>`}`;
}

export async function loadPortfolioChart(){
  const el  = G('portfolio-chart');
  if(!el) return;
  setzeHtml(el, ladeAnzeige(tRaw('common.loading'), { klein: true }));

  const d = await api('GET', `/v1/finance/portfolio-history?period=${_chartPeriod}${scopeMode('finance') !== 'all' ? '&accounts=' + scopeMode('finance') : ''}`);
  if(!d.success){
    if (d.status === 401) return;
    // Ohne Verlauf wählt ein Zeitraum nichts; „Erneut versuchen“ ist die einzige Handlung.
    document.querySelectorAll('.zeitraum-wahl .period-btn').forEach(b => { /** @type {HTMLButtonElement} */ (b).disabled = true; });
    setzeHtml(el, diagrammNichtDa(!!d.networkError, d));
    return;
  }
  // Weniger als zwei echte Messpunkte sind kein Verlauf: Der Server ergänzt dann einen künstlichen Startwert,
  // und die Linie behauptete Stillstand. messpunkte und chart nennt der Vertrag nicht
  // (PortfolioHistoryResponse); der Server schickt sie mit.
  const ungenannt = /** @type {{ messpunkte?: number, chart?: { values?: { values?: { x: string }[] }[] } }} */ (/** @type {unknown} */ (d));
  const messpunkte = ungenannt.messpunkte ?? d.points?.length ?? 0;
  _letzteKurve = null;
  // Ohne jeden Verlauf („Max“ leer) gibt es keinen Zeitraum zu wählen.
  const ganzLeer = (!d.points?.length || messpunkte < 2) && _chartPeriod === 'max';
  /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.zeitraum-wahl .period-btn')).forEach(b => { b.disabled = ganzLeer; });
  if(!d.points?.length || messpunkte < 2){
    setzeHtml(el, diagrammLeer());
    const pnlLeer = G('portfolio-pnl');
    if(pnlLeer) pnlLeer.replaceChildren();
    return;
  }

  const cur = d.currency || CURRENCY;
  // New API: points has {x_label, value, y_frac}, y_axis has {label, value, frac} Convert to legacy format
  // for portfolioChartSVG: [{day, total}]
  const grandTotal = window._finGrandTotal || d.points[d.points.length-1].value;
  const lastVal = d.points[d.points.length-1].value || 1;
  const scale = lastVal > 0 ? grandTotal / lastVal : 1;
  // Die Zeitpunkte stehen in d.chart (dieselbe Reihenfolge wie points); mit ihnen liegen die Punkte auf einer
  // echten Zeitachse statt nach Index.
  const zeiten = ungenannt.chart?.values?.[0]?.values?.map(v => zeitpunkt(v.x)) || [];
  const mitZeit = zeiten.length === d.points.length && zeiten.every(Number.isFinite);
  const finalChartData = d.points.map((p, i) => ({
    day:   p.x_label || '',
    zeit:  mitZeit ? zeiten[i] : undefined,
    total: i === d.points.length-1 ? grandTotal : parseFloat((p.value * scale).toFixed(2))
  }));
  _letzteKurve = finalChartData;
  _kurveBreite = diagrammBreite(el);
  setzeHtml(el, portfolioChartSVG(finalChartData, _chartPeriod, _kurveBreite, _einstand, cur, _einstandText || undefined));

  // P&L: use server-computed period_change_pct (compares period start vs current)
  const pnlEl = G('portfolio-pnl');
  if(pnlEl){
    // Ohne Marktwert keine Entwicklung: Der Verlauf trägt dann nur den Kaufpreis, und „0.0 %" neben „—"
    // behauptete Stillstand.
    const zeitraumText = { week: 'finance.change.week', month: 'finance.change.month',
                           year: 'finance.change.year', max: 'finance.change.max' }[_chartPeriod];
    // „seit 4. Sept.“ statt „seit Beginn“: Der Bezug der Prozentzahl steht dabei.
    const start = finalChartData[0]?.zeit;
    const seit = _chartPeriod === 'max' && start !== undefined && Number.isFinite(start) ? tRaw('finance.change.seit', { datum: fmtDatum(new Date(start)) }) : '';
    const zeitraum = zeitraumText ? html`<span class="pnl-zeitraum">${seit ? seit : tRaw(zeitraumText)}</span>` : '';
    if(!(Number(window._finGrandTotal) > 0)) pnlEl.replaceChildren();
    else if(d.period_change_pct != null){
      setzeHtml(pnlEl, html`${pnlBadge(d.period_change_pct)}${zeitraum}`);
    } else {
      // Fallback: first chart point vs current
      const purchaseBaseline = parseFloat(d.purchase_total || '0');
      const firstVal = (purchaseBaseline > 0 && finalChartData.length <= 2)
        ? purchaseBaseline : finalChartData[0].total;
      if(firstVal > 0 && grandTotal > 0){
        const pct = (grandTotal - firstVal) / firstVal * 100;
        setzeHtml(pnlEl, html`${pnlBadge(pct)}${zeitraum}`);
      }
    }
  }
}

// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  loadPortfolioChart,
  setChartPeriod,
});
