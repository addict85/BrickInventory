// Finances: valuation, profit & loss, and the value development of the collection.
import { subscribe } from './events.js';
import {
  loadDisplay,
  listLoadError,
  condBadges,
  ownerBadges,
  accountDisplay,
  pnlBadge,
  estimatedPurchase,
  rowsButton,
} from './components.js';
import { registerActions } from './registry.js';
import { colorName, t, tRaw } from '../i18n.js';
import { escJs, esc, html, rawHtml } from './escaping.js';
import { api } from './api.js';
import { imageTag, placeholderContent, imgUrl, thumbUrl } from './images.js';
import { emptyState, reportHits, ico, G, queryAll, setHtml } from './dom.js';
import { fmtDate, fmtMoney, fmtN } from './format.js';
import { scopeQuery } from './account-filter.js';
import { pnlBySet, setFinanceHeaderValue } from './state.js';
import { hasCurve, loadPortfolioChart, setCostBasis } from './value-curve.js';
import { baseFrom, showMetrics } from './finance-metrics.js';
/** @typedef {import('./finance-metrics.js').Basis} Basis */

/**
 * "Market price present or not" badge with only two states: whether the price came from the
 * cache or fresh changes nothing about the number. title AND aria-label, otherwise it is an
 * unexplained symbol for screen readers too.
 */
/** @param {{ error?: string | null, no_price?: boolean | null, bl_unknown?: boolean | null }} s */
function priceStatusBadge(s, neutral = false) {
  // If the price is missing almost everywhere (no credentials, service hasn't run yet), it is not
  // this row's error: grey instead of red, with the reason in the tooltip.
  if (s.error) {
    const title = `${t('finance.price_failed')}: ${s.error}`;
    return html`<span class="pst ${neutral ? 'pst-empty' : 'pst-err'}" title="${title}" role="img" aria-label="${title}">${neutral ? '–' : ico('warning')}</span>`;
  }
  // No checkmark without a market price: it said "present" over an empty column.
  if (s.no_price) {
    const title = t(s.bl_unknown ? 'finance.price_unknown_bl' : 'finance.price_none');
    return html`<span class="pst pst-empty" title="${title}" role="img" aria-label="${title}">–</span>`;
  }
  const title = t('finance.price_loaded');
  return html`<span class="pst pst-ok" title="${title}" role="img" aria-label="${title}">${ico('ok')}</span>`;
}

/** Placeholder for a metric while it loads — "—" would mean "no value". */
const VALUE_SKELETON = '<span class="skeleton-row skeleton-value" aria-hidden="true"></span>';
/** All metrics load the same way: skeleton instead of "—", including profit/loss. */
const METRICS = ['fin-cost-basis', 'fin-value', 'fin-total-pnl', 'portfolio-current'];

/** What a table row needs besides its own data.
 * @typedef {{ cur: string, severalAccounts: boolean, errorNeutral: boolean }} RowContext */
/** @typedef {import('../../frontend-types/contract').ValuationSet & { error?: string | null, owners?: { id: number, username: string }[] }} ValuedSet */
/** @typedef {ValuedSet['acquisitions'][number]} SetAcquisition */
/** @typedef {import('../../frontend-types/contract').PartsValuationResponse['parts'][number] | import('../../frontend-types/contract').FigsValuationResponse['figs'][number]} ManualItem */
/** @typedef {ManualItem['acquisitions'][number]} ManualAcquisition */

/** When rows from several accounts show, each names its account — even the viewer's own; otherwise
 * the same set twice looks like a bug. @param {{ owners?: { id: number, username: string }[] }} it @param {boolean} multiAccount */
function owners(it, multiAccount) {
  return multiAccount && it.owners?.length
    ? it.owners.map(
        o =>
          html`<span class="cond-badge owner-badge"><span class="vh">${tRaw('finance.account')}: </span>${accountDisplay(o)}</span>`,
      )
    : ownerBadges(it);
}

const condBadge = (/** @type {string} */ c) => condBadges({ conditions: [c] });
/** Row's market value, with the unit price underneath when there's more than one, as with the purchase
 * price: a dedicated column for it was almost always empty for sets. @param {number} total @param {number} unit @param {unknown} qty @param {string} cur */
const valueWithUnit = (total, unit, qty, cur) =>
  (parseInt(String(qty), 10) || 1) > 1 && unit > 0
    ? html`${fmtN(total, cur)}<span class="fin-per">${tRaw('finance.per', { price: fmtN(unit, cur) })}</span>`
    : fmtN(total, cur);
/** A missing market value looks the same in row, sum and card: a dash, "price missing" for screen readers. */
const noValue = () =>
  html`<span class="text-mut" title="${tRaw('finance.price_missing_short')}"><span aria-hidden="true">—</span><span class="vh">${tRaw('finance.price_missing_short')}</span></span>`;
