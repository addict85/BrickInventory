// ═══ Kaufpreis-Modal und Detailfenster für manuelle Einträge ════════════════
//
// ── Warum eigene Datei (Nachtrag 130) ────────────────────────────────────────
//
// Diese 708 Zeilen standen in js/07-admin.js, deren Kopfzeile als Inhalt
// „Confirm-Dialog, Config-Export/Import, API-Tokens, Job-Status" nennt. Keines
// der beiden Fenster hier ist Administration: Das eine erfasst Kaufpreise zu
// einem Set, das andere zeigt Details zu manuell erfassten Teilen und
// Minifiguren. Sie lagen dort, weil 07-admin.js über die Zeit die Datei war, in
// die Neues fiel — 1492 Zeilen, benannt nach ihrer Geschichte.
//
// Die Schnittstelle ist schmal und war es schon vorher: Drei Helfer kommen aus
// 07-admin.js herüber (confirmDelete, renderMarketRows, priceChartSVG), und
// hinaus geht renderAcquisitionSummary. Genau das machte den Schnitt möglich,
// ohne irgendetwas umzubauen.
import { registerActions } from './00-registry.js';
import { locale, t, tRaw } from '../i18n.js';
import { CURRENCY, G, ME, api, esc, escJs, fmtN, fullUrl, imgUrl, toast } from './01-core.js';
import { allSets, applySetAggregate, closeModal, curSet, loadGallery, pnlBadge, updateGalleryPrices } from './02-gallery.js';
import { loadFinance } from './04-finance.js';
import { deleteManualFig, deleteManualPart, loadManualFigsTable, loadManualParts, manualFigsCache, manualPartsCache, updateManualFig, updateManualPart } from './06-minifigs.js';
import { confirmDelete, priceChartSVG, renderMarketRows } from './07-admin.js';
import { blurOnEnter, mQtyDec, mQtyInc, saveManualFigBl } from './11-actions.js';

// ── KAUFPREIS-MODAL ─────────────────────────────────────────────────────────
let _acqModalSn = null;

export function openAcqModal(sn) {
  _acqModalSn = sn;
  // Header
  G('acq-modal-tit').textContent = tRaw('detail.purchase_price');
  G('acq-modal-sub').textContent = sn + (curSet?.name ? ' – ' + curSet.name : '');
  G('acq-modal-body').innerHTML = `<div style="color:var(--mut);font-size:.82rem">${t('common.loading')}</div>`;
  G('set-modal').classList.remove('open');
  G('acq-modal').classList.add('open');
  loadAcqModal(sn);
}

// HINWEIS: Hier stand eine ZWEITE, kürzere Fassung von closeAcqModal().
// Als klassisches Skript war die doppelte Deklaration erlaubt — die spätere
// (weiter unten, mit der vollständigen Rückkehr-Logik für _acqManItem UND
// _acqModalSn) hat sie stillschweigend überschrieben. Die kurze Fassung war
// also seit jeher toter Code und ist entfernt; im ES-Modul wäre sie ohnehin
// ein harter Fehler ("Duplicate top-level function declarations").
G('acq-modal').addEventListener('click', e => e.target.id === 'acq-modal' && closeAcqModal());

/**
 * Wessen Kaufpreise gerade im Dialog stehen.
 *
 * Die Erfassungen kommen für das BLICKFELD; im Haushalt können sie mehreren
 * Konten gehören. Der Server liefert `owner_user_id` je Zeile mit, sobald es
 * mehr als ein Konto gibt — ohne das wüsste die Auswahl nicht, worauf sie
 * steht, und ein Wechsel griffe die falsche Zeile ab.
 */
let _acqOwnerId = null;
let _householdMembers = [];

/**
 * Summenzeile unter einer Erfassungsliste.
 *
 * Die Zahlen kommen fertig vom Server (`totals`); hier wird nur gezeichnet.
 * `amount === null` heisst „kein Kaufpreis erfasst" — das ist etwas anderes
 * als ein Betrag von null, und deshalb entscheidet der Server das und nicht
 * diese Funktion.
 *
 * @param {{quantity:number, amount:number|null}|null|undefined} totals
 */
function acqSummary(totals) {
  const menge  = totals?.quantity ?? 0;
  const betrag = totals?.amount;
  return `<div id="acq-summary" style="display:flex;justify-content:space-between;padding:.75rem .5rem 0;border-top:2px solid var(--bdr);margin-top:.25rem">
    <span style="font-size:.82rem;color:var(--mut)">${t('detail.qty')}: <strong id="acq-total-qty">${menge}</strong></span>
    <span id="acq-total-price" style="font-weight:700;color:var(--b600)">${betrag != null ? fmtN(betrag, CURRENCY) : '—'}</span>
  </div>`;
}

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

