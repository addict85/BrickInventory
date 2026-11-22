import { emit } from './events.js';
import { genuine, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { esc, html } from './escaping.js';
import { api } from './api.js';
import { ico, G, setHtml } from './dom.js';
import { amountForField } from './format.js';
import { amountFromField, quantityFromField, purchaseDateValid } from './form.js';
import { toast } from './messages.js';
import { accountCurrency, loggedInAccount, openSet } from './state.js';
import { closeModal, setQuantitiesField } from './detail-fields.js';
import { deleteFinal } from './deletion.js';
import { acqSummary, sumsText, convertedText, summary } from './purchase-price-display.js';
export { acquisitionPrice, renderAcquisitionSummary } from './purchase-price-display.js';
import { renderMarketRows } from './charts.js';
import { acquisition, saved, setWithFocus, isoTag, dateField, savedBrand, showSaved } from './entry-state.js';
// Purchase price modal and detail window for manual entries: both are capture, not administration, and
// therefore do not belong in admin.js.
/** @typedef {import('../../frontend-types/contract').HouseholdMember} Account */
/** @typedef {import('../../frontend-types/contract').AcquisitionTotals} AcquisitionSum */
/** @typedef {import('../../frontend-types/contract').Acquisition} Acquisition */

// ── PURCHASE PRICE MODAL ────────────────────────────────────────────────────
/**
 * @param {string} sn
 */
export function openAcqModal(sn) {
  acquisition.sn = sn;
  // Header
  G('acq-modal-tit').textContent = tRaw('detail.purchase_price');
  G('acq-modal-sub').textContent = sn + (openSet?.name ? ' – ' + openSet.name : '');
  setHtml(
    G('acq-modal-body'),
    html`<div data-style="color:var(--mut);font-size:var(--fs-2)">${tRaw('common.loading')}</div>`,
  );
  G('set-modal').classList.remove('open');
  saved.clear();
  G('acq-modal').classList.add('open');
  loadAcqModal(sn);
}

// A click on the background closes via closeAcqModal(), the only version with the return logic
// for set and manual entry.
G('acq-modal').addEventListener('click', e => e.target === e.currentTarget && closeAcqModal());

/**
 * Update the sum after every save: until reopening it stayed at the old value.
 * @param {string} sn
 */
async function refreshSum(sn) {
  const ad = await api('GET', `/v1/sets/${sn}/acquisitions`);
  if (!ad?.success || acquisition.sn !== sn) return;
  const price = G('acq-total-price'),
    quantity = G('acq-total-qty');
  if (price) price.textContent = sumsText(ad.totals);
  if (quantity) quantity.textContent = String(ad.totals?.quantity ?? 0);
  const hint = G('acq-sum-hint');
  if (hint) {
    hint.hidden = !ad.totals?.ohne_kurs;
    hint.textContent = ad.totals?.ohne_kurs ? tRaw('acq.without_rate', { n: ad.totals.ohne_kurs }) : '';
  }
  for (const a of ad.acquisitions || []) {
    const um = G(`acq-um-${a.id}`);
    if (um) um.textContent = convertedText(a, ad.totals);
  }
}

/**
 * @param {string} sn
 */
async function loadAcqModal(sn) {
  const ad = await api('GET', `/v1/sets/${sn}/acquisitions`);
  // A read error is not an empty list: otherwise "—" would stand there as if there were no acquisition.
  if (!ad.success) {
    toast(ad.error || tRaw('settings.error'), 'error');
    return;
  }
  const acqs = ad.acquisitions || [];
  if (!acquisition.members.length) {
    const hm = await api('GET', '/v1/sets/household-members');
    acquisition.members = hm?.members || [];
  }
  acquisition.owner = ad?.owner_user_id ?? loggedInAccount?.id ?? null;
  renderAcqModalBody(sn, acqs, ad?.totals);
}

/**
 * @param {string} sn
 * @param {Acquisition[]} acqs
 * @param {AcquisitionSum | undefined} totals
 */
export function renderAcqModalBody(sn, acqs, totals) {
  if (!acqs.length) {
    setHtml(
      G('acq-modal-body'),
      html`<div data-style="color:var(--mut);font-size:var(--fs-3);padding:.5rem 0">—</div>`,
    );
    return;
  }
  let markup = html`<div class="tw"><table class="dt acq-table" aria-label="${tRaw('detail.purchase_price')}">
    <thead>
      <tr>
        <th>${tRaw('detail.qty')}</th>
        <th>${tRaw('detail.added')}</th>
        <th>${tRaw('common.condition')}</th>
        <th class="number">${tRaw('detail.purchase_price')}</th>
        ${acquisition.members.length > 1 ? html`<th>${tRaw('household.owner')}</th>` : ''}
        <th><span class="vh">${tRaw('common.actions')}</span></th>
      </tr>
    </thead>
    <tbody>`;

  acqs.forEach(a => {
    const dateIso = isoTag(a.created_at);
    markup = html`${markup}${html`<tr id="acq-row-${a.id}">
      <td>
        <input class="acq-field acq-quantity" id="acq-quantity-${a.id}" inputmode="numeric" type="number" min="1" value="${a.quantity}" aria-label="${tRaw('detail.qty')}"
          data-blur="acqSave" data-arg="${sn}" data-arg2="${a.id}" data-arg3="qty" data-val="1"
          data-keydown="blurOnEnter" />
      </td>
      <td>${dateField(`id="acq-date-field-${a.id}" data-change="acqSave" data-arg="${esc(sn)}" data-arg2="${a.id}" data-arg3="date" data-val="1"`, dateIso, `acq-date-${a.id}`)}</td>
      <td>
        <select class="acq-field" aria-label="${tRaw('common.condition')}" data-change="acqSave" data-arg="${sn}" data-arg2="${a.id}" data-arg3="cond" data-val="1">
          <option value="N" ${a.condition !== 'U' ? 'selected' : ''}>${tRaw('common.condition_new')}</option>
          <option value="U" ${a.condition === 'U' ? 'selected' : ''}>${tRaw('common.condition_used')}</option>
        </select>
      </td>
      <td class="number">
        <span class="acq-price-field"><input class="acq-field acq-price" id="acq-price-${a.id}" type="text" inputmode="decimal" autocomplete="off" value="${amountForField(a.purchase_price)}" aria-label="${tRaw('detail.purchase_price')} (${a.currency || totals?.currency || accountCurrency})"
          data-blur="acqSave" data-arg="${sn}" data-arg2="${a.id}" data-arg3="price" data-val="1"
          data-keydown="blurOnEnter" /><span class="acq-currency" aria-hidden="true">${a.currency || totals?.currency || accountCurrency}</span></span>
        <span class="acq-converted" id="acq-um-${a.id}">${convertedText(a, totals)}</span>
      </td>
      ${
        acquisition.members.length > 1
          ? html`<td>
        <select class="acq-field" aria-label="${tRaw('household.owner')}" data-change="acqSave" data-arg="${sn}" data-arg2="${a.id}" data-arg3="owner" data-val="1">
          ${acquisition.members.map(m => html`<option value="${m.id}"${m.id === (a.owner_user_id ?? acquisition.owner) ? ' selected' : ''}>${m.username}</option>`)}
        </select>
      </td>`
          : ''
      }
      <td class="acq-action">
        ${savedBrand(a.id)}
        <button class="acq-delete" data-click="acqDelete"${genuine()} data-arg="${sn}" data-arg2="${a.id}"
          title="${tRaw('gallery.delete.title')}" aria-label="${tRaw('gallery.delete.title')}">${ico('delete')}</button>
      </td>
    </tr>`}`;
  });

  markup = html`${markup}${html`</tbody></table></div>`}`;

  // Sum row: the server computes it (acquisitionTotals in src/inventory/acquisitions.ts) and delivers it
  // as `totals`. Before, the calculation stood here and three more times elsewhere — twice in this file,
  // twice in the app, and with different price fields.
  markup = html`${markup}${acqSummary(totals)}`;

  setWithFocus(G('acq-modal-body'), markup);
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
    const price = amountFromField(`acq-price-${id}`);
    if (!price.ok) return;
    body.purchase_price = price.value;
  } else if (field === 'qty') {
    const quantity = quantityFromField(`acq-quantity-${id}`);
    if (!quantity.ok) return;
    body.quantity = quantity.value;
  } else if (field === 'date') {
    if (!purchaseDateValid(`acq-date-field-${id}`)) return;
    body.date = value;
  } else if (field === 'owner') {
    // An owner change moves exactly this purchase price row, without from_user_id: the server knows the
    // sender from the row. With the viewer as sender it did not find rows of sub-accounts (404).
    body.owner_user_id = parseInt(value, 10);
  } else {
    body.condition = value;
  }
  const d = await api('PUT', `/v1/sets/${sn}/acquisitions/${id}`, body);
  if (field === 'owner') {
    if (!d.success) {
      toast(d.error || t('settings.error'), 'error');
      loadAcqModal(sn);
      return;
    }
    // After a change almost everything on the screen is wrong: quantities, sums, owner badges.
    // Better reload than update four places individually.
    toast(
      tRaw(d.source_emptied ? 'household.move_ok' : 'household.owner_moved', {
        parts: d.parts ?? 0,
        figs: d.minifigs ?? 0,
      }),
      'success',
    );
    // restore: without it the user lands at page 1 again after the change; that way position and
    // loaded depth are kept.
    closeAcqModal();
    closeModal();
    emit('collectionLoad', { restore: true });
    return;
  }
  // The server delivers the recomputed condition aggregate along — write it directly into the gallery list,
  // so that the tile is right without reloading.
  emit('setAggregate', d.set);
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    if (field === 'date') loadAcqModal(sn); // reset rejected input to the stored value
    return;
  }
  showSaved(id);
  if (field === 'price') {
    const f = G(`acq-price-${id}`);
    if (f && f !== document.activeElement) f.value = amountForField(body.purchase_price);
  }
  refreshSum(sn);
  // fetch the market price rows anew.
  //
  // If a purchase price is captured in a condition for the first time, a NEW row arises for it (the server delivers
  // by_condition only for conditions with an acquisition). Without this reload it would only appear on the next
  // opening of the dialog.
  api('GET', `/v1/sets/${sn}/price-history`)
    .then(renderMarketRows)
    .catch(() => {});

  // Pull gallery and finances along: purchase price and quantity affect the tile and the evaluation, which would otherwise
  // stay old until reloading. restore, so that the change does not cost the scrolled depth.
  emit('collectionLoad', { restore: true });
  emit('financesLoad');

  // Date changed → reload order/summary
  if (field === 'date') {
    loadAcqModal(sn);
    api('GET', `/v1/sets/${sn}/acquisitions`)
      .then(ad => {
        if (ad?.success && openSet?.set_number === sn) {
          const summaryEl = G('m-acq-summary');
          if (summaryEl) setHtml(summaryEl, summary(ad.acquisitions, sn));
        }
      })
      .catch(() => {});
    return;
  }
  // If the price was empty, the server fetched the market price; reload to show it
  if (field === 'price' && (value === '' || value === null)) {
    loadAcqModal(sn);
    return;
  }
  // Update the summary in the detail dialog. The condition aggregate now comes from the PUT response
  // (applySetAggregate above) — here only the acquisition list is re-rendered.
  if (field === 'cond') {
    api('GET', `/v1/sets/${sn}/acquisitions`)
      .then(ad => {
        if (!ad?.success) return;
        const sumEl = G('m-acq-summary');
        if (sumEl) setHtml(sumEl, summary(ad.acquisitions, sn));
      })
      .catch(() => {});
  }
  // Quantity changed: reload the whole dialog (summary, quantity in the set detail)
  if (field === 'qty') {
    loadAcqModal(sn);
    // Refresh the summary in the set detail too
    api('GET', `/v1/sets/${sn}/acquisitions`)
      .then(ad => {
        if (ad.success && openSet?.set_number === sn) {
          const summaryEl = G('m-acq-summary');
          if (summaryEl) setHtml(summaryEl, summary(ad.acquisitions, sn));
        }
      })
      .catch(() => {});
    return;
  }
}