// Fixed column widths (colgroup, table-layout:fixed): the parts and minifigs tables' price columns then
// line up exactly under the sets table's, and the numbers can be compared top to bottom.
const PM_COLGROUP = html`<colgroup>
    <col class="sp-60"><col class="sp-325 fin-k-name"><col class="sp-70 fin-k-extra"><col class="sp-100 fin-k-extra"><col class="sp-110"><col class="sp-110"><col class="sp-90"><col class="sp-55">
  </colgroup>`;
/**
 * Parts and minifigs rows open their detail like the card in the gallery tab: a table where only the
 * set rows react to a click would look broken.
 * @param {{ fig_number?: string, part_number?: string, color_id?: number }} it */
const manTarget = (/** @type {{ fig_number?: string, part_number?: string, color_id?: number }} */ it) =>
  it.fig_number
    ? { click: 'openManDetail', arg: 'fig', arg2: it.fig_number, arg3: 0 }
    : { click: 'openManDetail', arg: 'part', arg2: it.part_number ?? '', arg3: it.color_id || 0 };
/** @param {{ fig_number?: string, part_number?: string, color_id?: number }} it */
const manArgs = it =>
  it.fig_number
    ? `data-click="openManDetail" data-arg="fig" data-arg2="${escJs(it.fig_number)}" data-arg3="0"`
    : `data-click="openManDetail" data-arg="part" data-arg2="${escJs(it.part_number)}" data-arg3="${it.color_id || 0}"`;
/** A minifig price estimated from part prices gets "≈" and the coverage.
 * @param {{ estimated_from_parts?: boolean | null, abdeckung?: number | null }} it @param {string} markup */
function estimatedMark(it, markup) {
  if (!it.estimated_from_parts) return markup;
  const p = it.abdeckung != null ? Math.round(it.abdeckung * 100) : '?';
  const hint = esc(tRaw('finance.off_parts_estimated', { p }));
  return html`<span title="${hint}"><span role="img" aria-label="${hint}">≈</span> ${rawHtml(markup)}</span>`;
}

/** On a phone the purchase price column is missing; the row underneath then says the purchase price is
 * estimated. @param {{ price_estimated?: boolean } | null | undefined} acq */
function belowEstimated(acq) {
  return acq?.price_estimated ? html` · ${estimatedPurchase(tRaw('finance.purchase_estimated'))}` : '';
}

/** On a phone the purchase price column is missing; the row's purchase price then goes under the name.
 * @param {unknown} unit @param {unknown} qty @param {string} cur */
function belowPurchase(unit, qty, cur) {
  const p = unit == null || String(unit).trim() === '' ? NaN : Number(unit);
  if (!Number.isFinite(p)) return '';
  const amount = fmtMoney(p * (parseInt(String(qty), 10) || 1), cur);
  return html`<span class="fin-sub-purchase"> · ${tRaw('finance.col.purchase')} ${amount}</span>`;
}

/** Without a market price: a dash under the column header on desktop, worded out on a phone and without an
 * empty P&L cell. */
const noMarket = () =>
  html`<span class="fin-strich">${noValue()}</span><span class="fin-no-market">${tRaw('finance.no_market_price')}</span>`;
const noPnl = () => html`<span class="text-mut fin-guv-empty">—</span>`;

/** @param {ManualItem} it @param {string} label @param {ManualAcquisition | null} acq @param {RowContext} ctx @param {string} text visible name without markup */
function pmRow(it, label, acq, ctx, text) {
  const cur = ctx.cur;
  const qty = acq ? acq.quantity : it.quantity || 1;
  // avg_price first — as everywhere since the price-model switch.
  const current = acq ? Number(acq.avg_price ?? 0) : Number(it.avg_price ?? it.qty_avg_price ?? 0);
  const purchase = acq
    ? acq.purchase_price != null
      ? Number(acq.purchase_price)
      : null
    : it.purchase_price != null
      ? Number(it.purchase_price)
      : null;
  const total = acq ? (acq.value_total ?? 0) : (it.value_total ?? 0);
  const pnl = acq ? acq.pnl_percent : it.pnl_percent;
  const kind = it.fig_number ? 'figur' : 'teil';
  const img =
    it.image_local || it.image_url
      ? imageTag({
          src: imgUrl(thumbUrl(it.image_local || it.image_url) || it.image_local || it.image_url, true),
          orig: imgUrl(it.image_url || ''),
          alt: '',
          ph: kind,
        })
      : html`<span class="image-ph" aria-hidden="true">${placeholderContent(kind)}</span>`;
  // The former third parameter onclickAttr was never set by any caller — that branch was dead and would
  // have been blocked by the CSP as an inline handler.
  return html`<tr class="cursor-pointer" ${rawHtml(manArgs(it))}>
    <td class="fin-image">${img}</td>
      <td class="fin-name"><span class="fin-name-text">${rowsButton(manTarget(it), rawHtml(label), tRaw('row.open', { name: text, nr: it.fig_number || it.part_number || '' }))}${acq ? html` ${condBadge(acq.condition)}` : ''} ${owners(it, ctx.severalAccounts)}</span><span class="fin-sub">×${qty}${belowPurchase(purchase, qty, cur)}${belowEstimated(acq)}</span></td>
    <td class="fin-detail number"><span class="qbadge">×${qty}</span></td>
    <td class="fin-detail fin-date">${acq?.created_at ? fmtDate(acq.created_at) : ''}</td>
    <td class="fin-detail price-cell number">${rawHtml(purchaseCell(purchase, qty, cur, acq))}</td>
    <td class="fin-value price-total number">${total > 0 ? rawHtml(estimatedMark(/** @type {{ estimated_from_parts?: boolean | null, abdeckung?: number | null }} */ (it), String(valueWithUnit(total, current, qty, cur)))) : noMarket()}</td>
    <td class="fin-guv number">${pnlBadge(pnl, purchase) || noPnl()}</td>
    <td class="fin-status">${priceStatusBadge({ no_price: !(current > 0) })}</td>
  </tr>`;
}

