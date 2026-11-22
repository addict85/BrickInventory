// How purchase prices are shown: sum row, currency, conversion and estimate, the same in dialog and detail.
// A file of its own, because set detail, purchase price dialog and detail of manual entries use the same building blocks.
import { tRaw } from '../i18n.js';
import { esc, html } from './escaping.js';
import { ico } from './dom.js';
import { fmtDate, fmtMoney, fmtMoneyCode, fmtN, isGift } from './format.js';
import { accountCurrency } from './state.js';
/** @typedef {import('../../frontend-types/contract').AcquisitionTotals} AcquisitionSum */
/** @typedef {import('../../frontend-types/contract').Acquisition} Acquisition */

/**
 * Sum row below an acquisition list.
 *
 * The numbers come ready-made from the server (`totals`); here they are only drawn.
 * `amount === null` means "no purchase price captured" — that is something different
 * from an amount of zero, and that is why the server decides it and not this function.
 *
 * @param {AcquisitionSum | null | undefined} totals
 */
export function acqSummary(totals) {
  const quantity = totals?.quantity ?? 0;
  return html`<div id="acq-summary" data-style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;padding:.75rem .5rem 0;border-top:2px solid var(--bdr);margin-top:.25rem">
    <span data-style="font-size:var(--fs-2);color:var(--mut)">${tRaw('detail.qty')}: <strong id="acq-total-qty">${quantity}</strong></span>
    <span id="acq-total-price" class="price price-strong">${sumsText(totals)}</span>
    ${sumsHint(totals)}
  </div>`;
}

/** The sum in the account's currency; the server converted foreign purchases at the rate of the purchase day.
 * @param {AcquisitionSum | null | undefined} totals */
export function sumsText(totals) {
  return totals?.amount != null ? fmtN(totals.amount, totals.currency || accountCurrency) : '—';
}

/** @param {AcquisitionSum | null | undefined} totals */
function sumsHint(totals) {
  return html`<span id="acq-sum-hint" class="acq-legend" data-style="flex-basis:100%"${totals?.ohne_kurs ? '' : ' hidden'}>${totals?.ohne_kurs ? tRaw('acq.without_rate', { n: totals.ohne_kurs }) : ''}</span>`;
}

/**
 * "≈ 241,23 €" next to a purchase in a foreign currency: the sum computes with this amount.
 * @param {Acquisition} a @param {AcquisitionSum | null | undefined} totals
 */
export function convertedText(a, totals) {
  const account = totals?.currency || accountCurrency;
  if (!a.currency || a.currency === account || a.preis_konto == null) return '';
  return '≈ ' + fmtN(a.preis_konto, account);
}

/**
 * Price of an acquisition in its own currency. A market price the server inserted is not a
 * paid amount and therefore carries "≈".
 * A purchase in a foreign currency carries the ISO code ("79,99 USD", "$" could also be CAD or AUD) and the amount
 * that sums and finances compute with ("≈ 74,06 €", rate of the purchase day).
 * @param {{ currency?: string | null, price_estimated?: boolean, preis_konto?: number | null }} a
 * @param {number | null | undefined} amount
 */
export function acquisitionPrice(a, amount) {
  if (amount == null) return '';
  // 0 means gifted; tile, table and finances say it like that, not "0,00 €".
  if (isGift(amount) && !a.price_estimated) return html`<strong>${tRaw('finance.gift')}</strong>`;
  const foreign = !!a.currency && a.currency !== accountCurrency;
  const number = foreign
    ? html`<strong>${fmtMoneyCode(amount, a.currency || accountCurrency)}</strong>${a.preis_konto != null ? html` <span class="acq-converted-inline" title="${tRaw('acq.converted_title')}">≈ ${fmtMoney(a.preis_konto, accountCurrency)}</span>` : ''}`
    : html`<strong>${fmtMoney(amount, a.currency || accountCurrency)}</strong>`;
  if (!a.price_estimated) return number;
  const hint = esc(tRaw('acq.estimated'));
  return html`<span title="${hint}"><span role="img" aria-label="${hint}">≈</span> ${number}</span>`;
}

/**
 * Explains the "≈" as soon as a row carries an estimated price.
 * @param {Acquisition[]} acqs
 */
function legendEstimated(acqs) {
  return acqs.some(a => a.price_estimated) ? html`<div class="acq-legend">${tRaw('acq.legend_estimated')}</div>` : '';
}

/**
 * @param {Acquisition[] | null | undefined} acqs
 * @param {string} _sn
 */
export function renderAcquisitionSummary(acqs, _sn) {
  if (!acqs?.length) return html`<div data-style="color:var(--mut);font-size:var(--fs-2)">—</div>`;
  return html`${acqs.map(a => {
    const cond =
      a.condition === 'U'
        ? html`<span class="cond-badge cond-used">${tRaw('common.condition_used')}</span>`
        : html`<span class="cond-badge cond-new">${tRaw('common.condition_new')}</span>`;
    const price = acquisitionPrice(a, a.purchase_price);
    const dateFmt = a.created_at ? fmtDate(a.created_at) : '';
    return html`<div data-style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:2px 0">
      <span data-style="color:var(--mut);font-size:var(--fs-1);min-width:24px;white-space:nowrap">×${a.quantity}</span>
      ${cond}
      ${price}
      ${dateFmt ? html`<span data-style="font-size:var(--fs-1);color:var(--mut)">${dateFmt}</span>` : ''}
    </div>`;
  })}${legendEstimated(acqs)}`;
}

// Short overview for parts and figures (with unit_price instead of purchase_price)
/**
 * @param {Acquisition[] | null | undefined} acqs
 * @param {string} _type
 * @param {string} _id
 * @param {number} _colorId
 */
export function renderManAcqSummary(acqs, _type, _id, _colorId) {
  if (!acqs?.length) return html`<div data-style="color:var(--mut);font-size:var(--fs-2)">—</div>`;
  return html`${acqs.map(a => {
    const cond =
      a.condition === 'U'
        ? html`<span class="cond-badge cond-used">${tRaw('common.condition_used')}</span>`
        : html`<span class="cond-badge cond-new">${tRaw('common.condition_new')}</span>`;
    const price = acquisitionPrice(a, a.unit_price);
    const dateFmt = a.created_at ? fmtDate(a.created_at) : '';
    return html`<div data-style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:2px 0">
      <span data-style="color:var(--mut);font-size:var(--fs-1);min-width:24px;white-space:nowrap">×${a.quantity}</span>
      ${cond}
      ${price}
      ${dateFmt ? html`<span data-style="font-size:var(--fs-1);color:var(--mut)">${dateFmt}</span>` : ''}
    </div>`;
  })}${legendEstimated(acqs)}`;
}

/** Short version in the set detail including the button to the purchase price dialog.
 * @param {Acquisition[] | null | undefined} acqs @param {string} sn */
export function summary(acqs, sn) {
  return html`${renderAcquisitionSummary(acqs, sn)}${html`<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${sn}" data-style="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('edit')} ${tRaw('detail.edit_prices')}</button>`}`;
}

/** The same for a manually captured part or a figure.
 * @param {Acquisition[] | null | undefined} acqs @param {string} type @param {string} id @param {number} colorId */
export function summaryMan(acqs, type, id, colorId) {
  return html`${renderManAcqSummary(acqs, type, id, colorId)}${html`<button class="btn bs btn-sm" data-click="openManAcqModal" data-style="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('edit')} ${tRaw('detail.edit_prices')}</button>`}`;
}
