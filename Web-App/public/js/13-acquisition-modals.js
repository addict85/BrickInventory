import { detailZeile } from './01-bausteine.js';
import { echt, registerActions } from './00-registry.js';
import { colorName, t, tRaw } from '../i18n.js';
import { escHex, escJs, hexZiffern, esc, html, ungeprueft } from './00-escapen.js';
import { api } from './01-api.js';
import { fullUrl, imgUrl } from './01-bilder.js';
import { ico, G, aktiverReiter, setzeHtml, fuegeHtmlEin } from './01-dom.js';
import { fmtDatum, fmtGeld, fmtN, betragFuerFeld } from './01-format.js';
import { betragAusFeld } from './01-formular.js';
import { toast } from './01-meldungen.js';
import { applySetAggregate, loadGallery } from './02-gallery.js';
import { loadFinance } from './04-finance.js';
import { deleteManualFig, loadManualFigsTable, manuelleFiguren, updateManualFig } from './06-minifigs.js';
import { CURRENCY, ME, curSet } from './00-zustand.js';
import { closeModal, lagerortBlock, ladeOrtAuswahl } from './02-detailfelder.js';
import { confirmDelete } from './01-rueckfrage.js';
import { diagrammBreite, priceChartSVG, renderMarketRows } from './01-diagramme.js';
import { deleteManualPart, loadBrickColors, loadManualParts, manuelleTeile, updateManualPart } from './03-parts.js';
// Kaufpreis-Modal und Detailfenster für manuelle Einträge: Beides ist Erfassung, keine Administration, und
// gehört deshalb nicht nach 07-admin.js.
// Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#diese-708-zeilen-standen-in-js-07-admin
/** @typedef {import('../../frontend-typen/vertrag').HouseholdMember} Konto */
/** @typedef {import('../../frontend-typen/vertrag').AcquisitionTotals} Erfassungssumme */
/** @typedef {import('../../frontend-typen/vertrag').Acquisition} Erfassung */

// ── KAUFPREIS-MODAL ─────────────────────────────────────────────────────────
/**
 * @type {string | null}
 */
let _acqModalSn = null;

/**
 * @param {string} sn
 */
export function openAcqModal(sn) {
  _acqModalSn = sn;
  // Header
  G('acq-modal-tit').textContent = tRaw('detail.purchase_price');
  G('acq-modal-sub').textContent = sn + (curSet?.name ? ' – ' + curSet.name : '');
  setzeHtml(G('acq-modal-body'), html`<div data-stil="color:var(--mut);font-size:var(--fs-2)">${tRaw('common.loading')}</div>`);
  G('set-modal').classList.remove('open');
  _gespeichert.clear();
  G('acq-modal').classList.add('open');
  loadAcqModal(sn);
}

// Ein Klick auf den Hintergrund schliesst über closeAcqModal(), die einzige Fassung mit der Rückkehr-Logik
// für Set und manuellen Eintrag.
// Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#acq-modal
G('acq-modal').addEventListener('click', e => e.target === e.currentTarget && closeAcqModal());

/**
 * Wessen Kaufpreise gerade im Dialog stehen.
 *
 * Die Erfassungen kommen für das BLICKFELD; im Haushalt können sie mehreren Konten gehören. Der Server
 * liefert `owner_user_id` je Zeile mit, sobald es mehr als ein Konto gibt — ohne das wüsste die Auswahl
 * nicht, worauf sie steht, und ein Wechsel griffe die falsche Zeile ab.
 * @type {number | null}
 */
let _acqOwnerId = null;
/** @type {Konto[]} */
let _householdMembers = [];

/**
 * Summenzeile unter einer Erfassungsliste.
 *
 * Die Zahlen kommen fertig vom Server (`totals`); hier wird nur gezeichnet.
 * `amount === null` heisst „kein Kaufpreis erfasst" — das ist etwas anderes
 * als ein Betrag von null, und deshalb entscheidet der Server das und nicht diese Funktion.
 *
 * @param {Erfassungssumme | null | undefined} totals
 */
function acqSummary(totals) {
  const menge  = totals?.quantity ?? 0;
  const betrag = totals?.amount;
  return html`<div id="acq-summary" data-stil="display:flex;justify-content:space-between;padding:.75rem .5rem 0;border-top:2px solid var(--bdr);margin-top:.25rem">
    <span data-stil="font-size:var(--fs-2);color:var(--mut)">${tRaw('detail.qty')}: <strong id="acq-total-qty">${menge}</strong></span>
    <span id="acq-total-price" class="preis preis-stark">${betrag != null ? fmtN(betrag, CURRENCY) : '—'}</span>
  </div>`;
}

/**
 * @param {string} sn
 */
async function loadAcqModal(sn) {
  const ad = await api('GET', `/v1/sets/${sn}/acquisitions`).catch(()=>null);
  const acqs = ad?.acquisitions || [];
  if (!_householdMembers.length) {
    const hm = await api('GET', '/v1/sets/household-members').catch(() => null);
    _householdMembers = hm?.members || [];
  }
  _acqOwnerId = ad?.owner_user_id ?? ME?.id ?? null;
  renderAcqModalBody(sn, acqs, ad?.totals);
}

/**
 * Neu zeichnen, ohne den Fokus zu verlieren: Das Speichern beim Verlassen eines Feldes zeichnet die Tabelle
 * neu, wenn Tab schon im nächsten Feld steht — der Fokus fiel dann auf <body>, und die Tastatur war draussen.
 * @param {HTMLElement} ziel
 * @param {import('./00-escapen.js').Markup} markup
 */
function setzeMitFokus(ziel, markup) {
  const felder = () => /** @type {HTMLElement[]} */ ([...ziel.querySelectorAll('input, select, button')]);
  const stelle = felder().indexOf(/** @type {HTMLElement} */ (document.activeElement));
  setzeHtml(ziel, markup);
  if (stelle >= 0) felder()[stelle]?.focus({ preventScroll: true });
}

/**
 * JJJJ-MM-TT im lokalen Kalender für <input type="date">.
 * @param {string | null | undefined} v
 */
function isoTag(v) {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '';
}

/**
 * Datumsfeld mit dem Datum daneben in der Sprache der Oberfläche: Das Feld selbst zeigt die Form des Browsers
 * („06/01/2026“), nicht die der App.
 * @param {string} attrs
 * @param {string} iso
 * @param {string} textId
 */