/** One row per purchase-price entry (at least one), each with the market price for its condition.
 * @param {ManualItem} it @param {string} label @param {RowContext} ctx */
function pmRows(it, label, ctx) {
  // The row button's name holds what's visibly shown (WCAG 2.5.3), without the label's markup.
  const colorSuffix = 'color_name' in it && it.color_name ? ` (${colorName(String(it.color_name))})` : '';
  const text =
    'fig_number' in it && it.fig_number
      ? String(it.fig_name || it.fig_number)
      : `${'part_name' in it ? it.part_name || it.part_number : ''}${colorSuffix}`;
  const acqs = it.acquisitions || [];
  if (!acqs.length) return pmRow(it, label, null, ctx, text);
  return acqs.map(a => pmRow(it, label, a, ctx, text)).join('');
}

function pmTableHead() {
  return html`<thead><tr><th><span class="vh">${tRaw('col.image')}</span></th><th>${tRaw('col.name')}</th><th class="number">${tRaw('detail.qty')}</th><th>${tRaw('detail.added')}</th>${priceHeads()}<th title="${t('finance.price_status')}"><span aria-hidden="true">${tRaw('finance.price_status_short')}</span><span class="vh">${t('finance.price_status')}</span></th></tr></thead>`;
}

/** Section of manually recorded parts or minifigs; empty without entries.
 * @param {{ kind: string, title: string, symbol: string, rows: string, count: number, purchase: number, value: number, cur: string }} o */
function manualSection(o) {
  if (!o.count) return '';
  const foot = html`<tfoot><tr><td colspan="4" class="fin-footer-l">${tRaw('finance.sum')}</td>${totalCells(o.purchase, o.value, o.cur)}<td colspan="2"></td></tr></tfoot>`;
  return html`
    <div class="tw space-top-125" data-fin-kind="${o.kind}" tabindex="0" role="region" aria-label="${o.title}">
      <h2 class="ctitle fin-section">${ico(o.symbol)} ${rawHtml(o.title)}</h2>
      <table class="dt dt-fin" aria-label="${o.title}">${PM_COLGROUP}${pmTableHead()}<tbody>${rawHtml(o.rows)}</tbody>${foot}</table>
    </div>`;
}

// One full row per purchase-price entry, each with the market price for its own condition: otherwise a
// used entry would also value a newly-bought copy as used. No totals row and no indentation — the rows
// are peer purchases, not a breakdown.
/** @param {ValuedSet} s @param {SetAcquisition | null} acq @param {RowContext} ctx */
function setRow(s, acq, ctx) {
  const { cur, errorNeutral } = ctx;
  const hasPrice = !s.error;
  const qty = acq ? acq.quantity : s.quantity;
  const purchase = acq ? acq.purchase_price : s.purchase_price;
  const market = acq ? acq.avg_price : s.avg_price;
  const total = acq ? acq.value_total : s.value_total;
  // Per-row P&L from the server (against THIS entry's purchase price). Without entries, the existing
  // value from the P&L response stays.
  const pnl = acq ? acq.pnl_percent : (s.pnl_percent ?? pnlBySet[s.set_number]?.pnl_pct);
  const dateSrc = acq ? acq.created_at : s.added_at;
  // The error message lives in the status symbol (tooltip), not in the total: there it broke the
  // column into five lines.
  return html`<tr class="cursor-pointer" data-click="openModal" data-arg="${s.set_number}">
  <td class="fin-image">${s.image_local || s.image_url ? imageTag({ src: imgUrl(thumbUrl(s.image_local || s.image_url) || s.image_local || s.image_url, true), alt: '', ph: 'set' }) : html`<span class="image-ph" aria-hidden="true">${placeholderContent('set')}</span>`}</td>
  <td class="fin-detail"><span class="number-small">${s.set_number}</span></td>
    <td class="fin-name">${rowsButton({ click: 'openModal', arg: s.set_number }, s.name || '—', tRaw('row.open', { name: s.name || s.set_number, nr: s.set_number }))}${s.year ? html` <span class="fin-year">${s.year}</span>` : ''}${acq ? html` ${condBadge(acq.condition)}` : ''} ${owners(s, ctx.severalAccounts)}<span class="fin-sub">${s.set_number}${s.year ? html` · ${s.year}` : ''} · ×${qty}${belowPurchase(purchase, qty, cur)}${belowEstimated(acq)}</span></td>
  <td class="fin-detail number"><span class="qbadge">×${qty}</span></td>
  <td class="fin-detail fin-date">${dateSrc ? fmtDate(dateSrc) : '—'}</td>
  <td class="fin-detail price-cell number">${rawHtml(purchaseCell(purchase, qty, cur, acq))}</td>
  <td class="fin-value number price-total">${hasPrice && Number(total) > 0 ? valueWithUnit(Number(total), Number(market), qty, cur) : noMarket()}</td>
  <td class="fin-guv number">${pnlBadge(pnl, purchase) || noPnl()}</td>
    <td class="fin-status">${priceStatusBadge(s, errorNeutral)}</td>
</tr>`;
}

