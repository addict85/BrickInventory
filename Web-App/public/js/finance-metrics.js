// Finances: the cards above the table (purchase price, market value, profit/loss) and the row they're based on.
import { pnlBadge } from './components.js';
import { tRaw } from '../i18n.js';
import { html } from './escaping.js';
import { ico, G, setHtml } from './dom.js';
import { fmtN } from './format.js';

/**
 * The cards' shared basis from the server; without it (pnl failed) there's no P&L.
 * @typedef {{ valued: number, withoutMarket: number, withoutPurchase: number, costBasis: number, value: number, amount: number,
 *   total?: number, withoutMarketCost?: number, withoutPurchaseValue?: number }} Basis
 * @param {Partial<import('../../frontend-types/contract').PnlTotals>} pt @param {number} missingPrice
 * @returns {Basis}
 */
export function baseFrom(pt, missingPrice) {
  const z = (/** @type {unknown} */ v) => parseFloat(String(v)) || 0;
  if (pt.baseline_cost == null)
    return { valued: 0, withoutMarket: missingPrice, withoutPurchase: 0, costBasis: 0, value: 0, amount: 0 };
  return {
    total: pt.positions || 0,
    valued: pt.positions_valued || 0,
    withoutMarket: pt.positions_without_market_price || 0,
    withoutPurchase: pt.positions_without_purchase_price || 0,
    costBasis: z(pt.baseline_cost),
    value: z(pt.baseline_market_value),
    amount: z(pt.baseline_pnl_amount),
    withoutMarketCost: z(pt.cost_without_market_price),
    withoutPurchaseValue: z(pt.market_value_without_purchase_price),
  };
}

/** A short title; what "valued" means is in the tooltip, in full in the row below the cards.
 * @param {HTMLElement} el @param {string} title @param {boolean} withHelp */
function titleWithHelp(el, title, withHelp) {
  el.textContent = title;
  if (withHelp) el.title = tRaw('finance.stat.valued_help');
  else el.removeAttribute('title');
}

/** Purchase prices in another currency are not counted by the server (no exchange rates); their number
 * sits underneath. @param {Basis} basis @param {number} costAll @param {string} cur @param {number} foreignCurrency */
function showCostTile(basis, costAll, cur, foreignCurrency) {
  const hasBasis = basis.valued > 0;
  const purchase = hasBasis ? basis.costBasis : costAll;
  const partial = hasBasis && Math.abs(costAll - basis.costBasis) >= 0.005;
  titleWithHelp(
    G('fin-cost-basis-title'),
    tRaw(partial ? 'finance.stat.purchase_basis' : 'finance.stat.purchase'),
    partial,
  );
  G('fin-cost-basis').textContent = purchase > 0 || hasBasis ? fmtN(purchase, cur) : '—';
  const hint = partial
    ? tRaw('finance.stat.purchase_of', { amount: fmtN(costAll, cur) })
    : tRaw('finance.stat.purchase_hint');
  G('fin-cost-basis-sub').textContent =
    foreignCurrency > 0 ? tRaw('finance.foreign_currency_n', { n: foreignCurrency }) : hint;
}

/** If the tile only sums up valued items, it says so; otherwise two "market values" would show different
 * numbers. Without items, no price is missing — then it's simply "—". @param {Basis} basis
 * @param {number} valueAll @param {string} cur */
function showValueTile(basis, valueAll, cur) {
  const hasBasis = basis.valued > 0;
  const value = hasBasis ? basis.value : valueAll;
  const missing = basis.withoutMarket > 0 ? tRaw('finance.price_missing_n', { n: basis.withoutMarket }) : '';
  const valuePartial = hasBasis && Math.abs(valueAll - basis.value) >= 0.005;
  titleWithHelp(
    G('fin-value-title'),
    tRaw(valuePartial ? 'finance.stat.value_basis' : 'finance.stat.value'),
    valuePartial,
  );
  if (value > 0) {
    G('fin-value').textContent = fmtN(value, cur);
    G('fin-value-sub').textContent = valuePartial
      ? tRaw('finance.stat.value_of', { amount: fmtN(valueAll, cur) })
      : tRaw('finance.stat.value_hint');
    return;
  }
  if (missing) setHtml(G('fin-value'), html`<span class="fval-hint">${missing}</span>`);
  else G('fin-value').textContent = '—';
  G('fin-value-sub').textContent = '';
}

