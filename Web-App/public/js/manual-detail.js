import { emit } from './events.js';
import { detailRow } from './components.js';
import { genuine, registerActions } from './registry.js';
import { colorName, t, tRaw } from '../i18n.js';
import { escHex, escJs, rawHex, esc, html, rawHtml, joinHtml } from './escaping.js';
import { api } from './api.js';
import { fullUrl, imgUrl } from './images.js';
import { ico, G, activeTab, setHtml, insertHtml } from './dom.js';
import { amountForField } from './format.js';
import { amountFromField, quantityFromField, purchaseDateValid } from './form.js';
import { toast } from './messages.js';
import { deleteManualFig, loadManualFigsTable, manualMinifigs, updateManualFig } from './minifigs.js';
import { loggedInAccount } from './state.js';
import { locationBlock, loadLocationSelection } from './detail-fields.js';
import { deleteFinal } from './deletion.js';
import { acqSummary, renderManAcqSummary, summaryMan } from './purchase-price-display.js';
import { chartWidth, priceChartSVG, renderMarketRows } from './charts.js';
import { deleteManualPart, loadManualParts, manualParts, updateManualPart } from './parts.js';
import { loadBrickColors } from './part-add.js';
import { acquisition, saved, setWithFocus, isoTag, dateField, savedBrand, showSaved } from './entry-state.js';
import { closeAcqModal } from './purchase-dialogs.js';
/** @typedef {import('../../frontend-types/contract').AcquisitionTotals} AcquisitionTotals */
/** @typedef {import('../../frontend-types/contract').Acquisition} Acquisition */

// Detail dialog and acquisitions of manually recorded parts and minifigs; the #acq-modal window is
// shared with the set's acquisition dialog (purchase-dialogs.js).
// ── MANUAL ITEM DETAIL MODAL (parts + minifigs) ─────────────────────────
/** @type {{ type: string, id: string, colorId: number, owner?: number } | null} */
let _manItem = null; // { type:'part'|'fig', id, colorId:int, owner:int|undefined }
/** Another dialog is taking over: the state of the item dialog no longer applies. */
export function forgetManualItem() {
  _manItem = null;
}

/** The rows of the detail dialog for a manually recorded part or minifig.
 * @param {string} type @param {string} id @param {number} colorId @param {{ quantity?: number, user_id?: number | null, bl_fig_number?: string | null, color_hex?: string | null, color_name?: string | null, storage?: string | null }} item @param {Acquisition[]} acqs @param {{ totals?: { priced_rows?: number, quantity?: number } } | null | undefined} ad
 * @returns {import('./escaping.js').Markup[]} */