function datumFeld(attrs, iso, textId) {
  return html`<span class="acq-datum"><input class="acq-feld" type="date" value="${iso}" aria-label="${tRaw('detail.added')}"
      aria-describedby="${textId}" ${ungeprueft(attrs)} />
    <span class="acq-datum-text" id="${textId}">${fmtDatum(iso, 'lang')}</span></span>`;
}

/** Zeilen, deren letzte Änderung gespeichert ist; die Marke übersteht das Neuzeichnen. */
const _gespeichert = new Set();
/** @param {number | string} id */
function gespeichertMarke(id) {
  return html`<span class="acq-ok" id="acq-ok-${id}" role="status"${_gespeichert.has(String(id)) ? '' : ' hidden'}>${ico('ok')}<span>${tRaw('settings.saved')}</span></span>`;
}
/** @param {number | string} id */
function zeigeGespeichert(id) {
  _gespeichert.add(String(id));
  const el = G(`acq-ok-${id}`);
  if (el) el.hidden = false;
}

/**
 * @param {string} sn
 * @param {Erfassung[]} acqs
 * @param {Erfassungssumme | undefined} totals
 */
export function renderAcqModalBody(sn, acqs, totals) {
  if (!acqs.length) {
    setzeHtml(G('acq-modal-body'), html`<div data-stil="color:var(--mut);font-size:var(--fs-3);padding:.5rem 0">—</div>`);
    return;
  }
  let markup = html`<div class="tw"><table class="dt acq-tabelle">
    <thead>
      <tr>
        <th>${tRaw('detail.qty')}</th>
        <th>${tRaw('detail.added')}</th>
        <th>${tRaw('common.condition')}</th>
        <th class="zahl">${tRaw('detail.purchase_price')}</th>
        ${_householdMembers.length > 1 ? html`<th>${tRaw('household.owner')}</th>` : ''}
        <th><span class="vh">${tRaw('common.actions')}</span></th>
      </tr>
    </thead>
    <tbody>`;

  acqs.forEach(a => {
    const dateIso = isoTag(a.created_at);
    markup = html`${markup}${html`<tr id="acq-row-${a.id}">
      <td>
        <input class="acq-feld acq-menge" inputmode="numeric" type="number" min="1" value="${a.quantity}" aria-label="${tRaw('detail.qty')}"
          data-blur="acqSave" data-arg="${sn}" data-arg2="${a.id}" data-arg3="qty" data-val="1"
          data-keydown="blurOnEnter" />
      </td>
      <td>${datumFeld(`data-change="acqSave" data-arg="${esc(sn)}" data-arg2="${a.id}" data-arg3="date" data-val="1"`, dateIso, `acq-datum-${a.id}`)}</td>
      <td>
        <select class="acq-feld" aria-label="${tRaw('common.condition')}" data-change="acqSave" data-arg="${sn}" data-arg2="${a.id}" data-arg3="cond" data-val="1">
          <option value="N" ${a.condition!=='U' ? 'selected' : ''}>${tRaw('common.condition_new')}</option>
          <option value="U" ${a.condition==='U' ? 'selected' : ''}>${tRaw('common.condition_used')}</option>
        </select>
      </td>
      <td class="zahl">
        <input class="acq-feld acq-preis" id="acq-preis-${a.id}" type="text" inputmode="decimal" autocomplete="off" value="${betragFuerFeld(a.purchase_price)}" aria-label="${tRaw('detail.purchase_price')}"
          data-blur="acqSave" data-arg="${sn}" data-arg2="${a.id}" data-arg3="price" data-val="1"
          data-keydown="blurOnEnter" />
      </td>
      ${_householdMembers.length > 1 ? html`<td>
        <select class="acq-feld" aria-label="${tRaw('household.owner')}" data-change="acqSave" data-arg="${sn}" data-arg2="${a.id}" data-arg3="owner" data-val="1">
          ${_householdMembers.map(m => html`<option value="${m.id}"${m.id === (a.owner_user_id ?? _acqOwnerId) ? ' selected' : ''}>${m.username}</option>`)}
        </select>
      </td>` : ''}
      <td class="acq-aktion">
        ${gespeichertMarke(a.id)}
        <button class="acq-loeschen" data-click="acqDelete"${echt()} data-arg="${sn}" data-arg2="${a.id}"
          title="${tRaw('gallery.delete.title')}" aria-label="${tRaw('gallery.delete.title')}">${ico('loeschen')}</button>
      </td>
    </tr>`}`;
  });

  markup = html`${markup}${html`</tbody></table></div>`}`;

  // Summenzeile: Der Server rechnet sie (acquisitionTotals in src/bestand/acquisitions.ts) und liefert sie
  // als `totals` mit. Vorher stand die Rechnung hier und noch dreimal woanders — zweimal in dieser Datei,
  // zweimal in der App, und mit verschiedenen Preisfeldern.
  markup = html`${markup}${acqSummary(totals)}`;

  setzeMitFokus(G('acq-modal-body'), markup);
}

/**
 * @param {string} sn
 * @param {string} id
 * @param {string} field
 * @param {string} value
 */