/** The tile stays in place, so the row doesn't jump; without prices, with a hint. Amount and percentage
 * come from the same items (with BOTH a purchase and a market price). "against the purchase total": the
 * chart's percentage is computed against the start of the period. @param {Basis} basis
 * @param {number | null | undefined} guv @param {string} cur */
function showPnlTile(basis, guv, cur) {
  if (!(basis.valued > 0) || guv == null) {
    G('fin-total-pnl').textContent = '—';
    G('fin-pnl-sub').textContent = tRaw('finance.pnl_needs_prices');
    return;
  }
  setHtml(G('fin-total-pnl'), pnlBadge(guv));
  const b = basis.amount;
  G('fin-pnl-sub').textContent = tRaw('finance.pnl_vs_purchase', {
    amount: `${b >= 0 ? '+' : '−'}${fmtN(Math.abs(b), cur)}`,
  });
}

/**
 * The tiles above the table. The purchase total is always known; the grand total and P&L only when there
 * are market prices — otherwise the tile says for how many items the price is missing, instead of showing "—".
 */
/** @param {{ basis: Basis, costAll: number, valueAll: number, guv: number | null | undefined, cur: string, foreignCurrency?: number, estimated?: number, rows?: number }} p */
export function showMetrics({ basis, costAll, valueAll, guv, cur, foreignCurrency = 0, estimated = 0, rows = 0 }) {
  G('fin-sum').dataset.loaded = '1';
  G('fin-sum').removeAttribute('aria-busy');
  showCostTile(basis, costAll, cur, foreignCurrency);
  showValueTile(basis, valueAll, cur);
  showPnlTile(basis, guv, cur);
  const row = G('fin-basis');
  if (!row) return;
  const parts = basisParts(basis, cur, estimated);
  if (!(basis.valued > 0) || !parts.length) {
    row.hidden = true;
    row.textContent = '';
    return;
  }
  row.hidden = false;
  setHtml(
    row,
    // The server counts per item, the table shows one row per purchase and account; if the numbers
    // differ, the tooltip says why.
    html`${ico('info')}<span>${basisSentence(tRaw('finance.basis.computed', { n: basis.valued, of: basis.total }), rows > (basis.total ?? 0))} ${parts.join(' · ')}</span>`,
  );
}

/** What the basis leaves out, as short phrases. @param {Basis} basis @param {string} cur @param {number} estimated */
function basisParts(basis, cur, estimated) {
  const parts = [];
  if (basis.withoutMarket > 0)
    parts.push(
      tRaw('finance.basis.without_market', { n: basis.withoutMarket, amount: fmtN(basis.withoutMarketCost || 0, cur) }),
    );
  if (basis.withoutPurchase > 0)
    parts.push(
      tRaw('finance.basis.without_purchase', {
        n: basis.withoutPurchase,
        amount: fmtN(basis.withoutPurchaseValue || 0, cur),
      }),
    );
  // Estimated purchase prices count towards the total but aren't paid: that number belongs next to the result.
  if (estimated > 0) parts.push(tRaw('finance.basis.estimated', { n: estimated }));
  return parts;
}

/** @param {string} sentence @param {boolean} rowHint */
function basisSentence(sentence, rowHint) {
  if (!rowHint) return html`<strong>${sentence}</strong>`;
  const h = tRaw('finance.basis.rows_help');
  return html`<strong title="${h}">${sentence}<span class="vh"> ${h}</span></strong>`;
}
