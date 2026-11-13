// Wie Kaufpreise dastehen: Summenzeile, Währung, Umrechnung und Schätzung, in Dialog und Detail gleich.
// Eigene Datei, weil Set-Detail, Kaufpreis-Dialog und Detail manueller Einträge dieselben Bausteine nutzen.
import { tRaw } from '../i18n.js';
import { esc, html } from './escapen.js';
import { ico } from './dom.js';
import { fmtDatum, fmtGeld, fmtGeldCode, fmtN } from './format.js';
import { CURRENCY } from './zustand.js';
/** @typedef {import('../../frontend-typen/vertrag').AcquisitionTotals} Erfassungssumme */
/** @typedef {import('../../frontend-typen/vertrag').Acquisition} Erfassung */

/**
 * Summenzeile unter einer Erfassungsliste.
 *
 * Die Zahlen kommen fertig vom Server (`totals`); hier wird nur gezeichnet.
 * `amount === null` heisst „kein Kaufpreis erfasst" — das ist etwas anderes
 * als ein Betrag von null, und deshalb entscheidet der Server das und nicht diese Funktion.
 *
 * @param {Erfassungssumme | null | undefined} totals
 */
export function acqSummary(totals) {
  const menge = totals?.quantity ?? 0;
  return html`<div id="acq-summary" data-stil="display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;padding:.75rem .5rem 0;border-top:2px solid var(--bdr);margin-top:.25rem">
    <span data-stil="font-size:var(--fs-2);color:var(--mut)">${tRaw('detail.qty')}: <strong id="acq-total-qty">${menge}</strong></span>
    <span id="acq-total-price" class="preis preis-stark">${summenText(totals)}</span>
    ${summenHinweis(totals)}
  </div>`;
}

/** Die Summe in der Währung des Kontos; fremde Käufe hat der Server zum Kurs des Kauftags umgerechnet.
 * @param {Erfassungssumme | null | undefined} totals */
export function summenText(totals) {
  return totals?.amount != null ? fmtN(totals.amount, totals.currency || CURRENCY) : '—';
}

/** @param {Erfassungssumme | null | undefined} totals */
function summenHinweis(totals) {
  return html`<span id="acq-summe-hinweis" class="acq-legende" data-stil="flex-basis:100%"${totals?.ohne_kurs ? '' : ' hidden'}>${totals?.ohne_kurs ? tRaw('acq.ohne_kurs', { n: totals.ohne_kurs }) : ''}</span>`;
}

/**
 * „≈ 241,23 €“ neben einem Kauf in fremder Währung: Die Summe rechnet mit diesem Betrag.
 * @param {Erfassung} a @param {Erfassungssumme | null | undefined} totals
 */
export function umgerechnetText(a, totals) {
  const konto = totals?.currency || CURRENCY;
  if (!a.currency || a.currency === konto || a.preis_konto == null) return '';
  return '≈ ' + fmtN(a.preis_konto, konto);
}

/**
 * Preis einer Erfassung in ihrer eigenen Währung. Ein Marktpreis, den der Server eingesetzt hat, ist kein
 * bezahlter Betrag und trägt deshalb „≈“.
 * Ein Kauf in fremder Währung trägt den ISO-Code („79,99 USD“, „$“ wäre auch CAD oder AUD) und den Betrag,
 * mit dem Summen und Finanzen rechnen („≈ 74,06 €“, Kurs des Kauftags).
 * @param {{ currency?: string | null, price_estimated?: boolean, preis_konto?: number | null }} a
 * @param {number | null | undefined} betrag
 */
export function erfassungsPreis(a, betrag) {
  if (betrag == null) return '';
  const fremd = !!a.currency && a.currency !== CURRENCY;
  const zahl = fremd
    ? html`<strong>${fmtGeldCode(betrag, a.currency || CURRENCY)}</strong>${a.preis_konto != null ? html` <span class="acq-umgerechnet-inline" title="${tRaw('acq.umgerechnet_titel')}">≈ ${fmtGeld(a.preis_konto, CURRENCY)}</span>` : ''}`
    : html`<strong>${fmtGeld(betrag, a.currency || CURRENCY)}</strong>`;
  if (!a.price_estimated) return zahl;
  const hinweis = esc(tRaw('acq.geschaetzt'));
  return html`<span title="${hinweis}"><span role="img" aria-label="${hinweis}">≈</span> ${zahl}</span>`;
}