async function acqSave(sn, id, field, value) {
  /** @type {{ purchase_price?: number | null, quantity?: number, date?: string, condition?: string, owner_user_id?: number }} */
  const body = {};
  if (field === 'price') {
    const preis = betragAusFeld(`acq-preis-${id}`);
    if (!preis.ok) return;
    body.purchase_price = preis.wert;
  } else if (field === 'qty') {
    body.quantity = Math.max(1, parseInt(value) || 1);
  } else if (field === 'date') {
    body.date = value;
  } else if (field === 'owner') {
    // Eigentümerwechsel verschiebt genau diese Kaufpreis-Zeile, ohne from_user_id: Den Absender kennt der
    // Server aus der Zeile. Mit dem Betrachter als Absender fand er Zeilen von Unterkonten nicht (404).
    // Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#eigentuemerwechsel-verschieben-genau-die
    body.owner_user_id = parseInt(value);
  } else {
    body.condition = value;
  }
  const d = await api('PUT', `/v1/sets/${sn}/acquisitions/${id}`, body);
  if (field === 'owner') {
    if (!d.success) { toast(d.error || t('settings.error'), 'error'); loadAcqModal(sn); return; }
    // Nach einem Wechsel stimmt fast alles auf dem Schirm nicht mehr: Mengen, Summen, Besitzer-Plaketten.
    // Lieber neu laden als vier Stellen einzeln nachziehen.
    toast(tRaw(d.source_emptied ? 'household.move_ok' : 'household.owner_moved',
      { parts: d.parts ?? 0, figs: d.minifigs ?? 0 }), 'success');
    // restore: Ohne das landet der Nutzer nach dem Wechsel wieder bei Seite 1; so bleiben Position und
    // geladene Tiefe erhalten.
    closeAcqModal(); closeModal(); loadGallery({ restore: true });
    return;
  }
  // Der Server liefert das neu berechnete Zustands-Aggregat mit — direkt in die Galerie-Liste schreiben,
  // damit die Kachel ohne Neuladen stimmt.
  applySetAggregate(d.set);
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    if (field === 'date') loadAcqModal(sn); // abgelehnte Eingabe auf gespeicherten Wert zurücksetzen
    return;
  }
  zeigeGespeichert(id);
  if (field === 'price') { const f = G(`acq-preis-${id}`); if (f && f !== document.activeElement) f.value = betragFuerFeld(body.purchase_price); }
  // Marktpreis-Zeilen neu holen.
  //
  // Wird erstmals ein Kaufpreis in einem Zustand erfasst, entsteht dafür eine NEUE Zeile (der Server liefert
  // by_condition nur für Zustände mit Erfassung). Ohne dieses Nachladen erschiene sie erst beim nächsten
  // Öffnen des Dialogs.
  api('GET', `/v1/sets/${sn}/price-history`).then(renderMarketRows).catch(()=>{});

  // Galerie und Finanzen mitziehen: Kaufpreis und Menge wirken auf die Kachel und die Auswertung, die sonst
  // bis zum Neuladen alt blieben. restore, damit der Wechsel nicht die gescrollte Tiefe kostet.
  // Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#loadgallery
  loadGallery({ restore: true });
  loadFinance();

  // Datum geändert → Reihenfolge/Summary neu laden
  if (field === 'date') {
    loadAcqModal(sn);
    api('GET', `/v1/sets/${sn}/acquisitions`).then(ad => {
      if (ad?.success && curSet?.set_number === sn) {
        const summaryEl = G('m-acq-summary');
        if (summaryEl) setzeHtml(summaryEl, html`${ungeprueft(renderAcquisitionSummary(ad.acquisitions, sn))}${html`<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${sn}" data-stil="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>`}`);
      }
    }).catch(()=>{});
    return;
  }
  // If price was empty → server fetched market price; reload to show real value
  if (field === 'price' && (value === '' || value === null)) {
    loadAcqModal(sn);
    return;
  }
  // Zusammenfassung im Detail-Dialog nachziehen. Das Zustands-Aggregat kommt inzwischen aus der PUT-Antwort
  // (applySetAggregate oben) — hier wird nur noch die Erfassungsliste neu gerendert.
  if (field === 'cond') {
    api('GET', `/v1/sets/${sn}/acquisitions`).then(ad => {
      if (!ad?.success) return;
      const sumEl = G('m-acq-summary');
      if (sumEl) setzeHtml(sumEl, html`${ungeprueft(renderAcquisitionSummary(ad.acquisitions, sn))}${html`<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${sn}" data-stil="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>`}`);
    }).catch(()=>{});
  }
  // If qty changed → reload whole modal to update summary + refresh set-detail qty
  if (field === 'qty') {
    loadAcqModal(sn);
    // Also refresh the set detail modal summary
    api('GET', `/v1/sets/${sn}/acquisitions`).then(ad => {
      if (ad.success && curSet?.set_number === sn) {
        const summaryEl = G('m-acq-summary');
        if (summaryEl) setzeHtml(summaryEl, html`${ungeprueft(renderAcquisitionSummary(ad.acquisitions, sn))}${html`<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${sn}" data-stil="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>`}`);
      }
    }).catch(()=>{});
    return;
  }
}

/**
 * @param {string} sn
 * @param {string} id
 */
async function acqDelete(sn, id) {
  if (!await confirmDelete(tRaw('acq.delete_title'), t('acq.delete_text'), 'loeschen')) return;
  const d = await api('DELETE', `/v1/sets/${sn}/acquisitions/${id}`);
  if (!d.success) { toast(tRaw('settings.error'), 'error'); return; }
  // Update curSet + qty input in set-detail modal
  if (curSet?.set_number === sn) {
    curSet.quantity = /** @type {number} */ (d.new_quantity);
    const qEl = G('m-qty');
    if (qEl) qEl.value = String(d.new_quantity);
  }
  // Reload acq modal
  const ad = await api('GET', `/v1/sets/${sn}/acquisitions`).catch(()=>null);
  if (!ad?.acquisitions?.length) { closeAcqModal(); return; }
  renderAcqModalBody(sn, ad.acquisitions, ad.totals);
  // Refresh compact summary in set-detail modal
  const dvEl = G('m-acq-summary');
  if (dvEl) setzeHtml(dvEl, html`${ungeprueft(renderAcquisitionSummary(ad.acquisitions, sn))}${html`<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${sn}" data-stil="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>`}`);
  // Wie in acqSave(): Eine gelöschte Erfassung verändert Bestand und Wert — und lässt eine Zustands-Zeile
  // verschwinden, wenn es die letzte war.
  api('GET', `/v1/sets/${sn}/price-history`).then(renderMarketRows).catch(()=>{});
  loadGallery({ restore: true });
  loadFinance();
}

/**
 * Preis einer Erfassung in ihrer eigenen Währung. Ein Marktpreis, den der Server eingesetzt hat, ist kein
 * bezahlter Betrag und trägt deshalb „≈“.
 * @param {{ currency?: string | null, price_estimated?: boolean }} a
 * @param {number | null | undefined} betrag
 */
export function erfassungsPreis(a, betrag) {
  if (betrag == null) return '';
  const zahl = html`<strong>${fmtGeld(betrag, a.currency || CURRENCY)}</strong>`;
  if (!a.price_estimated) return zahl;
  const hinweis = esc(tRaw('acq.geschaetzt'));
  return html`<span title="${hinweis}"><span role="img" aria-label="${hinweis}">≈</span> ${zahl}</span>`;
}

