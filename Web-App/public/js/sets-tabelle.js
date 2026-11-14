// Die Sammlung als Tabelle: Spaltenköpfe mit Sortierung und eine Zeile je Set. Die Kacheln stehen in gallery.js.
import { tRaw, locale } from '../i18n.js';
import { html } from './escapen.js';
import { bildTag, platzhalterInhalt, imgUrl, thumbUrl } from './bilder.js';
import { G, ico, TRASH_ICON_SVG } from './dom.js';
import { fmtDatum } from './format.js';
import { zeilenKnopf } from './bausteine.js';
import { echt } from './registry.js';
/** @typedef {import('./zustand.js').Kachel} Kachel */

/** Sortierbare Spalten der Tabelle: erster Klick in der üblichen Richtung, der zweite kehrt sie um. */
export const SPALTEN_SORT = /** @type {Record<string, [string, string]>} */ ({
  num: ['num_asc', 'num_desc'],
  name: ['name_asc', 'name_desc'],
  year: ['year_desc', 'year_asc'],
  qty: ['qty_desc', 'qty_asc'],
  kauf: ['kauf_desc', 'kauf_asc'],
});
/** @param {string} feld @param {string} text */
function sortKopf(feld, text) {
  const so = G('gsort')?.value || '';
  const stand = SPALTEN_SORT[feld].includes(so) ? (so.endsWith('_desc') ? 'descending' : 'ascending') : 'none';
  return html`<th aria-sort="${stand}"><button type="button" class="sort-knopf" data-click="setsSortieren" data-arg="${feld}">${text}</button></th>`;
}

/** @param {Kachel[]} list */
export function setsTabelle(list) {
  return html`<div class="tw"><table class="dt" aria-label="${tRaw('nav.collection')}"><thead><tr><th>${tRaw('col.image_th')}</th>${sortKopf('num', tRaw('col.nr'))}${sortKopf('name', tRaw('col.name'))}${sortKopf('year', tRaw('detail.year'))}<th>${tRaw('detail.theme')}</th><th>${tRaw('detail.pieces')}</th><th>${tRaw('detail.minifigs')}</th>${sortKopf('qty', tRaw('detail.qty'))}${sortKopf('kauf', tRaw('gallery.card.bought'))}<th>${tRaw('detail.instructions')}</th><th><span class="vh">${tRaw('common.actions')}</span></th></tr></thead><tbody>${list.map(tableRow)}</tbody></table></div>`;
}

/** @param {Kachel} s */
export function tableRow(s) {
  const src = s.image_local || s.image_url || '';
  const name = s.name || s.set_number;
  return html`<tr data-stil="cursor:pointer" data-click="openModal" data-arg="${s.set_number}">
    <td>${src ? bildTag({ src: imgUrl(thumbUrl(src) || src, true), alt: '', ph: 'set' }) : html`<span class="bild-ph" aria-hidden="true">${platzhalterInhalt('set')}</span>`}</td>
    <td>${zeilenKnopf({ click: 'openModal', arg: s.set_number }, html`<span data-stil="font-family:var(--mono);color:var(--b600);font-size:var(--fs-1);white-space:nowrap">${s.set_number}</span>`, tRaw('zeile.oeffnen', { name: s.name || s.set_number, nr: s.set_number }))}</td>
    <td>${s.name || '—'}</td><td>${s.year || '—'}</td><td>${s.theme || '—'}</td>
    <td>${s.pieces ? s.pieces.toLocaleString(locale()) : '—'}</td><td>${s.minifigs || '—'}</td>
    <td><span class="qbadge">×${s.quantity}</span></td>
    <td data-stil="font-size:var(--fs-1);color:var(--mut)">${s.letzter_kauf ? fmtDatum(s.letzter_kauf) : '—'}</td>
    <td>${s.instructions?.length ? html`<span class="ibadge">${ico('liste')}${s.instructions.length}</span>` : '—'}</td>
    <td class="zeilen-aktionen" data-click="stopEvent"><button class="btn bs btn-sm" data-click="reimportParts" data-arg="${s.set_number}" title="${tRaw('detail.reimport_parts')}" aria-label="${tRaw('gallery.zeile.reimport', { name })}">${ico('aktualisieren')}</button><button class="btn bs btn-sm" data-click="delSet"${echt()} data-arg="${s.set_number}" title="${tRaw('detail.delete')}" aria-label="${tRaw('gallery.zeile.loeschen', { name })}">${TRASH_ICON_SVG}</button></td>
  </tr>`;
}