/** @param {string} rows @param {{ sets: number }} purchase @param {number} setsQtyAvg @param {string} cur */
function setsTable(rows, purchase, setsQtyAvg, cur) {
  return html`<div class="tw" data-fin-kind="sets" tabindex="0" role="region" aria-label="${t('finance.filter.sets')}"><h2 class="ctitle fin-section">${ico('set')} ${tRaw('finance.filter.sets')}</h2><table class="dt dt-fin" aria-label="${tRaw('finance.filter.sets')}"><colgroup><col class="sp-60"><col class="sp-90 fin-k-extra"><col class="sp-235 fin-k-name"><col class="sp-70 fin-k-extra"><col class="sp-100 fin-k-extra"><col class="sp-110"><col class="sp-110"><col class="sp-90"><col class="sp-55"></colgroup><thead><tr><th><span class="vh">${tRaw('col.image')}</span></th><th>${tRaw('col.nr')}</th><th${sortState('name', true)}>${sortButton('name', true, tRaw('col.name'))}</th><th class="number">${tRaw('detail.qty')}</th><th>${tRaw('detail.added')}</th>${priceHeads(true)}<th title="${t('finance.price_status')}"><span aria-hidden="true">${tRaw('finance.price_status_short')}</span><span class="vh">${t('finance.price_status')}</span></th></tr></thead><tbody>${rawHtml(rows)}</tbody><tfoot><tr><td colspan="5" class="fin-footer-l">${tRaw('finance.sum')}</td>${totalCells(purchase.sets, setsQtyAvg, cur)}<td colspan="2"></td></tr></tfoot></table></div>${legend()}`;
}

/** Grand total under all sections. Each section's sum already sits under its own table; repeating it
 * per section would have stretched the page on a phone by three boxes showing the same numbers.
 * @param {{ sets: number, parts: number, figs: number, all: number }} purchase
 * @param {{ sets: number, parts: number, figs: number, all: number }} value @param {string} cur
 * @param {{ withoutMarket: number }} basis */
function totalsTable(purchase, value, cur, basis) {
  const row = (/** @type {string} */ name, /** @type {number} */ buy, /** @type {number} */ w, note = '') =>
    html`<tr><td class="fin-footer-name">${rawHtml(name)}</td>${totalCells(buy, w, cur, note)}</tr>`;
  return html`
    <div class="tw space-top-125">
      <table class="dt dt-sum" aria-label="${tRaw('finance.sum')}">
        <thead><tr><th><span class="vh">${tRaw('finance.area')}</span></th><th>${tRaw('finance.col.purchase')}</th><th>${tRaw('finance.grand.value')}</th></tr></thead>
        <tfoot>${row(tRaw('finance.grand.total'), purchase.all, value.all, basis.withoutMarket > 0 ? tRaw('finance.without_n', { n: basis.withoutMarket }) : '')}</tfoot>
      </table>
      ${basis.withoutMarket > 0 ? html`<p class="fin-footnote">${tRaw('finance.sum_without_market', { n: basis.withoutMarket })}</p>` : ''}
    </div>`;
}

/** Placeholder while loading; an existing table stays put. @returns {boolean} whether a table was already there */
function financeLoading() {
  const hadTable = !!G('fin-tbl').querySelector('table');
  if (!hadTable) setHtml(G('fin-tbl'), loadDisplay(tRaw('finance.fetch_prices')));
  G('fin-sum').hidden = false;
  if (!G('fin-sum').dataset.loaded) {
    G('fin-sum').setAttribute('aria-busy', 'true');
    for (const id of METRICS) setHtml(G(id), rawHtml(VALUE_SKELETON));
  }
  // A previous error does not linger while reloading.
  const chart = G('portfolio-chart');
  if (chart?.querySelector('.error-state')) setHtml(chart, loadDisplay(tRaw('common.loading'), { small: true }));
  return hadTable;
}