// Compact link shown in set-detail-modal → opens the full acq-modal
/**
 * Erklärt das „≈“, sobald eine Zeile einen geschätzten Preis trägt.
 * @param {Erfassung[]} acqs
 */
function legendeGeschaetzt(acqs) {
  return acqs.some(a => a.price_estimated) ? html`<div class="acq-legende">${tRaw('acq.legende_geschaetzt')}</div>` : '';
}

/**
 * @param {Erfassung[] | null | undefined} acqs
 * @param {string} sn
 */
export function renderAcquisitionSummary(acqs, sn) {
  if (!acqs?.length) return html`<div data-stil="color:var(--mut);font-size:var(--fs-2)">—</div>`;
  return acqs.map(a => {
    const cond = a.condition === 'U' ? html`<span class="cond-badge cond-used">${tRaw('common.condition_used')}</span>`
      : html`<span class="cond-badge cond-new">${tRaw('common.condition_new')}</span>`;
    const price = erfassungsPreis(a, a.purchase_price);
    const dateFmt = a.created_at ? fmtDatum(a.created_at) : '';
    return html`<div data-stil="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:2px 0">
      <span data-stil="color:var(--mut);font-size:var(--fs-1);min-width:24px;white-space:nowrap">×${a.quantity}</span>
      ${cond}
      ${price}
      ${dateFmt ? html`<span data-stil="font-size:var(--fs-1);color:var(--mut)">${ungeprueft(dateFmt)}</span>` : ''}
    </div>`;
  }).join('') + legendeGeschaetzt(acqs);
}

// ── MANUAL ITEM DETAIL MODAL (Teile + Minifiguren) ─────────────────────────
/** @type {{ type: string, id: string, colorId: number, owner?: number } | null} */
let _manItem = null; // { type:'part'|'fig', id, colorId:int, owner:int|undefined }
/** Ein anderer Dialog übernimmt: Der Zustand des Teile-Dialogs gilt nicht mehr. */
export function vergissManItem() { _manItem = null; }

// Compact acquisition summary for parts/minifigs (uses unit_price, not purchase_price)
/**
 * @param {Erfassung[] | null | undefined} acqs
 * @param {string} type
 * @param {string} id
 * @param {number} colorId
 */
function renderManAcqSummary(acqs, type, id, colorId) {
  if (!acqs?.length) return html`<div data-stil="color:var(--mut);font-size:var(--fs-2)">—</div>`;
  return acqs.map(a => {
    const cond = a.condition === 'U'
      ? html`<span class="cond-badge cond-used">${tRaw('common.condition_used')}</span>`
      : html`<span class="cond-badge cond-new">${tRaw('common.condition_new')}</span>`;
    const price = erfassungsPreis(a, a.unit_price);
    const dateFmt = a.created_at ? fmtDatum(a.created_at) : '';
    return html`<div data-stil="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:2px 0">
      <span data-stil="color:var(--mut);font-size:var(--fs-1);min-width:24px;white-space:nowrap">×${a.quantity}</span>
      ${cond}
      ${price}
      ${dateFmt ? html`<span data-stil="font-size:var(--fs-1);color:var(--mut)">${ungeprueft(dateFmt)}</span>` : ''}
    </div>`;
  }).join('') + legendeGeschaetzt(acqs);
}

/** Die Zeilen des Detail-Dialogs eines manuell erfassten Teils oder einer Figur.
 * @param {string} type @param {string} id @param {number} colorId @param {{ quantity?: number, user_id?: number | null, bl_fig_number?: string | null, color_hex?: string | null, color_name?: string | null, storage?: string | null }} item @param {Erfassung[]} acqs @param {{ totals?: { priced_rows?: number, quantity?: number } } | null | undefined} ad
 * @returns {import('./00-escapen.js').Markup[]} */