export function renderAcqModalBody(sn, acqs, totals) {
  if (!acqs.length) {
    G('acq-modal-body').innerHTML = `<div style="color:var(--mut);font-size:.85rem;padding:.5rem 0">—</div>`;
    return;
  }
  const th = s => `<th style="padding:6px 8px;font-weight:600;color:var(--mut);font-size:.75rem;text-transform:uppercase;letter-spacing:.4px">${s}</th>`;
  let html = `<div class="tw"><table class="dt" style="width:100%;border-collapse:collapse;font-size:.875rem">
    <thead>
      <tr style="border-bottom:2px solid var(--bdr)">
        ${th(t('detail.qty'))}
        ${th(t('detail.added'))}
        <th style="padding:6px 8px;font-weight:600;color:var(--mut);font-size:.75rem;text-transform:uppercase;letter-spacing:.4px;text-align:center">${t('common.condition')}</th>
        <th style="padding:6px 8px;font-weight:600;color:var(--mut);font-size:.75rem;text-transform:uppercase;letter-spacing:.4px;text-align:right">${t('detail.purchase_price')}</th>
        ${_householdMembers.length > 1 ? th(t('household.owner')) : ''}
        <th style="width:32px"></th>
      </tr>
    </thead>
    <tbody>`;

  acqs.forEach(a => {
    const _dt = a.created_at ? new Date(a.created_at) : null;
    const dateIso = _dt ? `${_dt.getFullYear()}-${String(_dt.getMonth()+1).padStart(2,'0')}-${String(_dt.getDate()).padStart(2,'0')}` : '';
    const priceVal = a.purchase_price != null ? parseFloat(a.purchase_price) : '';
    html += `<tr style="border-bottom:1px solid var(--bdr)" id="acq-row-${a.id}">
      <td style="padding:6px 6px">
        <input type="number" min="1" value="${a.quantity}"
          data-blur="acqSave" data-arg="${esc(sn)}" data-arg2="${a.id}" data-arg3="qty" data-val="1"
          data-keydown="blurOnEnter"
          style="width:48px;text-align:center;border:1px solid var(--bdr);border-radius:6px;padding:4px 6px;font-size:.875rem;font-weight:700;background:var(--sur);color:var(--txt)" />
      </td>
      <td style="padding:6px 8px;white-space:nowrap">
        <input type="date" value="${dateIso}"
          data-change="acqSave" data-arg="${esc(sn)}" data-arg2="${a.id}" data-arg3="date" data-val="1"
          style="border:1px solid var(--bdr);border-radius:6px;padding:3px 6px;font-size:.82rem;background:var(--sur);color:var(--txt)" />
      </td>
      <td style="padding:6px 4px;text-align:center">
        <select data-change="acqSave" data-arg="${esc(sn)}" data-arg2="${a.id}" data-arg3="cond" data-val="1"
          style="font-size:.82rem;border:1px solid var(--bdr);border-radius:6px;padding:3px 6px;background:var(--sur);color:var(--txt)">
          <option value="N" ${a.condition!=='U'?'selected':''}>${t('common.condition_new')}</option>
          <option value="U" ${a.condition==='U'?'selected':''}>${t('common.condition_used')}</option>
        </select>
      </td>
      <td style="padding:6px 8px;text-align:right">
        <input type="text" inputmode="decimal" value="${priceVal}"
          data-blur="acqSave" data-arg="${esc(sn)}" data-arg2="${a.id}" data-arg3="price" data-val="1"
          data-keydown="blurOnEnter"
          style="width:84px;text-align:right;border:1px solid var(--bdr);border-radius:6px;padding:4px 8px;font-size:.875rem;font-weight:600;background:var(--sur);color:var(--txt)" />
      </td>
      ${_householdMembers.length > 1 ? `<td style="padding:6px 4px">
        <select data-change="acqSave" data-arg="${esc(sn)}" data-arg2="${a.id}" data-arg3="owner" data-val="1"
          style="font-size:.82rem;border:1px solid var(--bdr);border-radius:6px;padding:3px 6px;background:var(--sur);color:var(--txt)">
          ${_householdMembers.map(m => `<option value="${m.id}"${m.id === (a.owner_user_id ?? _acqOwnerId) ? ' selected' : ''}>${esc(m.username)}</option>`).join('')}
        </select>
      </td>` : ''}
      <td style="padding:6px 4px;text-align:center">
        <button data-click="acqDelete" data-arg="${esc(sn)}" data-arg2="${a.id}"
          style="background:none;border:none;cursor:pointer;font-size:1rem;color:var(--r500);padding:2px 4px;border-radius:4px;line-height:1"
          title="${t('gallery.delete.title')}">🗑️</button>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;

  // Summenzeile: Der Server rechnet sie (acquisitionTotals in
  // utils/acquisitions.ts) und liefert sie als `totals` mit. Vorher stand die
  // Rechnung hier und noch dreimal woanders — zweimal in dieser Datei, zweimal
  // in der App, und mit verschiedenen Preisfeldern.
  html += acqSummary(totals);

  G('acq-modal-body').innerHTML = html;
}

async function acqSave(sn, id, field, value) {
  const body = {};
  if (field === 'price') {
    body.purchase_price = value === '' ? null : parseFloat(value);
  } else if (field === 'qty') {
    body.quantity = Math.max(1, parseInt(value) || 1);
  } else if (field === 'date') {
    body.date = value;
  } else if (field === 'owner') {
    // Eigentümerwechsel = Verschieben genau dieser einen Kaufpreis-Zeile.
    // KEIN from_user_id: Den Absender ermittelt der Server aus der Zeile
    // selbst (acquisitionMoveSource). Hier stand der BETRACHTER — für die
    // Zeile eines Unterkontos suchte der Server sie damit unter dem falschen
    // Konto und antwortete 404, obwohl das Select den richtigen Eigentümer
    // längst anzeigte.
    body.owner_user_id = parseInt(value);
  } else {
    body.condition = value;
  }
  const d = await api('PUT', `/v1/sets/${sn}/acquisitions/${id}`, body);
  if (field === 'owner') {
    if (!d.success) { toast(d.error || t('settings.error'), 'error'); loadAcqModal(sn); return; }
    // Nach einem Wechsel stimmt fast alles auf dem Schirm nicht mehr: Mengen,
    // Summen, Besitzer-Plaketten. Lieber neu laden als vier Stellen einzeln
    // nachziehen.
    toast(tRaw(d.source_emptied ? 'household.move_ok' : 'household.owner_moved',
      { parts: d.parts ?? 0, figs: d.minifigs ?? 0 }), 'success');
    // restore: Ohne das landet der Nutzer nach dem Wechsel wieder bei Seite 1
    // (Nachtrag 34) — Position und geladene Tiefe bleiben erhalten.
    closeAcqModal(); closeModal(); loadGallery({ restore: true });
    return;
  }
  // Der Server liefert das neu berechnete Zustands-Aggregat mit — direkt in die
  // Galerie-Liste schreiben, damit die Kachel ohne Neuladen stimmt.
  applySetAggregate(d.set);
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    if (field === 'date') loadAcqModal(sn); // abgelehnte Eingabe auf gespeicherten Wert zurücksetzen
    return;
  }
  // Marktpreis-Zeilen neu holen.
  //
  // Wird erstmals ein Kaufpreis in einem Zustand erfasst, entsteht dafür eine
  // NEUE Zeile (der Server liefert by_condition nur für Zustände mit
  // Erfassung). Ohne dieses Nachladen erschiene sie erst beim nächsten Öffnen
  // des Dialogs.
  api('GET', `/v1/sets/${sn}/price-history`).then(renderMarketRows).catch(()=>{});

  // Kennzahlen, Galerie und Finanzen mitziehen.
  //
  // Vorher aktualisierte diese Funktion nur die beiden Dialoge. Kaufpreis und
  // Menge einer Erfassung wirken aber auf die Galerie-Kachel (Preis-Badge) und
  // auf die Finanzauswertung — beide blieben auf dem alten Stand, bis der Reiter
  // neu geladen wurde. Dieselbe Ursache wie bei manQtySave() und in der
  // Android-App bei updateAcquisition().
  // restore wie beim Eigentümerwechsel: Auch ein Preis- oder Mengenwechsel im
  // Dialog darf die gescrollte Tiefe nicht kosten (Nachtrag 34).
  loadGallery({ restore: true });
  loadFinance();

  // Datum geändert → Reihenfolge/Summary neu laden
  if (field === 'date') {
    loadAcqModal(sn);
    api('GET', `/v1/sets/${sn}/acquisitions`).then(ad => {
      if (ad?.success && curSet?.set_number === sn) {
        const summaryEl = G('m-acq-summary');
        if (summaryEl) summaryEl.innerHTML = renderAcquisitionSummary(ad.acquisitions, sn) +
          `<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${escJs(sn)}" style="margin-top:4px;font-size:.75rem;padding:2px 10px">✏️ ${t('detail.edit_prices')}</button>`;
      }
    }).catch(()=>{});
    return;
  }
  // If price was empty → server fetched market price; reload to show real value
  if (field === 'price' && (value === '' || value === null)) {
    loadAcqModal(sn);
    return;
  }
  // Zusammenfassung im Detail-Dialog nachziehen. Das Zustands-Aggregat kommt
  // inzwischen aus der PUT-Antwort (applySetAggregate oben) — hier wird nur
  // noch die Erfassungsliste neu gerendert.
  if (field === 'cond') {
    api('GET', `/v1/sets/${sn}/acquisitions`).then(ad => {
      if (!ad?.success) return;
      const sumEl = G('m-acq-summary');
      if (sumEl) sumEl.innerHTML = renderAcquisitionSummary(ad.acquisitions, sn) +
        `<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${escJs(sn)}" style="margin-top:4px;font-size:.75rem;padding:2px 10px">✏️ ${t('detail.edit_prices')}</button>`;
    }).catch(()=>{});
  }
  // If qty changed → reload whole modal to update summary + refresh set-detail qty
  if (field === 'qty') {
    loadAcqModal(sn);
    // Also refresh the set detail modal summary
    api('GET', `/v1/sets/${sn}/acquisitions`).then(ad => {
      if (ad.success && curSet?.set_number === sn) {
        const summaryEl = G('m-acq-summary');
        if (summaryEl) summaryEl.innerHTML = renderAcquisitionSummary(ad.acquisitions, sn) +
          `<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${escJs(sn)}" style="margin-top:4px;font-size:.75rem;padding:2px 10px">✏️ ${t('detail.edit_prices')}</button>`;
      }
    }).catch(()=>{});
    return;
  }
}