function manDetailRows(type, id, colorId, item, acqs, ad) {
  const rows = [];

  // Qty stepper — the count comes from the same server total as the summary row below (`totals`),
  // not from a separate loop.
  const totalQty = ad?.totals?.priced_rows !== undefined && acqs.length ? ad.totals.quantity : item.quantity;
  rows.push(
    detailRow(
      t('detail.qty'),
      html`
    <button class="btn bs btn-sm" data-click="manQtyChange" data-arg="-1" aria-label="${tRaw('detail.qty_less')}" data-style="font-size:var(--fs-4);padding:2px 8px;line-height:1">−</button>
    <input inputmode="numeric" type="number" id="man-det-qty" min="1" aria-label="${tRaw('detail.qty')}" value="${totalQty}" data-style="width:4.5em;text-align:center;border:1px solid var(--field-border);border-radius:6px;padding:2px;font-weight:600" data-change="manQtySave" />
    <button class="btn bs btn-sm" data-click="manQtyChange" data-arg="1" aria-label="${tRaw('detail.qty_more')}" data-style="font-size:var(--fs-4);padding:2px 8px;line-height:1">+</button>
  `,
      { valueStyle: 'display:flex;align-items:center;gap:6px' },
    ),
  );

  // BrickLink number (minifigs only, editable)
  if (type === 'fig') {
    rows.push(
      detailRow(
        'BrickLink-Nr.',
        html`
      <input type="text" value="${item.bl_fig_number || ''}" placeholder="${tRaw('figs.bl_placeholder')}" aria-label="${tRaw('figs.bl_number')}" data-style="width:9em;max-width:100%;text-align:right;border:1px solid var(--field-border);border-radius:6px;padding:2px 6px"
        data-blur="saveManualFigBl" data-arg="${id}" data-arg2="${item?.user_id || ''}" />
    `,
      ),
    );
  }

  // A part's color is editable, in case it was loaded wrong — exactly a part with no color name
  // needs this row. The same list as when recording (loadBrickColors), loaded after drawing.
  if (type === 'part') {
    const swatch = html`<span id="man-color-dot" data-style="display:inline-block;width:12px;height:12px;border-radius:50%;border:1px solid rgba(0,0,0,.15);vertical-align:middle;flex:0 0 auto" data-color-hex="${escHex(item.color_hex, 'var(--s300)')}"></span>`;
    rows.push(
      detailRow(
        t('parts.color_label'),
        html`${swatch}
      <select id="man-color-choice" aria-label="${tRaw('parts.color_label')}" data-style="max-width:150px;border:1px solid var(--field-border);border-radius:6px;padding:2px 4px;font-size:var(--fs-2)"
        data-change="savePartColor" data-part="${id}" data-color="${colorId}"
        data-owner="${item?.user_id ?? ''}">
        <option value="${colorId}">${item.color_name ? colorName(item.color_name) : tRaw('parts.no_color_dash')}</option>
      </select>`,
        { valueStyle: 'display:flex;align-items:center;gap:6px;justify-content:flex-end' },
      ),
    );
  }

  // Storage location also in the detail of manually recorded parts and minifigs: the same control and
  // the same save path as for parts from sets, only the address depends on the type. The location list
  // belongs to the owner.
  loadLocationSelection(item?.user_id != null ? [item.user_id] : []).catch(() => {});
  rows.push(
    detailRow(
      t('detail.storage'),
      locationBlock(
        'man-storage',
        item?.storage,
        `data-change="savePartLocation" data-entry-type="${type === 'fig' ? 'fig' : 'part'}" ` +
          `data-part="${escJs(id)}" data-color="${colorId}" ` +
          `data-owners="${esc(item?.user_id ?? '')}"`,
      ),
      { valueStyle: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end' },
    ),
  );

  // Acquisition summary — compact, like set-detail
  rows.push(
    detailRow(
      t('detail.purchase_price'),
      html`
      ${renderManAcqSummary(acqs, type, id, colorId)}
      <button class="btn bs btn-sm" data-click="openManAcqModal" data-style="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('edit')} ${tRaw('detail.edit_prices')}</button>
    `,
      {
        rowsStyle: 'align-items:flex-start',
        valueId: 'man-acq-summary',
        valueStyle: 'flex-direction:column;align-items:flex-end;gap:3px',
      },
    ),
  );

  // Price history like in set detail, both conditions in one chart, the market price per condition above.
  // Until enough points are collected the chart stays empty — that is expected.
  rows.push(html`<div id="man-market-rows"></div>`);

  rows.push(html`<div data-style="margin-top:10px">
    <h3 class="area-title" data-style="margin-bottom:4px">${tRaw('detail.price_history')}</h3>
    <div id="man-chart-content"><span data-style="color:var(--mut);font-size:var(--fs-1)">${tRaw('common.loading')}</span></div>
  </div>`);

  return rows;
}

/** Load the price history and market prices in the background, without holding up the dialog.
 * @param {string} type @param {string} id @param {number | string} colorId */
function loadManPriceHistory(type, id, colorId) {
  // Same renderer as for the set — the endpoints deliver the same chart structure
  // (src/finances/chartData.ts), so no second drawing logic is needed here.
  const histUrl =
    type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/price-history`
      : `/v1/parts/${encodeURIComponent(id)}/${colorId || 0}/price-history`;
  api('GET', histUrl)
    .then(ph => {
      // Same function as in set detail — the endpoints deliver the same by_condition structure, so no
      // second rendering logic is needed.
      renderMarketRows(ph, 'man-market-rows');
      const el = G('man-chart-content');
      if (!el) return;
      setHtml(
        el,
        ph?.success
          ? priceChartSVG(ph, `man-${String(id).replace(/[^a-zA-Z0-9]/g, '')}-${colorId || 0}`, chartWidth(el))
          : html`<span data-style="color:var(--mut);font-size:var(--fs-1)">${tRaw('detail.no_history')}</span>`,
      );
    })
    .catch(() => {
      const el = G('man-chart-content');
      if (el)
        setHtml(
          el,
          html`<span data-style="color:var(--mut);font-size:var(--fs-1)">${tRaw('detail.no_history')}</span>`,
        );
    });
}

/**
 * @param {string} type
 * @param {string} id
 * @param {string | number} colorId
 */
export async function openManDetail(type, id, colorId) {
  const target = /** @type {NonNullable<typeof _manItem>} */ ({
    type,
    id,
    colorId: parseInt(String(colorId), 10) || 0,
  });
  _manItem = target;
  const modal = G('man-detail-modal');
  const bodyEl = G('man-detail-body');
  const imgEl = G('man-detail-img');

  /** @param {ManualMinifig[] | undefined} figs @param {ManualPart[] | undefined} parts */
  const find = (figs, parts) =>
    type === 'fig'
      ? figs?.find(f => f.fig_number === id)
      : parts?.find(p => p.part_number === id && (p.color_id || 0) === target.colorId);

  let item = find(manualMinifigs(), manualParts());
  // The caches of the parts and minifigs tabs follow their own search, location and account filters;
  // the finance table does not. If the entry is missing it is therefore looked up unfiltered — the
  // tab's cache stays as it is.
  if (!item && type === 'fig') item = find((await api('GET', '/v1/minifigs/manual'))?.figs, undefined);
  if (!item && type !== 'fig') item = find(undefined, (await api('GET', '/v1/parts/manual'))?.parts);
  // Remember the CARD's owner. In a household the manual section shows entries of all accounts; without
  // this, the server wrote to the caller's row. MEASURED: the main account set the quantity of the
  // child's card to 99 — the own one changed (before 5|9, after 99|9), and the response still said "success".
  target.owner = item?.user_id ?? undefined;
  if (!item) return;

  G('man-detail-tit').textContent = String(item.fig_name || item.part_name || id);
  G('man-detail-sub').textContent = id + (item.color_name ? ' · ' + colorName(String(item.color_name)) : '');

  // Full resolution via the server proxy, not directly from the CDN: the browser never loads foreign
  // image addresses itself (hotlink protection, cache).
  const rawImgSrc = item.image_local || item.image_url || '';
  const imgSrc = rawImgSrc ? imgUrl(fullUrl(rawImgSrc), false) : '';
  if (imgSrc) {
    imgEl.src = imgSrc;
    imgEl.style.display = '';
  } else {
    imgEl.style.display = 'none';
  }

  // Load acquisitions
  const acqUrl =
    type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
      : `/v1/parts/${encodeURIComponent(id)}/${parseInt(String(colorId), 10) || 0}/acquisitions`;
  const ad = await api('GET', acqUrl);
  const acqs = ad?.acquisitions || [];

  setHtml(bodyEl, joinHtml(manDetailRows(type, id, target.colorId, item, acqs, ad)));
  modal.classList.add('open');

  // Fill in the color choices — see the reasoning at the row above.
  if (type === 'part') fillColorChoices(target.colorId).catch(() => {});

  loadManPriceHistory(type, id, colorId);

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
 * Fill the color list separately from drawing: the first fetch goes to Rebrickable, the dialog
 * stays open meanwhile. If it fails, the current color remains the only choice — better than a
 * list without it.
 * @param {number} current
 */
async function fillColorChoices(current) {
  const sel = G('man-color-choice');
  if (!sel) return;
  const colors = await loadBrickColors();
  if (!colors?.length || !G('man-color-choice')) return;
  // data-name stays the English Rebrickable name — it travels along as color_name and is needed for
  // BrickLink matching. Only the visible text is translated, with the same function as in the parts
  // tab (renderColorDropdown in minifigs.js).
  setHtml(
    sel,
    colors.map(
      c =>
        html`${html`<option value="${c.id}" data-name="${(c.name || '').replace(/"/g, '&quot;')}" `}${html`data-hex="${rawHex(c.hex)}"${Number(c.id) === Number(current) ? ' selected' : ''}>`}${html`${colorName(c.name)}</option>`}`,
    ),
  );
  // If the list does not know today's color (older inventories, a color Rebrickable has retired), it
  // would have vanished after the replace and the selection would sit on a FOREIGN color — without
  // anyone having changed anything. Then it is added back at the front.
  if (!colors.some(c => Number(c.id) === Number(current))) {
    insertHtml(sel, 'afterbegin', html`<option value="${Number(current) || 0}" selected>${String(current)}</option>`);
  }
}

/**
 * Change a manual part's color (the rules live in src/parts/changeColor.ts). The dialog then reopens
 * with the new color: it is part of the address, the old dialog pointed into nothing.
 * @this {unknown}
 */
async function savePartColor() {
  const el =
    this instanceof HTMLSelectElement
      ? this
      : /** @type {HTMLSelectElement | null} */ (document.querySelector('#man-color-choice'));
  if (!el) return;
  const number = el.dataset.part ?? '';
  const old = parseInt(el.dataset.color ?? '', 10) || 0;
  const newValue = parseInt(el.value, 10);
  if (!Number.isFinite(newValue) || newValue === old) return;
  const choice = el.options[el.selectedIndex];
  const owner = el.dataset.owner;
  const d = await api(
    'PUT',
    `/v1/parts/${encodeURIComponent(number)}/${old}/color${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`,
    { color_id: newValue, color_name: choice?.dataset.name || null, color_hex: choice?.dataset.hex || null },
  );
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  // `bild` says where the new color's image comes from (src/parts/changeColor.ts).
  // null means: none found — then the placeholder shows up after reopening, and that was exactly
  // Marco's finding. The message says so instead of leaving him facing an empty spot a second time.
  if (d.bild === null) toast(tRaw('parts.color.saved_no_image'), 'info');
  else toast(tRaw('settings.saved'), 'success');
  await loadManualParts().catch(() => {});
  if (activeTab() === 'finance') emit('financesLoad');
  await openManDetail('part', number, newValue);
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
  // parseInt on delta: since the switch to data-arg, the value arrives as a string ("1"/"-1").
  // Without the conversion, 1 + "1" would be the string "11" — a click on + turned a 1 into an 11.
  inp.value = String(Math.max(1, parseInt(inp.value || '1', 10) + (parseInt(delta, 10) || 0)));
  manQtySave();
}

async function manQtySave() {
  const inp = G('man-det-qty');
  if (!inp || !_manItem) return;
  const { type, id, colorId, owner } = _manItem;
  const qty = parseInt(inp.value, 10) || 1;
  if (type === 'fig') {
    await updateManualFig(id, { quantity: qty }, owner);
  } else {
    await updateManualPart(id, colorId, { quantity: qty }, owner);
  }

  // Reload the acquisitions list after every quantity change, in both directions: on a decrease the
  // server removes acquisitions (LIFO), and reloading only on an increase kept showing deleted entries.
  const acqUrl2 =
    type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
      : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions`;
  api('GET', acqUrl2)
    .then(ad2 => {
      const acqs2 = ad2?.acquisitions || [];
      const sumEl = G('man-acq-summary');
      if (sumEl) setHtml(sumEl, summaryMan(acqs2, type, id, colorId));
      if (G('acq-modal').classList.contains('open')) renderManAcqBody(type, id, colorId, acqs2, ad2?.totals);
    })
    .catch(() => {});

  // Refresh the tile cache
  if (type === 'fig') loadManualFigsTable();
  else loadManualParts();
}

// Opens the shared acquisition-editing dialog for manual parts and minifigs
function openManAcqModal() {
  if (!_manItem) return;
  const { type, id, colorId } = _manItem;
  const title =
    type === 'fig'
      ? manualMinifigs().find(f => f.fig_number === id)?.fig_name || id
      : manualParts().find(p => p.part_number === id)?.part_name || id;
  G('acq-modal-tit').textContent = tRaw('detail.edit_prices');
  G('acq-modal-sub').textContent = title;
  setHtml(
    G('acq-modal-body'),
    html`<div data-style="color:var(--mut);font-size:var(--fs-2)">${tRaw('common.loading')}</div>`,
  );
  G('man-detail-modal').classList.remove('open');
  saved.clear();
  G('acq-modal').classList.add('open');
  // Closing leads back to this dialog instead of to the set.
  acquisition.sn = null;
  const mi = _manItem;
  acquisition.back = () => {
    if (mi.type === 'fig') loadManualFigsTable();
    else loadManualParts();
    openManDetail(mi.type, mi.id, mi.colorId);
  };
  loadManAcqModal(type, id, colorId);
}

/**
 * @param {string} type
 * @param {string} id
 * @param {number} colorId
 */
async function loadManAcqModal(type, id, colorId) {
  const url =
    type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
      : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions`;
  const ad = await api('GET', url);
  // Same as in the set dialog: without the member list and without owner_user_id, the owner picker
  // would not know what it stands on.
  if (!acquisition.members.length) {
    const hm = await api('GET', '/v1/sets/household-members');
    acquisition.members = hm?.members || [];
  }
  acquisition.owner = ad?.owner_user_id ?? loggedInAccount?.id ?? null;
  renderManAcqBody(type, id, colorId, ad?.acquisitions || [], ad?.totals);
}

/**
 * @param {string} type
 * @param {string} id
 * @param {number} colorId
 * @param {Acquisition[]} acqs
 * @param {AcquisitionTotals | undefined} totals
 */
function renderManAcqBody(type, id, colorId, acqs, totals) {
  // Same table builder, with save and delete per kind
  if (!acqs.length) {
    setHtml(
      G('acq-modal-body'),
      html`<div data-style="color:var(--mut);font-size:var(--fs-3);padding:.5rem 0">—</div>`,
    );
    return;
  }
  let markup = html`<div class="tw"><table class="dt acq-table" aria-label="${tRaw('detail.purchase_price')}">
    <thead><tr>
      <th>${tRaw('detail.qty')}</th><th>${tRaw('detail.added')}</th>
      <th>${tRaw('common.condition')}</th>
      <th class="number">${tRaw('figs.price_label')}</th>
      ${acquisition.members.length > 1 ? html`<th>${tRaw('household.owner')}</th>` : ''}
      <th><span class="vh">${tRaw('common.actions')}</span></th>
    </tr></thead><tbody>`;

  acqs.forEach(a => {
    const dateIso = isoTag(a.created_at);
    const t_ = type,
      i_ = id,
      c_ = colorId,
      ai_ = a.id;
    const args = `data-arg="${esc(t_)}" data-arg2="${esc(i_)}" data-arg3="${esc(c_)}" data-arg4="${ai_}"`;
    markup = html`${markup}${html`<tr id="acq-row-${ai_}">
      <td>
        <input class="acq-field acq-quantity" id="acq-quantity-${ai_}" inputmode="numeric" type="number" min="1" value="${a.quantity}" aria-label="${tRaw('detail.qty')}"
          data-blur="manAcqSave" ${rawHtml(args)} data-arg5="qty" data-val="1"
          data-keydown="blurOnEnter" />
      </td>
      <td>${dateField(`id="acq-date-field-${ai_}" data-change="manAcqSave" ${args} data-arg5="date" data-val="1"`, dateIso, `acq-date-${ai_}`)}</td>
      <td>
        <select class="acq-field" aria-label="${tRaw('common.condition')}" data-change="manAcqSave" ${rawHtml(args)} data-arg5="cond" data-val="1">
          <option value="N" ${a.condition !== 'U' ? 'selected' : ''}>${tRaw('common.condition_new')}</option>
          <option value="U" ${a.condition === 'U' ? 'selected' : ''}>${tRaw('common.condition_used')}</option>
        </select>
      </td>
      <td class="number">
        <input class="acq-field acq-price" id="acq-price-${ai_}" type="text" inputmode="decimal" autocomplete="off" value="${amountForField(a.unit_price)}" aria-label="${tRaw('detail.purchase_price')}"
          data-blur="manAcqSave" ${rawHtml(args)} data-arg5="price" data-val="1"
          data-keydown="blurOnEnter" />
      </td>
      ${
        acquisition.members.length > 1
          ? html`<td>
        <select class="acq-field" aria-label="${tRaw('household.owner')}" data-change="manAcqSave" ${rawHtml(args)} data-arg5="owner" data-val="1">
          ${acquisition.members.map(m => html`<option value="${m.id}"${m.id === (a.owner_user_id ?? acquisition.owner) ? ' selected' : ''}>${m.username}</option>`)}
        </select>
      </td>`
          : ''
      }
      <td class="acq-action">
        ${savedBrand(ai_)}
        <button class="acq-delete" data-click="manAcqDelete"${genuine()} ${rawHtml(args)}
          title="${tRaw('gallery.delete.title')}" aria-label="${tRaw('gallery.delete.title')}">${ico('delete')}</button>
      </td>
    </tr>`}`;
  });

  markup = html`${markup}${html`</tbody></table></div>`}`;
  markup = html`${markup}${acqSummary(totals)}`;
  setWithFocus(G('acq-modal-body'), markup);
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
    const url =
      type === 'fig'
        ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions/${acqId}`
        : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions/${acqId}`;
    /** @type {{ unit_price?: number | null, quantity?: number, date?: string, condition?: string, owner_user_id?: number }} */
    const body = {};
    if (field === 'price') {
      const price = amountFromField(`acq-price-${acqId}`);
      if (!price.ok) return;
      body.unit_price = price.value;
    } else if (field === 'qty') {
      const quantity = quantityFromField(`acq-quantity-${acqId}`);
      if (!quantity.ok) return;
      body.quantity = quantity.value;
    } else if (field === 'date') {
      if (!purchaseDateValid(`acq-date-field-${acqId}`)) return;
      body.date = value;
    } else if (field === 'owner') {
      // Owner change = moving exactly this acquisition row. A manually recorded item has no content —
      // only quantity and acquisition move (src/sets/setMove.ts, moveManualAcquisition). NO
      // from_user_id: the server reads the sender from the row itself (moveSource) — here it was
      // the viewer, see acqSave().
      body.owner_user_id = parseInt(value, 10);
    } else body.condition = value;
    const d = await api('PUT', url, body);
    if (!d?.success) {
      toast(d?.error || t('settings.error'), 'error');
      if (field === 'date' || field === 'owner') await loadManAcqModal(type, id, colorId);
      return;
    }
    showSaved(acqId);
    if (field === 'owner') {
      // After this almost nothing on screen still matches: quantities, totals, owner badges. Easier to
      // reload than to update four spots by hand.
      toast(tRaw('household.owner_moved', { parts: 0, figs: 0 }), 'success');
      closeAcqModal();
      closeManDetail();
      if (type === 'fig') loadManualFigsTable();
      else loadManualParts();
      return;
    }
    // Reload the dialog on price (fetched market price), quantity (a new row is possible) or date (ordering)
    if ((field === 'price' && (value === '' || value === null)) || field === 'qty' || field === 'date') {
      await loadManAcqModal(type, id, colorId);
    }
    // Always refresh the tile so the badge and price match
    if (type === 'fig') loadManualFigsTable();
    else loadManualParts();
  } catch (e) {
    console.error('[manAcqSave]', e);
    toast(tRaw('settings.error'), 'error');
  }
  // Reload market-price rows: when a purchase price is recorded for the first time in a condition, a
  // new row appears for it.
  const mi = _manItem;
  if (mi) {
    const u =
      mi.type === 'fig'
        ? `/v1/minifigs/${encodeURIComponent(mi.id)}/price-history`
        : `/v1/parts/${encodeURIComponent(mi.id)}/${mi.colorId || 0}/price-history`;
    api('GET', u)
      .then(ph => renderMarketRows(ph, 'man-market-rows'))
      .catch(() => {});
  }
}

/**
 * @param {string} type
 * @param {string} id
 * @param {number} colorId
 * @param {string} acqId
 */
async function manAcqDelete(type, id, colorId, acqId) {
  const delUrl =
    type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions/${acqId}`
      : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions/${acqId}`;
  const listUrl =
    type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
      : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions`;
  const d = await deleteFinal({
    title: tRaw('acq.delete_title'),
    text: tRaw('acq.delete_text'),
    icon: 'delete',
    request: () => api('DELETE', delUrl),
  });
  if (!d) return;
  // Update the quantity field in the detail dialog
  const qEl = G('man-det-qty');
  if (qEl && d.new_quantity !== undefined) qEl.value = d.new_quantity;
  const ad = await api('GET', listUrl);
  const acqs = ad?.acquisitions || [];
  // Refresh the summary in the detail dialog
  const sumEl = G('man-acq-summary');
  if (sumEl) setHtml(sumEl, summaryMan(acqs, type, id, colorId));
  if (!acqs.length) {
    closeAcqModal();
    return;
  }
  renderManAcqBody(type, id, colorId, acqs, ad?.totals);
  if (type === 'fig') loadManualFigsTable();
  else loadManualParts();
}

// ── Register handlers with the dispatcher (see js/registry.js) ──────────────
// Names below are registry-exposed (data-click/data-change in index.html, or connection.js) — kept unchanged.
registerActions({
  closeManDetail,
  manAcqDelete,
  manAcqSave,
  manQtyChange,
  manQtySave,
  openManAcqModal,
  openManDetail,
  savePartColor,
});