/**
 * @param {string} sn
 * @param {string} id
 */
async function acqDelete(sn, id) {
  const d = await deleteFinal({
    title: tRaw('acq.delete_title'),
    text: tRaw('acq.delete_text'),
    icon: 'delete',
    request: () => api('DELETE', `/v1/sets/${sn}/acquisitions/${id}`),
  });
  if (!d) return;
  // update openSet and the quantity field in the set detail
  if (openSet?.set_number === sn) {
    openSet.quantity = /** @type {number} */ (d.new_quantity);
    setQuantitiesField(openSet.quantity);
  }
  // reload the acquisition dialog
  const ad = await api('GET', `/v1/sets/${sn}/acquisitions`);
  // Only an empty list closes the dialog, not an error while reloading.
  if (!ad.success) {
    toast(ad.error || tRaw('settings.error'), 'error');
    return;
  }
  if (!ad.acquisitions?.length) {
    closeAcqModal();
    return;
  }
  renderAcqModalBody(sn, ad.acquisitions, ad.totals);
  // refresh the short overview in the set detail
  const dvEl = G('m-acq-summary');
  if (dvEl) setHtml(dvEl, summary(ad.acquisitions, sn));
  // As in acqSave(): a deleted acquisition changes inventory and value — and makes a condition row
  // disappear if it was the last one.
  api('GET', `/v1/sets/${sn}/price-history`)
    .then(renderMarketRows)
    .catch(() => {});
  emit('collectionLoad', { restore: true });
  emit('financesLoad');
}

