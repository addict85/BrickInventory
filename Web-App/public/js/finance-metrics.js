// Finances: the cards above the table (purchase price, market value, profit/loss) and the row they're based on.
import { pnlBadge } from './components.js';
import { tRaw } from '../i18n.js';
import { html } from './escaping.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtN } from './format.js';

/**
 * The cards' shared basis from the server; without it (pnl failed) there's no P&L.
 * @typedef {{ bewertet: number, withoutMarket: number, withoutPurchase: number, einstand: number, wert: number, betrag: number,
 *   gesamt?: number, withoutMarketCost?: number, withoutPurchaseValue?: number }} Basis
 * @param {Partial<import('../../frontend-types/contract').PnlTotals>} pt @param {number} missingPrice
 * @returns {Basis}
 */
export function baseFrom(pt, missingPrice) {
  const z = (/** @type {unknown} */ v) => parseFloat(String(v)) || 0;
  if (pt.basis_einstand == null)
    return { bewertet: 0, withoutMarket: missingPrice, withoutPurchase: 0, einstand: 0, wert: 0, betrag: 0 };
  return {
    gesamt: pt.positionen || 0,
    bewertet: pt.positionen_bewertet || 0,
    withoutMarket: pt.positionen_ohne_marktpreis || 0,
    withoutPurchase: pt.positionen_ohne_kaufpreis || 0,
    einstand: z(pt.basis_einstand),
    wert: z(pt.basis_marktwert),
    betrag: z(pt.basis_guv_betrag),
    withoutMarketCost: z(pt.ohne_marktpreis_einstand),
    withoutPurchaseValue: z(pt.ohne_kaufpreis_marktwert),
  };
}

/** A short title; what "valued" means is in the tooltip, in full in the row below the cards.
 * @param {HTMLElement} el @param {string} title @param {boolean} withHelp */
function titleWithHelp(el, title, withHelp) {
  el.textContent = title;
  if (withHelp) el.title = tRaw('finance.stat.bewertet_hilfe');
  else el.removeAttribute('title');
}

/**
 * The tiles above the table. The purchase total is always known; the grand total and P&L only when there
 * are market prices — otherwise the tile says for how many items the price is missing, instead of showing "—".
 */
/** @param {{ basis: Basis, costAll: number, valueAll: number, guv: number | null | undefined, cur: string, foreignCurrency?: number, geschaetzt?: number, zeilen?: number }} p */
export function showMetrics({ basis, costAll, valueAll, guv, cur, foreignCurrency = 0, geschaetzt = 0, zeilen = 0 }) {
  G('fin-sum').dataset.geladen = '1';
  G('fin-sum').removeAttribute('aria-busy');
  const hasBasis = basis.bewertet > 0;
  const purchase = hasBasis ? basis.einstand : costAll;
  const value = hasBasis ? basis.wert : valueAll;
  const partial = hasBasis && Math.abs(costAll - basis.einstand) >= 0.005;
  titleWithHelp(
    G('fin-einstand-titel'),
    tRaw(partial ? 'finance.stat.purchase_basis' : 'finance.stat.purchase'),
    partial,
  );
  G('fin-einstand').textContent = purchase > 0 || hasBasis ? fmtN(purchase, cur) : '—';
  // Purchase prices in another currency are not counted by the server (no exchange rates); their number
  // sits underneath.
  G('fin-einstand-sub').textContent =
    foreignCurrency > 0
      ? tRaw('finance.fremde_waehrung_n', { n: foreignCurrency })
      : partial
        ? tRaw('finance.stat.purchase_von', { betrag: fmtN(costAll, cur) })
        : tRaw('finance.stat.purchase_hint');
  const missing = basis.withoutMarket > 0 ? tRaw('finance.price_missing_n', { n: basis.withoutMarket }) : '';
  // If the tile only sums up valued items, it says so; otherwise two "market values" would show different numbers.
  const valuePartial = hasBasis && Math.abs(valueAll - basis.wert) >= 0.005;
  titleWithHelp(
    G('fin-wert-titel'),
    tRaw(valuePartial ? 'finance.stat.value_basis' : 'finance.stat.value'),
    valuePartial,
  );
  if (value > 0) {
    G('fin-wert').textContent = fmtN(value, cur);
    G('fin-wert-sub').textContent = valuePartial
      ? tRaw('finance.stat.value_von', { betrag: fmtN(valueAll, cur) })
      : tRaw('finance.stat.value_hint');
  } else {
    // Without items, no price is missing — then it's simply "—".
    if (missing) setzeHtml(G('fin-wert'), html`<span class="fval-hinweis">${missing}</span>`);
    else G('fin-wert').textContent = '—';
    G('fin-wert-sub').textContent = '';
  }
  // The tile stays in place, so the row doesn't jump; without prices, with a hint.
  if (hasBasis && guv != null) {
    setzeHtml(G('fin-total-pnl'), pnlBadge(guv));
    // Amount and percentage from the same items (with BOTH a purchase and a market price). "against the
    // purchase total": the chart's percentage is computed against the start of the period.
    const b = basis.betrag;
    G('fin-pnl-sub').textContent = tRaw('finance.pnl_vs_purchase', {
      betrag: `${b >= 0 ? '+' : '−'}${fmtN(Math.abs(b), cur)}`,
    });
  } else {
    G('fin-total-pnl').textContent = '—';
    G('fin-pnl-sub').textContent = tRaw('finance.pnl_needs_prices');
  }
  const row = G('fin-basis');
  if (!row) return;
  const parts = [];
  if (basis.withoutMarket > 0)
    parts.push(
      tRaw('finance.basis.ohne_markt', { n: basis.withoutMarket, betrag: fmtN(basis.withoutMarketCost || 0, cur) }),
    );
  if (basis.withoutPurchase > 0)
    parts.push(
      tRaw('finance.basis.ohne_kauf', { n: basis.withoutPurchase, betrag: fmtN(basis.withoutPurchaseValue || 0, cur) }),
    );
  // Estimated purchase prices count towards the total but aren't paid: that number belongs next to the result.
  if (geschaetzt > 0) parts.push(tRaw('finance.basis.geschaetzt', { n: geschaetzt }));
  if (!hasBasis || !parts.length) {
    row.hidden = true;
    row.textContent = '';
    return;
  }
  row.hidden = false;
  setzeHtml(
    row,
    // The server counts per item, the table shows one row per purchase and account; if the numbers
    // differ, the tooltip says why.
    html`${ico('info')}<span>${basisSentence(tRaw('finance.basis.gerechnet', { n: basis.bewertet, von: basis.gesamt }), zeilen > (basis.gesamt ?? 0))} ${parts.join(' · ')}</span>`,
  );
}

/** @param {string} sentence @param {boolean} rowHint */
function basisSentence(sentence, rowHint) {
  if (!rowHint) return html`<strong>${sentence}</strong>`;
  const h = tRaw('finance.basis.zeilen_hilfe');
  return html`<strong title="${h}">${sentence}<span class="vh"> ${h}</span></strong>`;
}