/**
 * Erklärt das „≈“, sobald eine Zeile einen geschätzten Preis trägt.
 * @param {Erfassung[]} acqs
 */
function legendeGeschaetzt(acqs) {
  return acqs.some(a => a.price_estimated)
    ? html`<div class="acq-legende">${tRaw('acq.legende_geschaetzt')}</div>`
    : '';
}

/**
 * @param {Erfassung[] | null | undefined} acqs
 * @param {string} _sn
 */
export function renderAcquisitionSummary(acqs, _sn) {
  if (!acqs?.length) return html`<div data-stil="color:var(--mut);font-size:var(--fs-2)">—</div>`;
  return html`${acqs.map(a => {
    const cond =
      a.condition === 'U'
        ? html`<span class="cond-badge cond-used">${tRaw('common.condition_used')}</span>`
        : html`<span class="cond-badge cond-new">${tRaw('common.condition_new')}</span>`;
    const price = erfassungsPreis(a, a.purchase_price);
    const dateFmt = a.created_at ? fmtDatum(a.created_at) : '';
    return html`<div data-stil="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:2px 0">
      <span data-stil="color:var(--mut);font-size:var(--fs-1);min-width:24px;white-space:nowrap">×${a.quantity}</span>
      ${cond}
      ${price}
      ${dateFmt ? html`<span data-stil="font-size:var(--fs-1);color:var(--mut)">${dateFmt}</span>` : ''}
    </div>`;
  })}${legendeGeschaetzt(acqs)}`;
}

// Kurzübersicht für Teile und Figuren (mit unit_price statt purchase_price)
/**
 * @param {Erfassung[] | null | undefined} acqs
 * @param {string} _type
 * @param {string} _id
 * @param {number} _colorId
 */
export function renderManAcqSummary(acqs, _type, _id, _colorId) {
  if (!acqs?.length) return html`<div data-stil="color:var(--mut);font-size:var(--fs-2)">—</div>`;
  return html`${acqs.map(a => {
    const cond =
      a.condition === 'U'
        ? html`<span class="cond-badge cond-used">${tRaw('common.condition_used')}</span>`
        : html`<span class="cond-badge cond-new">${tRaw('common.condition_new')}</span>`;
    const price = erfassungsPreis(a, a.unit_price);
    const dateFmt = a.created_at ? fmtDatum(a.created_at) : '';
    return html`<div data-stil="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:2px 0">
      <span data-stil="color:var(--mut);font-size:var(--fs-1);min-width:24px;white-space:nowrap">×${a.quantity}</span>
      ${cond}
      ${price}
      ${dateFmt ? html`<span data-stil="font-size:var(--fs-1);color:var(--mut)">${dateFmt}</span>` : ''}
    </div>`;
  })}${legendeGeschaetzt(acqs)}`;
}

/** Kurzfassung im Set-Detail samt Knopf zum Kaufpreis-Dialog.
 * @param {Erfassung[] | null | undefined} acqs @param {string} sn */
export function kurzfassung(acqs, sn) {
  return html`${renderAcquisitionSummary(acqs, sn)}${html`<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${sn}" data-stil="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>`}`;
}

/** Dasselbe für ein manuell erfasstes Teil oder eine Figur.
 * @param {Erfassung[] | null | undefined} acqs @param {string} type @param {string} id @param {number} colorId */
export function kurzfassungMan(acqs, type, id, colorId) {
  return html`${renderManAcqSummary(acqs, type, id, colorId)}${html`<button class="btn bs btn-sm" data-click="openManAcqModal" data-stil="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>`}`;
}