export function closeAcqModal() {
  G('acq-modal').classList.remove('open');
  if (acquisition.back) {
    const back = acquisition.back;
    acquisition.back = null;
    back();
  } else if (acquisition.sn) {
    const sn = acquisition.sn;
    G('set-modal').classList.add('open');
    api('GET', `/v1/sets/${sn}/acquisitions`)
      .then(ad => {
        if (!ad?.success) return;
        const sumEl = G('m-acq-summary');
        // The rebuild replaces the button the dialog management returned the focus to; without this it would
        // afterwards be on the dialog surface.
        const active = document.activeElement;
        const hadFocus =
          !active || active === document.body || !!sumEl?.contains(active) || active.matches('#set-modal > .modal');
        if (sumEl) setHtml(sumEl, summary(ad.acquisitions, sn));
        if (hadFocus)
          /** @type {HTMLElement | null} */ (sumEl?.querySelector('[data-click="openAcqModal"]'))?.focus({
            preventScroll: true,
          });
        const total = ad.totals?.quantity ?? 0;
        if (total > 0) {
          setQuantitiesField(total);
          if (openSet) openSet.quantity = total;
        }
      })
      .catch(() => {});
  }
}

// ── Register handlers with the dispatcher (see js/registry.js) ─────────────
registerActions({
  acqDelete,
  acqSave,
  closeAcqModal,
  openAcqModal,
});