/** Load failure: reason and "retry" once, at the top of the chart box; cards with no number are dropped
 * (five "—"s above the message looked like an empty collection). @param {Parameters<typeof listLoadError>[1]} d
 * @param {boolean} hadTable @returns {boolean} true if it was an error */
function financeFailed(d, hadTable) {
  const inBox = !hadTable && !hasCurve();
  const target = G(inBox ? 'portfolio-chart' : 'fin-tbl');
  const title = tRaw('finance.error_title');
  if (!listLoadError(target, d, { again: 'loadFinance', keep: hadTable, title: title })) return false;
  if (inBox) {
    setHtml(G('fin-tbl'), '');
    // loadPortfolioChart() frees them again as soon as a history is there.
    for (const b of document.querySelectorAll('.period-choice .period-btn')) b.setAttribute('disabled', '');
    filterEnabled(false);
  }
  if (!G('fin-sum').dataset.loaded) {
    G('fin-sum').removeAttribute('aria-busy');
    G('fin-sum').hidden = true;
    G('portfolio-current').textContent = '—';
  }
  return true;
}

/** Without a list, chips and search filter nothing; usable, they would look as if there was something
 * to filter. Disabled alone they would still look like controls, so the class also hides the period
 * picker. @param {boolean} enabled */
function filterEnabled(enabled) {
  for (const el of queryAll('#fin-filter button, #fin-search')) {
    /** @type {HTMLButtonElement} */ (el).disabled = !enabled;
  }
  G('tab-finance')?.classList.toggle('finances-error', !enabled);
}

export async function loadFinance() {
  const hadTable = financeLoading();
  // All four with the same account filter — otherwise a total from one scope would sit next to a
  // listing from another.
  const [d, partsVal, figsVal, pnlData] = await Promise.all([
    api('GET', `/v2/finance/valuation${scopeQuery('finance')}`),
    api('GET', `/v2/finance/parts-valuation${scopeQuery('finance')}`),
    api('GET', `/v2/finance/minifigs-valuation${scopeQuery('finance')}`),
    api('GET', `/v2/finance/pnl${scopeQuery('finance')}`),
  ]);
  if (financeFailed(d, hadTable) || !d?.success) return;
  filterEnabled(true);
  const cur = d.currency;
  const extra =
    parseFloat(partsVal.success ? partsVal.total_value || '0' : '0') +
    parseFloat(figsVal.success ? figsVal.total_value || '0' : '0');
  // No P&L without a comparable entry — not even the previous filter's: a leftover number would look
  // like the answer to the new one.
  const totalPnl = pnlData.success ? pnlData.totals?.pnl_percent : null;
  const allRows = [
    ...(d.sets || []),
    ...(partsVal.success ? partsVal.parts : []),
    ...(figsVal.success ? figsVal.figs : []),
  ];
  const multiAccount = new Set(allRows.flatMap(z => (z.owners || []).map(o => o.id))).size > 1;
  const partsItems = partsVal.success ? partsVal.parts : [];
  const figsItems = figsVal.success ? figsVal.figs : [];
  // Purchase total per section: from the server (pnl), otherwise computed from the rows.
  /** @type {Partial<import('../../frontend-types/contract').PnlTotals>} */
  const pt = pnlData.success ? pnlData.totals || {} : {};
  const purchase = {
    sets: numberOr(pt.sets_purchase, purchaseFrom(d.sets)),
    parts: numberOr(pt.parts_purchase, purchaseFrom(partsItems)),
    figs: numberOr(pt.figs_purchase, purchaseFrom(figsItems)),
    all: 0,
  };
  purchase.all = numberOr(pt.purchase, purchase.sets + purchase.parts + purchase.figs);
  const missingPrice =
    d.sets.filter(s => s.error || !(Number(s.avg_price) > 0)).length +
    [...partsItems, ...figsItems].filter(it => !(Number(it.avg_price ?? it.qty_avg_price) > 0)).length;
  // Totals from the server (`total_value`), as in the app.
  const setsQtyAvg = parseFloat(d.totals.avg || '0');
  // The grand total comes from the server (totals.grand_total, computed per row): the rule for what
  // counts should live in one place. The locally computed sum is only a fallback if the pnl request fails.
  const grandTotal = parseFloat(pnlData?.totals?.grand_total || '0') || setsQtyAvg + extra;
  const basis = baseFrom(pt, missingPrice);
  const value = {
    sets: setsQtyAvg,
    parts: parseFloat(partsVal?.total_value || '0'),
    figs: parseFloat(figsVal?.total_value || '0'),
    all: grandTotal,
  };
  // Chart, header figure and cards show the same market value and purchase total.
  const headValue = basis.valued > 0 ? basis.value : grandTotal;
  setFinanceHeaderValue(headValue);
  if (G('portfolio-current')) G('portfolio-current').textContent = headValue > 0 ? fmtN(headValue, cur) : '—';
  // The line compares against the value curve; if positions lack a market price, it names what it refers to.
  setCostBasis(
    basis.valued > 0 ? basis.costBasis : purchase.all,
    cur,
    basis.valued > 0 && Math.abs(basis.costBasis - purchase.all) >= 0.005 ? tRaw('finance.chart.purchase_price') : '',
  );
  const empty = !d.sets.length && !partsItems.length && !figsItems.length;
  G('tab-finance')?.classList.toggle('finances-empty', empty);
  loadPortfolioChart();
  showMetrics({
    basis,
    costAll: purchase.all,
    valueAll: grandTotal,
    guv: totalPnl,
    cur,
    foreignCurrency: pnlData?.totals?.foreign_currency_purchases || 0,
    estimated: allRows.flatMap(z => z.acquisitions || []).filter(a => a.price_estimated).length,
    rows: allRows.reduce((n, z) => n + Math.max(1, z.acquisitions?.length || 0), 0),
  });
  // Nothing recorded: an empty state instead of tables reporting "price missing" five times over.
  if (empty) {
    setHtml(
      G('fin-tbl'),
      emptyState({
        ico: 'finances',
        title: tRaw('finance.empty'),
        text: tRaw('finance.empty_text'),
        button: { text: tRaw('gallery.add.title'), click: 'openCapture', arg: 'set' },
      }),
    );
    return;
  }
  // If the price is missing for most sets, that's an outage, not an isolated case: neutral instead of red.
  const errorRows = d.sets.filter(s => s.error).length;
  /** @type {RowContext} */
  const ctx = { cur, severalAccounts: multiAccount, errorNeutral: errorRows >= 3 && errorRows * 2 >= d.sets.length };
  _finState = { sets: d.sets, parts: partsItems, figs: figsItems, purchase, value, setsQtyAvg, cur, basis, ctx };
  renderFinanceTables();
}