async function acqDelete(sn, id) {
  if (!await confirmDelete(tRaw('acq.delete_title'), t('acq.delete_text'), '🗑️')) return;
  const d = await api('DELETE', `/v1/sets/${sn}/acquisitions/${id}`);
  if (!d.success) { toast(tRaw('settings.error'), 'error'); return; }
  // Update curSet + qty input in set-detail modal
  if (curSet?.set_number === sn) {
    curSet.quantity = d.new_quantity;
    const qEl = G('m-qty');
    if (qEl) qEl.value = d.new_quantity;
  }
  // Reload acq modal
  const ad = await api('GET', `/v1/sets/${sn}/acquisitions`).catch(()=>null);
  if (!ad?.acquisitions?.length) { closeAcqModal(); return; }
  renderAcqModalBody(sn, ad.acquisitions, ad.totals);
  // Refresh compact summary in set-detail modal
  const dvEl = G('m-acq-summary');
  if (dvEl) dvEl.innerHTML = renderAcquisitionSummary(ad.acquisitions, sn) +
    `<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${escJs(sn)}" style="margin-top:4px;font-size:.75rem;padding:2px 10px">✏️ ${t('detail.edit_prices')}</button>`;
  // Wie in acqSave(): Eine gelöschte Erfassung verändert Bestand und Wert —
  // und lässt eine Zustands-Zeile verschwinden, wenn es die letzte war.
  api('GET', `/v1/sets/${sn}/price-history`).then(renderMarketRows).catch(()=>{});
  loadGallery({ restore: true });
  loadFinance();
}

