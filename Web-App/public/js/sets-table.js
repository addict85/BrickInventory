// The collection as a table: sortable column headers and one row per set. The tiles live in collection.js.
import { tRaw, locale } from '../i18n.js';
import { html } from './escaping.js';
import { bildTag, placeholderContent, imgUrl, thumbUrl } from './images.js';
import { G, ico, TRASH_ICON_SVG } from './dom.js';
import { fmtDatum, fmtGeld, fmtN, isGift } from './format.js';
import { estimatedPurchase, pnlBadge, rowsButton } from './components.js';
import { echt } from './registry.js';
import { accountCurrency } from './state.js';
/** @typedef {import('./state.js').Tile} Tile */

/** Sortable columns of the table: the first click sorts in the usual direction, the second reverses it. */
export const COLUMNS_SORT = /** @type {Record<string, [string, string]>} */ ({
  num: ['num_asc', 'num_desc'],
  name: ['name_asc', 'name_desc'],
  year: ['year_desc', 'year_asc'],
  qty: ['qty_desc', 'qty_asc'],
  kauf: ['kauf_desc', 'kauf_asc'],
});
/** @param {string} field @param {string} text */
function sortHead(field, text) {
  const so = G('gsort')?.value || '';
  const state = COLUMNS_SORT[field].includes(so) ? (so.endsWith('_desc') ? 'descending' : 'ascending') : 'none';
  return html`<th aria-sort="${state}"><button type="button" class="sort-knopf" data-click="setsSortieren" data-arg="${field}">${text}</button></th>`;
}

/** @param {Tile[]} list */
export function setsTabelle(list) {
  return html`<div class="tw"><table class="dt" aria-label="${tRaw('nav.collection')}"><thead><tr><th>${tRaw('col.image_th')}</th>${sortHead('num', tRaw('col.nr'))}${sortHead('name', tRaw('col.name'))}${sortHead('year', tRaw('detail.year'))}<th>${tRaw('detail.theme')}</th><th>${tRaw('detail.pieces')}</th><th>${tRaw('detail.minifigs')}</th>${sortHead('qty', tRaw('detail.qty'))}${sortHead('kauf', tRaw('gallery.card.bought'))}<th class="zahl">${tRaw('finance.col.purchase')}</th><th class="zahl">${tRaw('finance.stat.value')}</th><th>${tRaw('detail.instructions')}</th><th><span class="vh">${tRaw('common.actions')}</span></th></tr></thead><tbody>${list.map(tableRow)}</tbody></table></div>`;
}

/** Amount for the whole quantity, with the unit price underneath: as in Finances. @param {number} unit @param {number} qty */
function withUnit(unit, qty) {
  const total = fmtGeld(unit * qty, accountCurrency);
  return qty > 1
    ? html`${total}<span class="fin-je">${tRaw('finance.je', { preis: fmtGeld(unit, accountCurrency) })}</span>`
    : total;
}

/** @param {Tile} s */
function purchaseCell(s) {
  const buy = s.avg_purchase_price ?? s.max_purchase_price;
  if (buy == null) return html`<span class="text-mut">—</span>`;
  if (isGift(buy)) return html`<span class="geschenk-badge">${tRaw('finance.gift')}</span>`;
  const amount = withUnit(Number(buy), s.quantity || 1);
  return s.kaufpreis_geschaetzt ? estimatedPurchase(amount) : amount;
}

/** Market value of the quantity with the trend against the purchase price; the price arrives later
 * (updateGalleryPrices). @param {Tile} s */
export function valueCell(s) {
  if (!s._price || s._source !== 'markt') return html`<span class="text-mut">—</span>`;
  const buy = s.avg_purchase_price ?? s.max_purchase_price;
  const pnl = isGift(buy) ? '' : pnlBadge(s._pnl_pct, buy);
  const qty = s.quantity || 1;
  return html`${fmtN(s._price * qty, accountCurrency)}${qty > 1 ? html`<span class="fin-je">${tRaw('finance.je', { preis: fmtN(s._price, accountCurrency) })}</span>` : ''}${pnl ? html`<span class="tab-pnl" title="${tRaw('gallery.card.pnl_hint')}"><span class="vh">${tRaw('gallery.card.pnl_hint')}: </span>${pnl}</span>` : ''}`;
}

/** @param {Tile} s */
export function tableRow(s) {
  const src = s.image_local || s.image_url || '';
  const name = s.name || s.set_number;
  return html`<tr data-stil="cursor:pointer" data-click="openModal" data-arg="${s.set_number}">
    <td>${src ? bildTag({ src: imgUrl(thumbUrl(src) || src, true), alt: '', ph: 'set' }) : html`<span class="bild-ph" aria-hidden="true">${placeholderContent('set')}</span>`}</td>
    <td>${rowsButton({ click: 'openModal', arg: s.set_number }, html`<span data-stil="font-family:var(--mono);color:var(--b600);font-size:var(--fs-1);white-space:nowrap">${s.set_number}</span>`, tRaw('zeile.oeffnen', { name: s.name || s.set_number, nr: s.set_number }))}</td>
    <td>${s.name || '—'}</td><td>${s.year || '—'}</td><td>${s.theme || '—'}</td>
    <td>${s.pieces ? s.pieces.toLocaleString(locale()) : '—'}</td><td>${s.minifigs || '—'}</td>
    <td><span class="qbadge">×${s.quantity}</span></td>
    <td data-stil="font-size:var(--fs-1);color:var(--mut)">${s.letzter_kauf ? fmtDatum(s.letzter_kauf) : '—'}</td>
    <td class="zahl">${purchaseCell(s)}</td><td class="zahl" data-tabwert-for="${s.set_number}">${valueCell(s)}</td>
    <td>${s.instructions?.length ? html`<span class="ibadge">${ico('liste')}${s.instructions.length}</span>` : '—'}</td>
    <td class="zeilen-aktionen" data-click="stopEvent"><button class="btn bs btn-sm" data-click="reimportParts" data-arg="${s.set_number}" title="${tRaw('detail.reimport_parts')}" aria-label="${tRaw('gallery.zeile.reimport', { name })}">${ico('aktualisieren')}</button><button class="btn bs btn-sm" data-click="delSet"${echt()} data-arg="${s.set_number}" title="${tRaw('detail.delete')}" aria-label="${tRaw('gallery.zeile.loeschen', { name })}">${TRASH_ICON_SVG}</button></td>
  </tr>`;
}