/**
 * The purchase price column shows the row's purchase total (quantity × unit price), so the sum below it
 * can be checked against the column; the unit price shows as "each …" underneath when quantity > 1.
 * @param {unknown} unit
 * @param {unknown} qty
 * @param {string} cur
 * @param {{ original_purchase_price?: number, purchase_currency?: string, price_estimated?: boolean } | null} [acq]
 */
function purchaseCell(unit, qty, cur, acq) {
  const amount = purchaseAmount(unit, qty, cur, acq);
  return acq?.price_estimated ? estimatedPurchase(amount) : amount;
}

/**
 * @param {unknown} unit @param {unknown} qty @param {string} cur
 * @param {{ original_purchase_price?: number, purchase_currency?: string } | null} [acq]
 */
function purchaseAmount(unit, qty, cur, acq) {
  const p = unit == null || String(unit).trim() === '' ? NaN : Number(unit);
  // In a foreign currency with no rate the price doesn't count towards the total, but is still shown: a
  // dash would mean "unknown".
  if (!Number.isFinite(p) && acq?.original_purchase_price != null)
    return html`${fmtMoney(acq.original_purchase_price * (parseInt(String(qty), 10) || 1), acq.purchase_currency)}<span class="fin-per">${tRaw('finance.not_converted')}</span>`;
  if (!Number.isFinite(p)) return '<span class="text-mut">—</span>';
  const n = parseInt(String(qty), 10) || 1;
  if (n <= 1) return fmtMoney(p, cur);
  return html`${fmtMoney(p * n, cur)}<span class="fin-per">${tRaw('finance.per', { price: fmtMoney(p, cur) })}</span>`;
}

/**
 * The price columns' headers. They do not wrap: "Profit/Loss" shows abbreviated, with the full name in
 * the title and for screen readers.
 */
function priceHeads(sortable = false) {
  const short = (/** @type {string} */ long, /** @type {string} */ shortTxt) =>
    html`<th class="number" title="${tRaw(long)}"${sortState('guv', sortable)}>${sortButton('guv', sortable, html`<span aria-hidden="true">${rawHtml(shortTxt)}</span><span class="vh">${tRaw(long)}</span>`)}</th>`;
  return html`${html`<th class="number"${sortState('purchase', sortable)}>${sortButton('purchase', sortable, tRaw('finance.col.purchase'))}</th>`}${html`<th class="number"${sortState('value', sortable)}>${sortButton('value', sortable, tRaw('finance.grand.value'))}</th>`}${short('finance.total_pnl', tRaw('finance.pnl_short'))}`;
}

// ── Many items: search, sort, in blocks ──────────────────────────
// 1,500 sets produced 1,578 rows all at once (101,738 px, 51,000 nodes). Shown in blocks instead; search
// and sort act on all items, the totals keep describing the whole inventory.
const FIN_BLOCK = 100;
let _finSearch = '',
  _finLimit = FIN_BLOCK;
/** @type {{ field: string, ab: boolean }} */
let _finSort = { field: '', ab: false };
/** @type {null | { sets: ValuedSet[], parts: import('../../frontend-types/contract').PartsValuationResponse['parts'], figs: import('../../frontend-types/contract').FigsValuationResponse['figs'], purchase: { sets: number, parts: number, figs: number, all: number }, value: { sets: number, parts: number, figs: number, all: number }, setsQtyAvg: number, cur: string, basis: Basis, ctx: RowContext }} */
let _finState = null;