// Compact link shown in set-detail-modal → opens the full acq-modal
export function renderAcquisitionSummary(acqs, sn) {
  if (!acqs?.length) return `<div style="color:var(--mut);font-size:.82rem">—</div>`;
  return acqs.map(a => {
    const cond = a.condition === 'U' ? `<span style="font-size:.7rem;padding:1px 5px;background:var(--s100);color:var(--s600);border-radius:8px;font-weight:600">${t('common.condition_used')}</span>`
      : `<span style="font-size:.7rem;padding:1px 5px;background:var(--g100);color:var(--g600);border-radius:8px;font-weight:600">${t('common.condition_new')}</span>`;
    const price = a.purchase_price != null ? `<strong>${fmtN(a.purchase_price, CURRENCY)}</strong>` : '';
    const dateFmt = a.created_at ? new Date(a.created_at).toLocaleDateString(locale()) : '';
    return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0">
      <span style="color:var(--mut);font-size:.78rem;min-width:24px">×${a.quantity}</span>
      ${cond}
      ${price}
      ${dateFmt ? `<span style="font-size:.72rem;color:var(--mut)">${dateFmt}</span>` : ''}
    </div>`;
  }).join('');
}

// ── MANUAL ITEM DETAIL MODAL (Teile + Minifiguren) ─────────────────────────
let _manItem = null; // { type:'part'|'fig', id:'partNumber|colorId' or 'figNumber', colorId:int }

// Compact acquisition summary for parts/minifigs (uses unit_price, not purchase_price)
function renderManAcqSummary(acqs, type, id, colorId) {
  if (!acqs?.length) return `<div style="color:var(--mut);font-size:.82rem">—</div>`;
  return acqs.map(a => {
    const cond = a.condition === 'U'
      ? `<span style="font-size:.7rem;padding:1px 5px;background:var(--s100);color:var(--s600);border-radius:8px;font-weight:600">${t('common.condition_used')}</span>`
      : `<span style="font-size:.7rem;padding:1px 5px;background:var(--g100);color:var(--g600);border-radius:8px;font-weight:600">${t('common.condition_new')}</span>`;
    const price = a.unit_price != null
      ? `<strong>${fmtN(a.unit_price, CURRENCY)}</strong>`
      : '';
    const dateFmt = a.created_at ? new Date(a.created_at).toLocaleDateString(locale()) : '';
    return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0">
      <span style="color:var(--mut);font-size:.78rem;min-width:24px">×${a.quantity}</span>
      ${cond}
      ${price}
      ${dateFmt ? `<span style="font-size:.72rem;color:var(--mut)">${dateFmt}</span>` : ''}
    </div>`;
  }).join('');
}