function manDetailZeilen(type, id, colorId, item, acqs, ad) {
  const rows = [];

  // Qty stepper — die Stückzahl kommt aus derselben Serversumme wie die Summenzeile darunter (`totals`),
  // nicht aus einer eigenen Schleife.
  const totalQty = ad?.totals?.priced_rows !== undefined && acqs.length
    ? ad.totals.quantity : item.quantity;
  rows.push(detailZeile(t('detail.qty'), html`
    <button class="btn bs btn-sm" data-click="manQtyChange" data-arg="-1" aria-label="${tRaw('detail.qty_less')}" data-stil="font-size:var(--fs-4);padding:2px 8px;line-height:1">−</button>
    <input inputmode="numeric" type="number" id="man-det-qty" min="1" aria-label="${tRaw('detail.qty')}" value="${totalQty}" data-stil="width:4.5em;text-align:center;border:1px solid var(--feldrand);border-radius:6px;padding:2px;font-weight:600" data-change="manQtySave" />
    <button class="btn bs btn-sm" data-click="manQtyChange" data-arg="1" aria-label="${tRaw('detail.qty_more')}" data-stil="font-size:var(--fs-4);padding:2px 8px;line-height:1">+</button>
  `, { wertStil: 'display:flex;align-items:center;gap:6px' }));

  // BrickLink-Nr (minifigs only, editable)
  if (type === 'fig') {
    rows.push(detailZeile('BrickLink-Nr.', html`
      <input type="text" value="${item.bl_fig_number||''}" placeholder="${tRaw('figs.bl_placeholder')}" aria-label="${tRaw('figs.bl_number')}" data-stil="width:9em;max-width:100%;text-align:right;border:1px solid var(--feldrand);border-radius:6px;padding:2px 6px"
        data-blur="saveManualFigBl" data-arg="${id}" data-arg2="${item?.user_id || ''}" />
    `));
  }

  // Die Farbe eines Teils ist änderbar, für den Fall, dass sie falsch geladen wurde — gerade ein Teil ohne
  // Farbname braucht die Zeile. Dieselbe Liste wie beim Erfassen (loadBrickColors), nachgeladen nach dem
  // Zeichnen.
  // Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#if-2
  if (type === 'part') {
    const swatch = html`<span id="man-farb-punkt" data-stil="display:inline-block;width:12px;height:12px;border-radius:50%;border:1px solid rgba(0,0,0,.15);vertical-align:middle;flex:0 0 auto" data-farbe="${escHex(item.color_hex, 'var(--s300)')}"></span>`;
    rows.push(detailZeile(t('parts.color_label'), html`${swatch}
      <select id="man-farb-wahl" aria-label="${tRaw('parts.color_label')}" data-stil="max-width:150px;border:1px solid var(--feldrand);border-radius:6px;padding:2px 4px;font-size:var(--fs-2)"
        data-change="speichereTeilFarbe" data-part="${id}" data-color="${colorId}"
        data-owner="${item?.user_id ?? ''}">
        <option value="${colorId}">${item.color_name ? colorName(item.color_name) : tRaw('parts.no_color_dash')}</option>
      </select>`,
      { wertStil: 'display:flex;align-items:center;gap:6px;justify-content:flex-end' }));
  }

  // Lagerort auch im Detail der manuell erfassten Teile und Figuren: Dasselbe Bedienelement und derselbe
  // Speicherweg wie bei Teilen aus Sets, nur die Adresse hängt am Typ. Die Ortsliste gehört dem Besitzer.
  // Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#ladeortauswahl-2
  ladeOrtAuswahl(item?.user_id != null ? [item.user_id] : []).catch(() => {});
  rows.push(detailZeile(t('detail.storage'),
    lagerortBlock('man-storage', item?.storage,
      `data-change="speichereTeilLagerort" data-typ="${type === 'fig' ? 'fig' : 'part'}" ` +
      `data-part="${escJs(id)}" data-color="${colorId}" ` +
      `data-owners="${esc(item?.user_id ?? '')}"`),
    { wertStil: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end' }));

  // Acquisition summary — compact, like set-detail
  rows.push(detailZeile(t('detail.purchase_price'), html`
      ${ungeprueft(renderManAcqSummary(acqs, type, id, colorId))}
      <button class="btn bs btn-sm" data-click="openManAcqModal" data-stil="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>
    `, { zeilenStil: 'align-items:flex-start',
         wertId: 'man-acq-summary',
         wertStil: 'flex-direction:column;align-items:flex-end;gap:3px' }));

  // Preisverlauf wie im Set-Detail, beide Zustände in einem Diagramm, der Marktpreis je Zustand darüber. Bis
  // genug Punkte gesammelt sind, bleibt das Diagramm leer — das ist erwartet.
  // Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#preisverlauf-wie-im-set-detail-beide-zus
  rows.push(html`<div id="man-market-rows"></div>`);

  rows.push(html`<div data-stil="margin-top:10px">
    <div data-stil="font-size:var(--fs-1);font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin-bottom:4px">${tRaw('detail.price_history')}</div>
    <div id="man-chart-content"><span data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('common.loading')}</span></div>
  </div>`);

  return rows;
}

/** Preisverlauf und Marktpreise nachladen, ohne den Dialog aufzuhalten.
 * @param {string} type @param {string} id @param {number | string} colorId */
function ladeManPreisverlauf(type, id, colorId) {
  // Derselbe Renderer wie beim Set — die Endpunkte liefern dieselbe Diagrammstruktur
  // (src/finanzen/chartData.ts), also braucht es hier keine zweite Zeichenlogik.
  const histUrl = type === 'fig'
    ? `/v1/minifigs/${encodeURIComponent(id)}/price-history`
    : `/v1/parts/${encodeURIComponent(id)}/${colorId || 0}/price-history`;
  api('GET', histUrl).then(ph => {
    // Dieselbe Funktion wie im Set-Detail — die Endpunkte liefern dieselbe by_condition-Struktur, also
    // braucht es keine zweite Darstellungslogik.
    renderMarketRows(ph, 'man-market-rows');
    const el = G('man-chart-content');
    if (!el) return;
    setzeHtml(el, ph?.success ? priceChartSVG(ph, `man-${String(id).replace(/[^a-zA-Z0-9]/g, '')}-${colorId || 0}`, diagrammBreite(el)) : html`<span data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('detail.no_history')}</span>`);
  }).catch(() => {
    const el = G('man-chart-content');
    if (el) setzeHtml(el, html`<span data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('detail.no_history')}</span>`);
  });

}

/**
 * @param {string} type
 * @param {string} id
 * @param {string | number} colorId
 */
export async function openManDetail(type, id, colorId) {
  const ziel = /** @type {NonNullable<typeof _manItem>} */ ({ type, id, colorId: parseInt(String(colorId))||0 });
  _manItem = ziel;
  const modal = G('man-detail-modal');
  const bodyEl = G('man-detail-body');
  const imgEl  = G('man-detail-img');

  // Load item from cache
  const fromCache = () => type === 'fig'
    ? manuelleFiguren().find(f => f.fig_number === id)
    : manuelleTeile().find(p => p.part_number === id && (p.color_id||0) === ziel.colorId);

  let item = fromCache();
  // Die Caches füllen die Reiter Teile und Minifiguren. Aus der Finanztabelle heraus ist der passende Reiter
  // oft nie geöffnet worden — dann war der Eintrag nicht im Cache und der Dialog ging stillschweigend GAR
  // NICHT auf. Also einmal nachladen und erneut suchen.
  if (!item) {
    if (type === 'fig') await loadManualFigsTable().catch(() => {});
    else                await loadManualParts().catch(() => {});
    item = fromCache();
  }
  // Besitzer der KARTE merken. Im Haushalt zeigt der manuelle Bereich die Eintraege aller Konten; ohne diese
  // Angabe schrieb der Server in die Zeile des Aufrufers. NACHGEMESSEN: Das Hauptkonto setzte auf der Karte
  // des Kindes die Menge auf 99 — geaendert wurde die eigene (vorher 5|9, nachher 99|9), und die Antwort
  // sagte „success".
  ziel.owner = item?.user_id ?? undefined;
  if (!item) return;

  G('man-detail-tit').textContent = String(item.fig_name || item.part_name || id);
  G('man-detail-sub').textContent = id + (item.color_name ? ' · ' + colorName(String(item.color_name)) : '');

  // Volle Auflösung über den Server-Proxy, nicht direkt vom CDN: Fremde Bildadressen lädt der Browser nie
  // selbst (Hotlink-Schutz, Cache).
  // Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#rawimgsrc
  const rawImgSrc = item.image_local || item.image_url || '';
  const imgSrc = rawImgSrc ? imgUrl(fullUrl(rawImgSrc), false) : '';
  if (imgSrc) { imgEl.src = imgSrc; imgEl.style.display = ''; } else { imgEl.style.display = 'none'; }

  // Load acquisitions
  const acqUrl = type === 'fig'
    ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
    : `/v1/parts/${encodeURIComponent(id)}/${parseInt(String(colorId))||0}/acquisitions`;
  const ad = await api('GET', acqUrl).catch(()=>null);
  const acqs = ad?.acquisitions || [];

  setzeHtml(bodyEl, ungeprueft(manDetailZeilen(type, id, ziel.colorId, item, acqs, ad).join('')));
  modal.classList.add('open');

  // Farbauswahl nachfüllen — siehe die Begründung an der Zeile oben.
  if (type === 'part') fuelleFarbwahl(ziel.colorId).catch(() => {});

  ladeManPreisverlauf(type, id, colorId);

  // Wire delete button — deleteManualFig/deleteManualPart already have their own confirmDelete
  G('man-detail-del').onclick = async () => {
    const mi = /** @type {NonNullable<typeof _manItem>} */ (_manItem);
    if (type === 'fig') {
      const ok = await deleteManualFig(id);
      if (ok !== false) closeManDetail();
    } else {
      const ok = await deleteManualPart(id, mi.colorId);
      if (ok !== false) closeManDetail();
    }
  };

}

/**
 * Die Farbliste getrennt vom Zeichnen füllen: Der erste Abruf geht zu Rebrickable, der Dialog steht derweil
 * offen. Scheitert er, bleibt die aktuelle Farbe als einzige Wahl — besser als eine Liste ohne sie.
 * Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#fuellefarbwahl
 * @param {number} aktuell
 */
async function fuelleFarbwahl(aktuell) {
  const sel = G('man-farb-wahl');
  if (!sel) return;
  const farben = await loadBrickColors();
  if (!farben?.length || !G('man-farb-wahl')) return;
  // data-name bleibt der englische Rebrickable-Name — er reist als color_name mit und wird für
  // BrickLink-Abgleiche gebraucht. Übersetzt wird nur der sichtbare Text, mit derselben Funktion wie im
  // Teile-Reiter (renderColorDropdown in 06-minifigs.js).
  setzeHtml(sel, farben.map(c =>
    html`${html`<option value="${c.id}" data-name="${(c.name || '').replace(/"/g, '&quot;')}" `}${html`data-hex="${hexZiffern(c.hex)}"${Number(c.id) === Number(aktuell) ? ' selected' : ''}>`}${html`${colorName(c.name)}</option>`}`));
  // Kennt die Liste die heutige Farbe nicht (ältere Bestände, eine Farbe, die Rebrickable zurückgezogen hat),
  // wäre sie nach dem Ersetzen verschwunden und die Auswahl stünde auf einer FREMDEN Farbe — ohne dass jemand
  // etwas geändert hätte. Dann kommt sie vorne wieder dazu.
  if (!farben.some(c => Number(c.id) === Number(aktuell))) {
    fuegeHtmlEin(sel, 'afterbegin', html`<option value="${Number(aktuell) || 0}" selected>${String(aktuell)}</option>`);
  }
}

/**
 * Die Farbe eines manuellen Teils ändern (die Regeln stehen in src/teile/teilFarbeAendern.ts). Danach öffnet
 * der Dialog mit der neuen Farbe: Sie ist Teil der Adresse, der alte Dialog zeigte ins Leere.
 * Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#speichereteilfarbe
 * @this {unknown}
 */
async function speichereTeilFarbe() {
  const el = this instanceof HTMLSelectElement ? this : /** @type {HTMLSelectElement | null} */ (document.querySelector('#man-farb-wahl'));
  if (!el) return;
  const nummer = el.dataset.part ?? '';
  const alt    = parseInt(el.dataset.color ?? '') || 0;
  const neu    = parseInt(el.value);
  if (!Number.isFinite(neu) || neu === alt) return;
  const wahl   = el.options[el.selectedIndex];
  const owner  = el.dataset.owner;
  const d = await api('PUT',
    `/v1/parts/${encodeURIComponent(nummer)}/${alt}/color${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`,
    { color_id: neu, color_name: wahl?.dataset.name || null, color_hex: wahl?.dataset.hex || null });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  // `bild` sagt, woher das Bild der neuen Farbe kommt (src/teile/teilFarbeAendern.ts).
  // null heisst: keines gefunden — dann steht nach dem Neuöffnen der Platzhalter da, und genau das war Marcos
  // Befund. Die Meldung sagt es, statt ihn ein zweites Mal vor einem leeren Platz stehen zu lassen.
  if (d.bild === null) toast(tRaw('parts.color.saved_no_image'), 'info');
  else                 toast(tRaw('settings.saved'), 'success');
  await loadManualParts().catch(() => {});
  if (aktiverReiter() === 'finance') loadFinance();
  await openManDetail('part', nummer, neu);
}

function closeManDetail() {
  G('man-detail-modal').classList.remove('open');
  _manItem = null;
}
G('man-detail-modal').addEventListener('click', e => e.target === e.currentTarget && closeManDetail());

/**
 * @param {string} delta
 */
function manQtyChange(delta) {
  const inp = G('man-det-qty');
  if (!inp) return;
  // parseInt auf delta: Seit der Umstellung auf data-arg kommt der Wert als Zeichenkette ("1"/"-1"). Ohne
  // Umwandlung wäre 1 + "1" die Zeichenkette "11" — aus einer 1 wurde beim Klick auf + eine 11.
  inp.value = String(Math.max(1, parseInt(inp.value || '1') + (parseInt(delta) || 0)));
  manQtySave();
}

async function manQtySave() {
  const inp = G('man-det-qty');
  if (!inp || !_manItem) return;
  const { type, id, colorId, owner } = _manItem;
  const qty = parseInt(inp.value)||1;
  if (type === 'fig') {
    await updateManualFig(id, { quantity: qty }, owner);
  } else {
    await updateManualPart(id, colorId, { quantity: qty }, owner);
  }

  // Die Erfassungsliste nach jeder Mengenänderung neu laden, in beide Richtungen: Beim Verringern entfernt
  // der Server Erfassungen (LIFO), und nur beim Erhöhen neu zu laden zeigte gelöschte Einträge weiter an.
  // Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#acqurl2
  const acqUrl2 = type==='fig'
    ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
    : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions`;
  api('GET', acqUrl2).then(ad2 => {
    const acqs2 = ad2?.acquisitions || [];
    const sumEl = G('man-acq-summary');
    if (sumEl) setzeHtml(sumEl, html`${ungeprueft(renderManAcqSummary(acqs2, type, id, colorId))}${html`<button class="btn bs btn-sm" data-click="openManAcqModal" data-stil="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>`}`);
    if (G('acq-modal').classList.contains('open')) renderManAcqBody(type, id, colorId, acqs2, ad2?.totals);
  }).catch(()=>{});

  // Refresh tile cache
  if (type==='fig') loadManualFigsTable();
  else loadManualParts();
}

// Opens the shared acq-modal for manual parts/minifigs
function openManAcqModal() {
  if (!_manItem) return;
  const { type, id, colorId } = _manItem;
  const title = type === 'fig'
    ? (manuelleFiguren().find(f=>f.fig_number===id)?.fig_name || id)
    : (manuelleTeile().find(p=>p.part_number===id)?.part_name || id);
  G('acq-modal-tit').textContent = tRaw('detail.edit_prices');
  G('acq-modal-sub').textContent = title;
  setzeHtml(G('acq-modal-body'), html`<div data-stil="color:var(--mut);font-size:var(--fs-2)">${tRaw('common.loading')}</div>`);
  G('man-detail-modal').classList.remove('open');
  _gespeichert.clear();
  G('acq-modal').classList.add('open');
  // Override close to return to man-detail-modal
  _acqModalSn = null;
  _acqManItem = _manItem;
  loadManAcqModal(type, id, colorId);
}

/** @type {{ type: string, id: string, colorId: number, owner?: number } | null} */
let _acqManItem = null;

function closeAcqModal() {
  G('acq-modal').classList.remove('open');
  if (_acqManItem) {
    // Return to man-detail-modal
    const mi = _acqManItem;
    _acqManItem = null;
    if (mi.type === 'fig') loadManualFigsTable();
    else loadManualParts();
    openManDetail(mi.type, mi.id, mi.colorId);
  } else if (_acqModalSn) {
    const sn = _acqModalSn;
    G('set-modal').classList.add('open');
    api('GET', `/v1/sets/${sn}/acquisitions`).then(ad => {
      if (!ad?.success) return;
      const sumEl = G('m-acq-summary');
      if (sumEl) setzeHtml(sumEl, html`${ungeprueft(renderAcquisitionSummary(ad.acquisitions, sn))}${html`<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${sn}" data-stil="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>`}`);
      const total = ad.totals?.quantity ?? 0;
      const qEl = G('m-qty');
      if (qEl && total > 0) { qEl.value = String(total); if(curSet) curSet.quantity = total; }
    }).catch(()=>{});
  }
}

/**
 * @param {string} type
 * @param {string} id
 * @param {number} colorId
 */
async function loadManAcqModal(type, id, colorId) {
  const url = type === 'fig'
    ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
    : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions`;
  const ad = await api('GET', url).catch(()=>null);
  // Wie im Set-Dialog: Ohne Mitgliederliste und ohne owner_user_id wüsste die Eigentümer-Auswahl nicht,
  // worauf sie steht.
  if (!_householdMembers.length) {
    const hm = await api('GET', '/v1/sets/household-members').catch(() => null);
    _householdMembers = hm?.members || [];
  }
  _acqOwnerId = ad?.owner_user_id ?? ME?.id ?? null;
  renderManAcqBody(type, id, colorId, ad?.acquisitions || [], ad?.totals);
}

/**
 * @param {string} type
 * @param {string} id
 * @param {number} colorId
 * @param {Erfassung[]} acqs
 * @param {Erfassungssumme | undefined} totals
 */
function renderManAcqBody(type, id, colorId, acqs, totals) {
  // Reuse the same table renderer with type-specific save/delete
  if (!acqs.length) {
    setzeHtml(G('acq-modal-body'), html`<div data-stil="color:var(--mut);font-size:var(--fs-3);padding:.5rem 0">—</div>`);
    return;
  }
  let markup = html`<div class="tw"><table class="dt acq-tabelle">
    <thead><tr>
      <th>${tRaw('detail.qty')}</th><th>${tRaw('detail.added')}</th>
      <th>${tRaw('common.condition')}</th>
      <th class="zahl">${tRaw('figs.price_label')}</th>
      ${_householdMembers.length > 1 ? html`<th>${tRaw('household.owner')}</th>` : ''}
      <th><span class="vh">${tRaw('common.actions')}</span></th>
    </tr></thead><tbody>`;

  acqs.forEach(a => {
    const dateIso = isoTag(a.created_at);
    const t_ = type, i_ = id, c_ = colorId, ai_ = a.id;
    const args = `data-arg="${esc(t_)}" data-arg2="${esc(i_)}" data-arg3="${esc(c_)}" data-arg4="${ai_}"`;
    markup = html`${markup}${html`<tr id="acq-row-${ai_}">
      <td>
        <input class="acq-feld acq-menge" inputmode="numeric" type="number" min="1" value="${a.quantity}" aria-label="${tRaw('detail.qty')}"
          data-blur="manAcqSave" ${ungeprueft(args)} data-arg5="qty" data-val="1"
          data-keydown="blurOnEnter" />
      </td>
      <td>${datumFeld(`data-change="manAcqSave" ${args} data-arg5="date" data-val="1"`, dateIso, `acq-datum-${ai_}`)}</td>
      <td>
        <select class="acq-feld" aria-label="${tRaw('common.condition')}" data-change="manAcqSave" ${ungeprueft(args)} data-arg5="cond" data-val="1">
          <option value="N" ${a.condition!=='U' ? 'selected' : ''}>${tRaw('common.condition_new')}</option>
          <option value="U" ${a.condition==='U' ? 'selected' : ''}>${tRaw('common.condition_used')}</option>
        </select>
      </td>
      <td class="zahl">
        <input class="acq-feld acq-preis" id="acq-preis-${ai_}" type="text" inputmode="decimal" autocomplete="off" value="${betragFuerFeld(a.unit_price)}" aria-label="${tRaw('detail.purchase_price')}"
          data-blur="manAcqSave" ${ungeprueft(args)} data-arg5="price" data-val="1"
          data-keydown="blurOnEnter" />
      </td>
      ${_householdMembers.length > 1 ? html`<td>
        <select class="acq-feld" aria-label="${tRaw('household.owner')}" data-change="manAcqSave" ${ungeprueft(args)} data-arg5="owner" data-val="1">
          ${_householdMembers.map(m => html`<option value="${m.id}"${m.id === (a.owner_user_id ?? _acqOwnerId) ? ' selected' : ''}>${m.username}</option>`)}
        </select>
      </td>` : ''}
      <td class="acq-aktion">
        ${gespeichertMarke(ai_)}
        <button class="acq-loeschen" data-click="manAcqDelete"${echt()} ${ungeprueft(args)}
          title="${tRaw('gallery.delete.title')}" aria-label="${tRaw('gallery.delete.title')}">${ico('loeschen')}</button>
      </td>
    </tr>`}`;
  });

  markup = html`${markup}${html`</tbody></table></div>`}`;
  markup = html`${markup}${acqSummary(totals)}`;
  setzeMitFokus(G('acq-modal-body'), markup);
}

/**
 * @param {string} type
 * @param {string} id
 * @param {number} colorId
 * @param {string} acqId
 * @param {string} field
 * @param {string} value
 */
async function manAcqSave(type, id, colorId, acqId, field, value) {
  try {
    const url = type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions/${acqId}`
      : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions/${acqId}`;
    /** @type {{ unit_price?: number | null, quantity?: number, date?: string, condition?: string, owner_user_id?: number }} */
    const body = {};
    if (field==='price') {
      const preis = betragAusFeld(`acq-preis-${acqId}`);
      if (!preis.ok) return;
      body.unit_price = preis.wert;
    }
    else if (field==='qty') body.quantity = Math.max(1,parseInt(value)||1);
    else if (field==='date') body.date = value;
    else if (field==='owner') {
      // Eigentümerwechsel = Verschieben genau dieser Kaufpreis-Zeile. Ein manuell erfasstes Teil hat keinen
      // Inhalt — es wandern nur Menge und Erfassung (src/sets/setMove.ts, moveManualAcquisition). KEIN
      // from_user_id: Den Absender ermittelt der Server aus der Zeile selbst (acquisitionMoveSource) — hier
      // stand der Betrachter, siehe acqSave().
      body.owner_user_id = parseInt(value);
    }
    else body.condition = value;
    const d = await api('PUT', url, body);
    if (!d?.success) {
      toast((d?.error)||t('settings.error'),'error');
      if (field==='date' || field==='owner') await loadManAcqModal(type, id, colorId);
      return;
    }
    zeigeGespeichert(acqId);
    if (field==='owner') {
      // Danach stimmt fast nichts mehr auf dem Schirm: Mengen, Summen, Besitzer-Plaketten. Lieber neu laden
      // als vier Stellen nachziehen.
      toast(tRaw('household.owner_moved', { parts: 0, figs: 0 }), 'success');
      closeAcqModal(); closeManDetail();
      if (type==='fig') loadManualFigsTable(); else loadManualParts();
      return;
    }
    // Reload modal for price (to show fetched market price), qty (new row possible) or date (Reihenfolge)
    if ((field==='price' && (value===''||value===null)) || field==='qty' || field==='date') {
      await loadManAcqModal(type, id, colorId);
    }
    // Always refresh tile to reflect updated badge/price
    if (type==='fig') loadManualFigsTable();
    else loadManualParts();
  } catch(e) { console.error('[manAcqSave]', e); toast(tRaw('settings.error'),'error'); }
  // Marktpreis-Zeilen nachladen: Wird erstmals ein Kaufpreis in einem Zustand erfasst, entsteht dafür eine
  // neue Zeile.
  const mi = _manItem;
  if (mi) {
    const u = mi.type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(mi.id)}/price-history`
      : `/v1/parts/${encodeURIComponent(mi.id)}/${mi.colorId || 0}/price-history`;
    api('GET', u).then(ph => renderMarketRows(ph, 'man-market-rows')).catch(()=>{});
  }
}

/**
 * @param {string} type
 * @param {string} id
 * @param {number} colorId
 * @param {string} acqId
 */
async function manAcqDelete(type, id, colorId, acqId) {
  if (!await confirmDelete(tRaw('acq.delete_title'), t('acq.delete_text'), 'loeschen')) return;
  const delUrl = type === 'fig'
    ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions/${acqId}`
    : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions/${acqId}`;
  const listUrl = type === 'fig'
    ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
    : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions`;
  const d = await api('DELETE', delUrl);
  if (!d.success) { toast(tRaw('settings.error'),'error'); return; }
  // Update qty input in man-detail-modal
  const qEl = G('man-det-qty');
  if (qEl && d.new_quantity !== undefined) qEl.value = d.new_quantity;
  const ad = await api('GET', listUrl).catch(()=>null);
  const acqs = ad?.acquisitions || [];
  // Refresh inline summary in detail modal
  const sumEl = G('man-acq-summary');
  if (sumEl) setzeHtml(sumEl, html`${ungeprueft(renderManAcqSummary(acqs, type, id, colorId))}${html`<button class="btn bs btn-sm" data-click="openManAcqModal" data-stil="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>`}`);
  if (!acqs.length) { closeAcqModal(); return; }
  renderManAcqBody(type, id, colorId, acqs, ad?.totals);
  if (type==='fig') loadManualFigsTable();
  else loadManualParts();
}

// Open modal: show price history sparkline



// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
// Die elf Handler dieser beiden Fenster meldete früher js/07-admin.js an — obwohl sie hier umgesetzt werden.

registerActions({
  acqDelete,
  acqSave,
  closeAcqModal,
  closeManDetail,
  manAcqDelete,
  manAcqSave,
  manQtyChange,
  manQtySave,
  openAcqModal,
  openManAcqModal,
  openManDetail,
  speichereTeilFarbe,
});