/** @param {string} field @param {boolean} on */
function sortState(field, on) {
  if (!on) return '';
  return html` aria-sort="${_finSort.field === field ? (_finSort.ab ? 'descending' : 'ascending') : 'none'}"`;
}
/** @param {string} field @param {boolean} on @param {import('./escaping.js').Markup | string} content */
function sortButton(field, on, content) {
  return on
    ? html`<button type="button" class="sort-button" data-click="finSort" data-arg="${field}">${content}</button>`
    : content;
}

/** @param {ValuedSet} s @returns {number | string} */
function sortValue(s) {
  const f = _finSort.field;
  if (f === 'name') return String(s.name || s.set_number).toLocaleLowerCase();
  if (f === 'purchase') return (Number(s.purchase_price) || 0) * (s.quantity || 1);
  if (f === 'value') return Number(s.value_total) || 0;
  return Number(s.pnl_percent ?? -Infinity);
}

/** Tables from the current state: search, sort and the block limit. */
function renderFinanceTables() {
  const st = _finState;
  if (!st) return;
  const q = _finSearch.toLocaleLowerCase();
  const matches = (/** @type {unknown[]} */ ...fields) =>
    !q ||
    fields.some(f =>
      String(f ?? '')
        .toLocaleLowerCase()
        .includes(q),
    );
  const sets = st.sets.filter(s => matches(s.name, s.set_number));
  if (_finSort.field)
    sets.sort((a, b) => {
      const x = sortValue(a),
        y = sortValue(b);
      const r = x < y ? -1 : x > y ? 1 : 0;
      return _finSort.ab ? -r : r;
    });
  const parts = st.parts.filter(p => matches(p.part_name, p.part_number, p.color_name));
  const figs = st.figs.filter(f => matches(f.fig_name, f.fig_number));
  const setRows = sets.flatMap(s => {
    const acqs = s.acquisitions || [];
    return acqs.length <= 1 ? [setRow(s, acqs[0] || null, st.ctx)] : acqs.map(a => setRow(s, a, st.ctx));
  });
  const manLimit = Math.round(_finLimit / 2);
  const partsRows = parts
    .slice(0, manLimit)
    .map(p =>
      pmRows(
        p,
        `${esc(p.part_name || p.part_number)}${p.color_name ? html` <span class="text-mut text-1">(${colorName(p.color_name)})</span>` : ''}`,
        st.ctx,
      ),
    )
    .join('');
  const figsRows = figs
    .slice(0, manLimit)
    .map(f => pmRows(f, esc(f.fig_name || f.fig_number), st.ctx))
    .join('');
  const rest =
    Math.max(0, setRows.length - _finLimit) +
    Math.max(0, parts.length - manLimit) +
    Math.max(0, figs.length - manLimit);
  const more = rest ? html`<div class="load-dot" id="fin-sentinel" aria-hidden="true"></div>` : '';
  const noHits =
    q && !setRows.length && !parts.length && !figs.length
      ? html`<p class="text-mut">${tRaw('common.no_hits', { query: _finSearch })}</p>`
      : '';
  setHtml(
    G('fin-tbl'),
    html`${noHits}${setsTable(setRows.slice(0, _finLimit).join(''), st.purchase, st.setsQtyAvg, st.cur)}${manualSection(
      {
        kind: 'parts',
        title: tRaw('parts.manual_section'),
        symbol: 'part',
        rows: partsRows,
        count: parts.length,
        purchase: st.purchase.parts,
        value: st.value.parts,
        cur: st.cur,
      },
    )}${manualSection({
      kind: 'figs',
      title: tRaw('finance.figs_section'),
      symbol: 'minifig',
      rows: figsRows,
      count: figs.length,
      purchase: st.purchase.figs,
      value: st.value.figs,
      cur: st.cur,
    })}${more}${totalsTable(st.purchase, st.value, st.cur, st.basis)}`,
  );
  if (q) reportHits(tRaw('match.entries', { n: sets.length + parts.length + figs.length }));
  // The filter survives the redraw; otherwise the chips would show a selection the table no longer has.
  finFilterApply();
  finSentinelBind();
}

/** @type {IntersectionObserver | null} */
let _finIO = null;
/** As in the catalog: when the table's end comes into view, the next block follows. The marker is
 * recreated on every redraw; a new observer reports right away whether it is already visible (tall windows). */