export async function openManDetail(type, id, colorId) {
  _manItem = { type, id, colorId: parseInt(colorId)||0 };
  const modal = G('man-detail-modal');
  const bodyEl = G('man-detail-body');
  const imgEl  = G('man-detail-img');

  // Load item from cache
  const fromCache = () => type === 'fig'
    ? (manualFigsCache || []).find(f => f.fig_number === id)
    : (manualPartsCache || []).find(p => p.part_number === id && (p.color_id||0) === _manItem.colorId);

  let item = fromCache();
  // Die Caches füllen die Reiter Teile und Minifiguren. Aus der Finanztabelle
  // heraus ist der passende Reiter oft nie geöffnet worden — dann war der
  // Eintrag nicht im Cache und der Dialog ging stillschweigend GAR NICHT auf.
  // Also einmal nachladen und erneut suchen.
  if (!item) {
    if (type === 'fig') await loadManualFigsTable().catch(() => {});
    else                await loadManualParts().catch(() => {});
    item = fromCache();
  }
  if (!item) return;

  G('man-detail-tit').textContent = item.fig_name || item.part_name || id;
  G('man-detail-sub').textContent = id + (item.color_name ? ' · ' + item.color_name : '');

  // War: fullUrl(...) allein — bei einer CDN-Quelle ohne imgUrl()-Umwicklung
  // lädt der Browser direkt von Rebrickable, am Server vorbei. Das ist der
  // eigenständige Kaufpreis-Detail-Dialog für manuell erfasste Teile/
  // Minifiguren — ein anderer Ort als die Kachel-Zoom-Funktion in 03-parts.js/
  // 06-minifigs.js, die bereits korrigiert wurde. Jetzt wie dort: über den
  // Server-Proxy, volle Auflösung ohne &thumb=1.
  const rawImgSrc = item.image_local || item.image_url || '';
  const imgSrc = rawImgSrc ? imgUrl(fullUrl(rawImgSrc), false) : '';
  if (imgSrc) { imgEl.src = imgSrc; imgEl.style.display = ''; } else { imgEl.style.display = 'none'; }

  // Load acquisitions
  const acqUrl = type === 'fig'
    ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
    : `/v1/parts/${encodeURIComponent(id)}/${parseInt(colorId)||0}/acquisitions`;
  const ad = await api('GET', acqUrl).catch(()=>null);
  const acqs = ad?.acquisitions || [];

  // Build detail rows
  const rows = [];

  // Qty stepper — die Stückzahl kommt aus derselben Serversumme wie die
  // Summenzeile darunter (`totals`), nicht aus einer eigenen Schleife.
  const totalQty = ad?.totals?.priced_rows !== undefined && acqs.length
    ? ad.totals.quantity : item.quantity;
  rows.push(`<div class="dr"><span class="dl">${t('detail.qty')}</span><span class="dv" style="display:flex;align-items:center;gap:6px">
    <button class="btn bs btn-sm" data-click="manQtyChange" data-arg="-1" style="font-size:1rem;padding:2px 8px;line-height:1">−</button>
    <input type="number" id="man-det-qty" min="1" value="${totalQty}" style="width:46px;text-align:center;border:1px solid var(--bdr);border-radius:6px;padding:2px;font-weight:600" data-change="manQtySave" />
    <button class="btn bs btn-sm" data-click="manQtyChange" data-arg="1" style="font-size:1rem;padding:2px 8px;line-height:1">+</button>
  </span></div>`);

  // BrickLink-Nr (minifigs only, editable)
  if (type === 'fig') {
    rows.push(`<div class="dr"><span class="dl">BrickLink-Nr.</span><span class="dv">
      <input type="text" value="${esc(item.bl_fig_number||'')}" placeholder="z.B. sw0001" style="width:110px;text-align:right;border:1px solid var(--bdr);border-radius:6px;padding:2px 6px"
        data-blur="saveManualFigBl" data-arg="${esc(id)}" />
    </span></div>`);
  }

  // Colour (parts only, read-only)
  if (type === 'part' && item.color_name) {
    const swatch = item.color_hex ? `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#${item.color_hex};border:1px solid rgba(0,0,0,.15);margin-right:4px;vertical-align:middle"></span>` : '';
    rows.push(`<div class="dr"><span class="dl">${t('parts.color_label')}</span><span class="dv">${swatch}${esc(item.color_name)}</span></div>`);
  }

  // Note
  if (item.note) rows.push(`<div class="dr"><span class="dl">${t('parts.note_label')}</span><span class="dv" style="color:var(--mut);font-size:.83rem">${esc(item.note)}</span></div>`);

  // Acquisition summary — compact, like set-detail
  rows.push(`<div class="dr" style="align-items:flex-start">
    <span class="dl">${t('detail.purchase_price')}</span>
    <span id="man-acq-summary" class="dv" style="flex-direction:column;align-items:flex-end;gap:3px">
      ${renderManAcqSummary(acqs, type, id, colorId)}
      <button class="btn bs btn-sm" data-click="openManAcqModal" style="margin-top:4px;font-size:.75rem;padding:2px 10px">✏️ ${t('detail.edit_prices')}</button>
    </span>
  </div>`);

  // Preisverlauf — wie im Set-Detail, beide Zustände in einem Diagramm.
  //
  // Die Verlaufstabellen für Teile und Figuren sind neu (db/migrations/0003);
  // vorher speicherte der Cache nur den zuletzt abgerufenen Preis. Das
  // Diagramm bleibt deshalb eine Weile leer, bis genug Punkte gesammelt sind —
  // das ist erwartet und kein Fehler.
  // Marktpreis je Zustand — oberhalb des Diagramms, wie im Set-Detail.
  rows.push('<div id="man-market-rows"></div>');

  rows.push(`<div style="margin-top:10px">
    <div style="font-size:.73rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin-bottom:4px">${t('detail.price_history')}</div>
    <div id="man-chart-content"><span style="color:var(--mut);font-size:.78rem">${t('common.loading')}</span></div>
  </div>`);

  bodyEl.innerHTML = rows.join('');
  modal.classList.add('open');

  // Verlauf nachladen. Derselbe Renderer wie beim Set — die Endpunkte liefern
  // dieselbe Diagrammstruktur (utils/chartData.ts), also braucht es hier keine
  // zweite Zeichenlogik.
  const histUrl = type === 'fig'
    ? `/v1/minifigs/${encodeURIComponent(id)}/price-history`
    : `/v1/parts/${encodeURIComponent(id)}/${colorId || 0}/price-history`;
  api('GET', histUrl).then(ph => {
    // Dieselbe Funktion wie im Set-Detail — die Endpunkte liefern dieselbe
    // by_condition-Struktur, also braucht es keine zweite Darstellungslogik.
    renderMarketRows(ph, 'man-market-rows');
    const el = G('man-chart-content');
    if (!el) return;
    el.innerHTML = ph?.success
      ? priceChartSVG(ph, `man-${String(id).replace(/[^a-zA-Z0-9]/g, '')}-${colorId || 0}`)
      : `<span style="color:var(--mut);font-size:.78rem">${t('detail.no_history')}</span>`;
  }).catch(() => {
    const el = G('man-chart-content');
    if (el) el.innerHTML = `<span style="color:var(--mut);font-size:.78rem">${t('detail.no_history')}</span>`;
  });

  // Wire delete button — deleteManualFig/deleteManualPart already have their own confirmDelete
  G('man-detail-del').onclick = async () => {
    const mi = _manItem;
    if (type === 'fig') {
      const ok = await deleteManualFig(id);
      if (ok !== false) closeManDetail();
    } else {
      const ok = await deleteManualPart(id, mi.colorId);
      if (ok !== false) closeManDetail();
    }
  };

}

function closeManDetail() {
  G('man-detail-modal').classList.remove('open');
  _manItem = null;
}
G('man-detail-modal').addEventListener('click', e => e.target.id === 'man-detail-modal' && closeManDetail());

function manQtyChange(delta) {
  const inp = G('man-det-qty');
  if (!inp) return;
  // parseInt auf delta: Seit der Umstellung auf data-arg kommt der Wert als
  // Zeichenkette ("1"/"-1"). Ohne Umwandlung wäre 1 + "1" die Zeichenkette
  // "11" — aus einer 1 wurde beim Klick auf + eine 11.
  inp.value = Math.max(1, parseInt(inp.value || 1) + (parseInt(delta) || 0));
  manQtySave();
}

async function manQtySave() {
  const inp = G('man-det-qty');
  if (!inp || !_manItem) return;
  const { type, id, colorId } = _manItem;
  const qty = parseInt(inp.value)||1;
  if (type === 'fig') {
    await updateManualFig(id, { quantity: qty });
  } else {
    await updateManualPart(id, colorId, { quantity: qty });
  }

  // Erfassungsliste IMMER neu laden — in beide Richtungen.
  //
  // ── Was vorher falsch war ─────────────────────────────────────────────────
  // Hier stand `if (qty > prevQty)`, also nur beim Erhöhen. Das erzeugte zwei
  // Fehlerbilder, die wie zwei verschiedene Fehler aussahen:
  //
  //   • Menge REDUZIEREN: Der Server entfernt (bzw. verkleinert) die heutige
  //     Erfassung per LIFO — die Anzeige lud aber nie neu und zeigte den
  //     gelöschten Eintrag weiter an.
  //
  //   • Menge ERHÖHEN: prevQty kam aus manualPartsCache/manualFigsCache und
  //     wurde bei Teilen NUR über part_number gesucht — ohne color_id. Bei
  //     einem Teil in mehreren Farben traf das die falsche Zeile; fand es gar
  //     nichts (Teil nicht in der geladenen Seite der paginierten Liste), fiel
  //     der Ausdruck auf inp.value zurück. Das ist zu diesem Zeitpunkt aber
  //     bereits der NEUE Wert, weil manQtyChange() ihn vor dem Aufruf setzt —
  //     `qty > prevQty` war damit `qty > qty`, also falsch, und es wurde
  //     ebenfalls nicht nachgeladen.
  //
  // prevQty ist ersatzlos entfallen: Ein GET auf die Erfassungen kostet nichts
  // und die Antwort ist die einzige verlässliche Quelle dafür, was jetzt in der
  // Datenbank steht. Eine Bedingung, die raten muss, ob sich etwas geändert
  // hat, ist hier schlicht die falsche Konstruktion.
  const acqUrl2 = type==='fig'
    ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
    : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions`;
  api('GET', acqUrl2).then(ad2 => {
    const acqs2 = ad2?.acquisitions || [];
    const sumEl = G('man-acq-summary');
    if (sumEl) sumEl.innerHTML = renderManAcqSummary(acqs2, type, id, colorId) +
      `<button class="btn bs btn-sm" data-click="openManAcqModal" style="margin-top:4px;font-size:.75rem;padding:2px 10px">✏️ ${t('detail.edit_prices')}</button>`;
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
    ? ((manualFigsCache||[]).find(f=>f.fig_number===id)?.fig_name || id)
    : ((manualPartsCache||[]).find(p=>p.part_number===id)?.part_name || id);
  G('acq-modal-tit').textContent = tRaw('detail.edit_prices');
  G('acq-modal-sub').textContent = title;
  G('acq-modal-body').innerHTML = `<div style="color:var(--mut);font-size:.82rem">${t('common.loading')}</div>`;
  G('man-detail-modal').classList.remove('open');
  G('acq-modal').classList.add('open');
  // Override close to return to man-detail-modal
  _acqModalSn = null;
  _acqManItem = _manItem;
  loadManAcqModal(type, id, colorId);
}

let _acqManItem = null;

// Override the acq-modal close button behaviour for manual items
const _origCloseAcqModal = closeAcqModal;
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
      if (sumEl) sumEl.innerHTML = renderAcquisitionSummary(ad.acquisitions, sn) +
        `<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${escJs(sn)}" style="margin-top:4px;font-size:.75rem;padding:2px 10px">✏️ ${t('detail.edit_prices')}</button>`;
      const total = ad.totals?.quantity ?? 0;
      const qEl = G('m-qty');
      if (qEl && total > 0) { qEl.value = total; if(curSet) curSet.quantity = total; }
    }).catch(()=>{});
  }
}