function finSentinelBind() {
  _finIO?.disconnect();
  const s = G('fin-sentinel');
  if (!s) return;
  if (typeof IntersectionObserver === 'function') {
    _finIO = new IntersectionObserver(
      es => {
        if (es.some(e => e.isIntersecting)) finMore();
      },
      { rootMargin: '600px' },
    );
    _finIO.observe(s);
  } else {
    // Without an observer there is no scrolling to track: better to show everything than leave rows
    // unreachable.
    _finLimit = Infinity;
    renderFinanceTables();
  }
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let _finSearchTimer;
/** @this {HTMLInputElement} */
function finSearch() {
  const value = this.value.trim();
  clearTimeout(_finSearchTimer);
  _finSearchTimer = setTimeout(() => {
    _finSearch = value;
    _finLimit = FIN_BLOCK;
    renderFinanceTables();
  }, 200);
}
/** @param {string} field */
function finSort(field) {
  _finSort = { field: field, ab: _finSort.field === field ? !_finSort.ab : field !== 'name' };
  renderFinanceTables();
  /** @type {HTMLElement | null} */ (
    document.querySelector(`#fin-tbl [data-click="finSort"][data-arg="${field}"]`)
  )?.focus();
}
function finMore() {
  _finLimit += FIN_BLOCK;
  renderFinanceTables();
}
/** What the "status" column's symbols mean; one entry per line without a break, otherwise "⚠" stood alone
 * at the end of the line. */
function legend() {
  const entry = (
    /** @type {string} */ cls,
    /** @type {import('./escaping.js').Markup | string} */ symbol,
    /** @type {string} */ text,
  ) =>
    html`<span class="legend-entry"><span class="legend-char pst ${cls}" aria-hidden="true">${symbol}</span> ${text}</span>`;
  return html`<p class="fin-legend"><span>${tRaw('finance.legend.title')}</span>${entry('pst-ok', ico('ok'), tRaw('finance.legend.ok'))}<span aria-hidden="true">·</span>${entry('pst-empty', '–', tRaw('finance.legend.missing'))}<span aria-hidden="true">·</span>${entry('pst-err', ico('warning'), tRaw('finance.legend.error'))}<span>${tRaw('finance.legend.text')}</span></p>`;
}

/**
 * Number from the server response, otherwise the fallback value.
 * @param {unknown} v
 * @param {number} fallback
 */
function numberOr(v, fallback) {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Sum of purchase prices times quantity — per entry if there are any, otherwise per item.
 * @typedef {{ purchase_price?: unknown, quantity?: unknown }} PurchaseItem
 * @param {(PurchaseItem & { acquisitions?: PurchaseItem[] | null })[] | null | undefined} list
 */
function purchaseFrom(list) {
  let s = 0;
  for (const it of list || []) {
    const acqs = it.acquisitions?.length ? it.acquisitions : [it];
    for (const a of acqs) {
      const p = parseFloat(String(a.purchase_price));
      if (Number.isFinite(p)) s += p * (parseInt(String(a.quantity), 10) || 1);
    }
  }
  return s;
}

/**
 * A totals row's cells: purchase total and market value, under the like-named columns. On a phone both
 * carry their own label (data-short).
 * @param {number} buy
 * @param {number} value
 * @param {string} cur
 */
function totalCells(buy, value, cur, note = '') {
  const k = html`<td class="price-total fin-footer-value" data-short="${t('finance.col.purchase')}">${buy > 0 ? fmtN(buy, cur) : html`<span class="text-mut">—</span>`}</td>`;
  const w = html`<td class="price-total fin-footer-value" data-short="${t('finance.grand.value')}">${value > 0 ? html`${fmtN(value, cur)}${note ? html`<span class="fin-per">${note}</span>` : ''}` : noValue()}</td>`;
  return html`${k}${w}`;
}
// Category filter like in the Android app; empty selection means all. Filtering hides rather than
// re-renders: the totals describe the inventory, not the selection, and should stay put.
const finCategories = new Set();

/**
 * Does the tab show this row kind? Empty selection means all.
 * @param {string} kind
 */
function finShows(kind) {
  return finCategories.size === 0 || finCategories.has(kind);
}

/** Show/hide sections and update the chips. */
function finFilterApply() {
  // style.display instead of the hidden attribute: `.tw` sets its own display in styles.css, and an
  // author rule beats the browser's `[hidden]`. The section would stay visible without anything failing.
  queryAll('#fin-tbl [data-fin-kind]').forEach(el => {
    el.style.display = finShows(el.dataset.finKind ?? '') ? '' : 'none';
  });
  queryAll('#fin-filter button').forEach(b => {
    const kind = b.dataset.kind;
    const on = kind ? finCategories.has(kind) : finCategories.size === 0;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

/**
 * A chip was clicked.
 *
 * "all" clears the selection; the other three toggle their row kind on and off individually. Deselecting
 * the last kind leads to the empty set — which again means ALL. A view that stayed empty after
 * deselecting would not be a filter, but an empty page.
 * @param {string} kind
 */
function finFilter(kind) {
  if (kind === 'all') finCategories.clear();
  else if (finCategories.has(kind)) finCategories.delete(kind);
  else finCategories.add(kind);
  finFilterApply();
}

// ── Register handlers with the dispatcher (see js/registry.js) ──────────────
registerActions({
  loadFinance,
  finSearch,
  finSort,
  finFilter,
});

subscribe('financesLoad', () => loadFinance());