async function loadManAcqModal(type, id, colorId) {
  const url = type === 'fig'
    ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
    : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions`;
  const ad = await api('GET', url).catch(()=>null);
  // Wie im Set-Dialog: Ohne Mitgliederliste und ohne owner_user_id wüsste die
  // Eigentümer-Auswahl nicht, worauf sie steht.
  if (!_householdMembers.length) {
    const hm = await api('GET', '/v1/sets/household-members').catch(() => null);
    _householdMembers = hm?.members || [];
  }
  _acqOwnerId = ad?.owner_user_id ?? ME?.id ?? null;
  renderManAcqBody(type, id, colorId, ad?.acquisitions || [], ad?.totals);
}

function renderManAcqBody(type, id, colorId, acqs, totals) {
  // Reuse the same table renderer with type-specific save/delete
  if (!acqs.length) {
    G('acq-modal-body').innerHTML = `<div style="color:var(--mut);font-size:.85rem;padding:.5rem 0">—</div>`;
    return;
  }
  const th = s => `<th style="padding:6px 8px;font-weight:600;color:var(--mut);font-size:.75rem;text-transform:uppercase;letter-spacing:.4px">${s}</th>`;
  let html = `<div class="tw"><table class="dt" style="width:100%;border-collapse:collapse;font-size:.875rem">
    <thead><tr style="border-bottom:2px solid var(--bdr)">
      ${th(t('detail.qty'))}${th(t('detail.added'))}
      <th style="padding:6px 8px;font-weight:600;color:var(--mut);font-size:.75rem;text-transform:uppercase;letter-spacing:.4px;text-align:center">${t('common.condition')}</th>
      <th style="padding:6px 8px;font-weight:600;color:var(--mut);font-size:.75rem;text-transform:uppercase;letter-spacing:.4px;text-align:right">${t('figs.price_label')}</th>
      ${_householdMembers.length > 1 ? th(t('household.owner')) : ''}
      <th style="width:32px"></th>
    </tr></thead><tbody>`;

  acqs.forEach(a => {
    const _dt = a.created_at ? new Date(a.created_at) : null;
    const dateIso = _dt ? `${_dt.getFullYear()}-${String(_dt.getMonth()+1).padStart(2,'0')}-${String(_dt.getDate()).padStart(2,'0')}` : '';
    const priceVal = a.unit_price != null ? parseFloat(a.unit_price) : '';
    // Use single-quoted string args to avoid breaking HTML double-quote attribute delimiters
    const t_ = type, i_ = id, c_ = colorId, ai_ = a.id;
    html += `<tr style="border-bottom:1px solid var(--bdr)">
      <td style="padding:6px 6px">
        <input type="number" min="1" value="${a.quantity}"
          data-blur="manAcqSave" data-arg="${esc(t_)}" data-arg2="${i_}" data-arg3="${c_}" data-arg4="${ai_}" data-arg5="qty" data-val="1"
          data-keydown="blurOnEnter"
          style="width:48px;text-align:center;border:1px solid var(--bdr);border-radius:6px;padding:4px 6px;font-size:.875rem;font-weight:700;background:var(--sur);color:var(--txt)" />
      </td>
      <td style="padding:6px 8px;white-space:nowrap">
        <input type="date" value="${dateIso}"
          data-change="manAcqSave" data-arg="${esc(t_)}" data-arg2="${i_}" data-arg3="${c_}" data-arg4="${ai_}" data-arg5="date" data-val="1"
          style="border:1px solid var(--bdr);border-radius:6px;padding:3px 6px;font-size:.82rem;background:var(--sur);color:var(--txt)" />
      </td>
      <td style="padding:6px 4px;text-align:center">
        <select data-change="manAcqSave" data-arg="${esc(t_)}" data-arg2="${i_}" data-arg3="${c_}" data-arg4="${ai_}" data-arg5="cond" data-val="1"
          style="font-size:.82rem;border:1px solid var(--bdr);border-radius:6px;padding:3px 6px;background:var(--sur);color:var(--txt)">
          <option value="N" ${a.condition!=='U'?'selected':''}>${t('common.condition_new')}</option>
          <option value="U" ${a.condition==='U'?'selected':''}>${t('common.condition_used')}</option>
        </select>
      </td>
      <td style="padding:6px 8px;text-align:right">
        <input type="text" inputmode="decimal" value="${priceVal}"
          data-blur="manAcqSave" data-arg="${esc(t_)}" data-arg2="${i_}" data-arg3="${c_}" data-arg4="${ai_}" data-arg5="price" data-val="1"
          data-keydown="blurOnEnter"
          style="width:84px;text-align:right;border:1px solid var(--bdr);border-radius:6px;padding:4px 8px;font-size:.875rem;font-weight:600;background:var(--sur);color:var(--txt)" />
      </td>
      ${_householdMembers.length > 1 ? `<td style="padding:6px 4px">
        <select data-change="manAcqSave" data-arg="${esc(t_)}" data-arg2="${i_}" data-arg3="${c_}" data-arg4="${ai_}" data-arg5="owner" data-val="1"
          style="font-size:.82rem;border:1px solid var(--bdr);border-radius:6px;padding:3px 6px;background:var(--sur);color:var(--txt)">
          ${_householdMembers.map(m => `<option value="${m.id}"${m.id === (a.owner_user_id ?? _acqOwnerId) ? ' selected' : ''}>${esc(m.username)}</option>`).join('')}
        </select>
      </td>` : ''}
      <td style="padding:6px 4px;text-align:center">
        <button data-click="manAcqDelete" data-arg="${esc(t_)}" data-arg2="${i_}" data-arg3="${c_}" data-arg4="${ai_}"
          style="background:none;border:none;cursor:pointer;font-size:1rem;color:var(--r500);padding:2px 4px;border-radius:4px">🗑️</button>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  html += acqSummary(totals);
  G('acq-modal-body').innerHTML = html;
}

async function manAcqSave(type, id, colorId, acqId, field, value) {
  try {
    const url = type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions/${acqId}`
      : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions/${acqId}`;
    const body = {};
    if (field==='price') body.unit_price = value===''?null:parseFloat(value);
    else if (field==='qty') body.quantity = Math.max(1,parseInt(value)||1);
    else if (field==='date') body.date = value;
    else if (field==='owner') {
      // Eigentümerwechsel = Verschieben genau dieser Kaufpreis-Zeile. Ein
      // manuell erfasstes Teil hat keinen Inhalt — es wandern nur Menge und
      // Erfassung (utils/setMove.ts, moveManualAcquisition). KEIN
      // from_user_id: Den Absender ermittelt der Server aus der Zeile selbst
      // (acquisitionMoveSource) — hier stand der Betrachter, siehe acqSave().
      body.owner_user_id = parseInt(value);
    }
    else body.condition = value;
    const d = await api('PUT', url, body);
    if (!d?.success) {
      toast((d?.error)||t('settings.error'),'error');
      if (field==='date' || field==='owner') await loadManAcqModal(type, id, colorId);
      return;
    }
    if (field==='owner') {
      // Danach stimmt fast nichts mehr auf dem Schirm: Mengen, Summen,
      // Besitzer-Plaketten. Lieber neu laden als vier Stellen nachziehen.
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
  // Marktpreis-Zeilen nachladen: Wird erstmals ein Kaufpreis in einem Zustand
  // erfasst, entsteht dafür eine neue Zeile.
  const mi = _manItem;
  if (mi) {
    const u = mi.type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(mi.id)}/price-history`
      : `/v1/parts/${encodeURIComponent(mi.id)}/${mi.colorId || 0}/price-history`;
    api('GET', u).then(ph => renderMarketRows(ph, 'man-market-rows')).catch(()=>{});
  }
}

async function manAcqDelete(type, id, colorId, acqId) {
  if (!await confirmDelete(tRaw('acq.delete_title'), t('acq.delete_text'), '🗑️')) return;
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
  if (sumEl) sumEl.innerHTML = renderManAcqSummary(acqs, type, id, colorId) +
    `<button class="btn bs btn-sm" data-click="openManAcqModal" style="margin-top:4px;font-size:.75rem;padding:2px 10px">✏️ ${t('detail.edit_prices')}</button>`;
  if (!acqs.length) { closeAcqModal(); return; }
  renderManAcqBody(type, id, colorId, acqs, ad?.totals);
  if (type==='fig') loadManualFigsTable();
  else loadManualParts();
}

// Open modal: show price history sparkline



// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
// Die elf Handler dieser beiden Fenster meldete bis Nachtrag 130 js/07-admin.js
// an — obwohl sie hier umgesetzt werden.
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
});
