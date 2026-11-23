// The set detail dialog: display, quantity, instructions, image zoom. It sits above the gallery and
// the acquisition dialog; code that must open it from elsewhere uses jumpTo('setDetail', …) from targets.js.
import { emit } from './events.js';
import { registerTarget } from './targets.js';
import { registerActions, genuine } from './registry.js';
import { accountCurrency, loggedInAccount, gallerySets, openSet, setOpenSet } from './state.js';
import { escJs, esc, html, safeUrl, rawHtml } from './escaping.js';
import { api } from './api.js';
import { fullUrl, setDialogImage, PLACEHOLDER_SET } from './images.js';
import { G, ico, activeTab, setHtml, newTabHint } from './dom.js';
import { fmtDate, fmtMoney } from './format.js';
import { reportAtField, toast, discardToasts } from './messages.js';
import { deletedWithUndo } from './trash.js';
import {
  alertBlock,
  closeModal,
  loadAlert,
  loadLocationSelection,
  locationBlock,
  setAlertField,
  setQuantitiesField,
} from './detail-fields.js';
import { deleteFinal } from './deletion.js';
import { delSet, reimportParts } from './collection.js';
import { detailRow, accountDisplay, orStroke, skeletonRows, openCapture } from './components.js';
import { chartWidth, priceChartSVG, renderMarketRows } from './charts.js';
import { locale, t, tRaw } from '../i18n.js';
import { openAcqModal, renderAcqModalBody } from './purchase-dialogs.js';
import { summary, renderAcquisitionSummary } from './purchase-price-display.js';

// Moving happens only per acquisition (the acquisition dialog, row by row), never for a whole set:
// several acquisitions of one set in a household can belong to different accounts. The server needs
// acquisition_ids for that.
let _detailRun = 0;

/** Accounts this account may write to (server: household members); null = not loaded yet.
 * @type {number[] | null} */
let _writableAccounts = null;

/** In a household: does the set (also) belong to another account? @param {import('../../frontend-types/contract').SetItem | null} set */
const inHousehold = set => (set?.owners || []).some(o => !loggedInAccount || o.id !== loggedInAccount.id);

/** A name for the UI: the logged-in account is called "me". @param {{ id: number, username: string }} o */
const accountName = accountDisplay;

/**
 * Quantity per account from the acquisitions; the own account first. In a household each account
 * has its own stepper: a single total with "−" silently removed the own account's purchase even
 * when the other one's was meant.
 * @param {import('../../frontend-types/contract').SetItem} set @param {import('../../frontend-types/contract').Acquisition[]} acqs
 */
function quantitiesByAccount(set, acqs) {
  const owners = set.owners?.length
    ? set.owners
    : loggedInAccount
      ? [{ id: loggedInAccount.id, username: loggedInAccount.username }]
      : [];
  return owners
    .map(o => ({
      ...o,
      quantity: acqs
        .filter(a => (a.owner_user_id ?? loggedInAccount?.id) === o.id)
        .reduce((s, a) => s + (a.quantity || 0), 0),
    }))
    .sort((a, b) => Number(b.id === loggedInAccount?.id) - Number(a.id === loggedInAccount?.id));
}

/**
 * Without a household, the plain field; in a household, one row per account (stepper only where
 * writing is allowed). "−" on the very last copy of the whole set is missing on purpose: that is a
 * delete and goes through the "Delete" action.
 * @param {import('../../frontend-types/contract').SetItem} set @param {import('../../frontend-types/contract').Acquisition[]} acqs
 */
function quantityBlock(set, acqs) {
  if (!inHousehold(set))
    return html`<span class="quantity-stepper" data-feedback>
      <button class="btn bs btn-sm detail-button quantity-button" id="m-qty-dec" data-click="mQtyDec" aria-label="${tRaw('detail.qty_less')}">−</button>
      <input inputmode="numeric" type="number" id="m-qty" min="1" class="detail-field quantity-field" aria-label="${tRaw('detail.qty')}" data-change="autosaveSet" />
      <button class="btn bs btn-sm detail-button quantity-button" data-click="mQtyInc" aria-label="${tRaw('detail.qty_more')}">+</button>
      <span class="field-status" role="status"></span><span class="vh" id="m-qty-last">${tRaw('detail.qty_last')}</span></span>`;
  const accounts = quantitiesByAccount(set, acqs);
  const total = accounts.reduce((s, k) => s + k.quantity, 0);
  const rows = accounts.map(k => {
    const allowed = !_writableAccounts || _writableAccounts.includes(k.id);
    const name = accountName(k);
    const button = (/** @type {number} */ step, /** @type {string} */ symbol, /** @type {string} */ label) =>
      html`<button class="btn bs btn-sm detail-button quantity-button" data-click="quantityPerAccount" data-arg="${k.id}" data-arg2="${step}" aria-label="${tRaw(label)}: ${name}"${step < 0 && (k.quantity === 0 || total <= 1) ? html` disabled title="${tRaw(total <= 1 ? 'detail.qty_last' : 'detail.qty_less')}"` : ''}>${symbol}</button>`;
    return html`<div class="quantity-account" data-account="${k.id}">
      <span class="quantity-name">${name}</span>
      ${allowed ? button(-1, '−', 'detail.qty_less') : ''}<output class="quantity-number" aria-label="${tRaw('detail.qty')}: ${name}">${k.quantity}</output>${allowed ? button(1, '+', 'detail.qty_more') : ''}
    </div>`;
  });
  return html`<div class="quantity-accounts" data-feedback>${rows}
    <div class="quantity-total">${tRaw('detail.qty_together', { n: total })}</div>
    <span class="field-status" role="status"></span></div>`;
}

/** Header line: number and, in a household, ALL owners — naming only the other account read as if
 * the set belonged to them alone. @param {import('../../frontend-types/contract').SetItem} set */
function subtitle(set) {
  const owners = inHousehold(set)
    ? (set.owners || [])
        .slice()
        .sort((a, b) => Number(b.id === loggedInAccount?.id) - Number(a.id === loggedInAccount?.id))
    : [];
  // Only the set number in fixed width; the owners are plain flowing text like everywhere else.
  const nr = set.name ? html`<span class="setnr">${set.set_number}</span>` : '';
  const who = owners.length
    ? tRaw(owners.length > 1 ? 'detail.accounts_of' : 'detail.account_of', {
        names: owners.map(accountName).join(', '),
      })
    : '';
  return html`${nr}${nr && who ? ' · ' : ''}${who}`;
}

const PAIR = { pair: true };

/** Content of the set dialog from openSet and the acquisitions: value and history to the left under
 * the image, the fields on the right. @param {string} sn @param {import('../../frontend-types/contract').Acquisition[]} acqs */
function setDetailHtml(sn, acqs) {
  const set = openSet;
  if (!set) return null;
  const addedFmt = set.added_at ? fmtDate(set.added_at) : '—';
  // Market price and its movement per condition, from the same query as the price history; here only
  // the placeholder. A single value for the whole set mixed new and used.
  const priceRow = html`<div class="m-value-header" id="m-market-rows" data-header="1" role="group" aria-label="${tRaw('detail.value')}"><div class="skeleton-row"></div><div class="skeleton-row short"></div></div>`;
  const pnlRow = '';
  const qtyRow = detailRow(t('detail.qty'), quantityBlock(set, acqs), {
    rowsStyle: 'align-items:flex-start',
    valueId: 'm-quantity',
    pair: true,
  });

  // Acquisition summary: compact read-only rows + button to open full editor
  const acqRows = detailRow(
    t('detail.purchase_price'),
    html`
      ${renderAcquisitionSummary(acqs, sn)}
      <button class="btn bs btn-sm detail-button" data-click="openAcqModal" data-arg="${sn}">${ico('edit')} ${tRaw('detail.edit_prices')}</button>
    `,
    {
      rowsStyle: 'align-items:flex-start',
      valueId: 'm-acq-summary',
      valueStyle: 'flex-direction:column;align-items:flex-end;gap:3px',
      pair: true,
    },
  );

  const left = html`${priceRow}${pnlRow}
    <div id="m-price-chart">
      <h3 class="area-title" data-style="margin-bottom:4px">${tRaw('detail.price_history')}</h3>
      <div class="sparkline-wrap" id="m-sparkline-content"><span data-style="color:var(--mut);font-size:var(--fs-1)">${tRaw('common.loading')}</span></div>
    </div>`;
  // The minifig count comes from the catalog, same as in the table: the own minifig list only counts
  // what a parts import has taken over, and showed a different number for the same set.
  const right = html`<dl>
    ${acqRows}
    ${detailRow(t('detail.year'), orStroke(set.year), PAIR)}
    ${detailRow(t('detail.theme'), esc(orStroke(set.theme)), PAIR)}
    ${qtyRow}
    ${detailRow(t('detail.pieces'), set.pieces ? set.pieces.toLocaleString(locale()) : '—', PAIR)}
    ${detailRow(t('detail.minifigs'), orStroke(set.minifigs), { valueId: 'm-minifigs-val', pair: true })}
    ${detailRow(
      t('detail.alert'),
      alertBlock(sn, 'm', (openSet?.conditions || []).includes('N') || !(openSet?.conditions || []).length ? 'N' : 'U'),
      {
        class: 'alert-row',
        pair: true,
        rowsStyle: 'align-items:flex-start',
        valueStyle: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end',
      },
    )}
    ${detailRow(
      t('detail.storage'),
      html`${locationBlock('m-storage', set.storage, `data-change="saveSetLocation" data-arg="${escJs(sn)}"`)}<button type="button" class="close-view" data-click="viewFromDialog" data-arg="locations">${tRaw('detail.locations_manage')}</button>`,
      { valueStyle: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end', pair: true },
    )}
    ${detailRow(
      t('detail.created'),
      html`${ico('calendar')} ${addedFmt} <span class="text-small">(${tRaw('detail.created_hint')})</span>`,
      { class: 'dr-quiet', pair: true },
    )}</dl>`;
  return { links: left, right: right };
}

/** Load the price history in the background, without holding up the dialog.
 * @param {string} sn @param {import('../../frontend-types/contract').Acquisition[]} acqs */
function loadSetFollowups(sn, acqs) {
  const prices = (/** @type {string} */ z) =>
    new Set(acqs.filter(a => a.condition === z && a.purchase_price != null).map(a => a.unit_price ?? a.purchase_price));
  const multi = new Set(['N', 'U'].filter(z => prices(z).size > 1));
  // The answer can arrive after closing or after switching sets; then it no longer belongs in the dialog.
  api('GET', `/v2/sets/${sn}/price-history`).then(ph => {
    if (!openSet || openSet.set_number !== sn) return;
    renderMarketRows(ph);
    const el = G('m-sparkline-content');
    if (!el) return;
    // Both conditions in ONE chart — see priceChartSVG().
    setHtml(
      el,
      ph.success
        ? priceChartSVG(ph, sn.replace(/[^a-zA-Z0-9]/g, ''), chartWidth(el), multi)
        : html`<span data-style="color:var(--mut);font-size:var(--fs-1)">${tRaw(ph.networkError ? 'chart.offline' : 'detail.no_history')}</span>`,
    );
  });
}

/** Usually a link to a set that is (not yet) in this account: say so and offer to add it.
 * @param {import('../../frontend-types/api').ApiResponse<'GET', `/v2/sets/${string}`>} d @param {string} sn */
function detailFailed(d, sn) {
  if (d?.status !== 404) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  discardToasts();
  toast(tRaw('detail.not_in_collection', { nr: sn }), 'info', {
    text: tRaw('detail.now_add'),
    fn: () => {
      openCapture('set');
      const f = G('add-num');
      if (f) {
        f.value = sn;
        f.focus();
      }
    },
  });
}

/**
 * @param {string} sn
 */
export async function openModal(sn) {
  const run = ++_detailRun;
  // The dialog appears right away, with a placeholder: on a slow connection nothing happened until
  // the answer arrived, and a second tap opened it twice.
  G('m-tit').textContent = sn;
  G('m-subtitle').textContent = '';
  setDialogImage(G('m-img'), PLACEHOLDER_SET, PLACEHOLDER_SET);
  setHtml(G('m-det'), skeletonRows(4, tRaw('common.loading')));
  G('m-det-links')?.replaceChildren();
  G('m-instr').replaceChildren();
  G('set-modal').dataset.number = sn;
  G('set-modal').classList.add('open');
  const [d, ad, hm] = await Promise.all([
    api('GET', `/v2/sets/${sn}`),
    api('GET', `/v2/sets/${sn}/acquisitions`),
    _writableAccounts ? null : api('GET', '/v2/sets/household-members'),
  ]);
  if (hm?.success) _writableAccounts = hm.members.map(m => m.id);
  // Closed or another set opened in the meantime: draw nothing further.
  if (run !== _detailRun || !G('set-modal').classList.contains('open')) return;
  // Without a connection, the dialog shows what the collection has already loaded instead of not opening at all.
  const fromCache = !d?.success && d?.networkError ? gallerySets.find(x => x.set_number === sn) : undefined;
  if (fromCache) toast(tRaw('detail.offline_status'), 'info');
  if (!d?.success && !fromCache) {
    G('set-modal').classList.remove('open');
    detailFailed(d, sn);
    return;
  }
  const set = d?.success ? d.set : fromCache;
  if (!set) return;
  setOpenSet(set);
  document.querySelector('#set-modal .more-menu')?.removeAttribute('open');
  G('m-tit').textContent = set.name || set.set_number;
  setHtml(G('m-subtitle'), subtitle(set));
  // fullUrl(): full resolution, even when image_local points at the _thumb file
  const img = G('m-img');
  setDialogImage(img, fullUrl(set.image_local || set.image_url) || PLACEHOLDER_SET, PLACEHOLDER_SET);
  img.style.display = 'block';

  const content = setDetailHtml(sn, ad?.acquisitions || []);
  setHtml(G('m-det-links'), content ? content.links : '');
  setHtml(G('m-det'), content ? content.right : '');

  setQuantitiesField(set.quantity);

  renderInstructions(set.instructions || [], sn);
  // From here on, the alert handlers mean THIS dialog.
  setAlertField('m');
  G('set-modal').classList.add('open');
  loadAlert(sn).catch(() => {});
  // The storage-location list belongs to the set's OWNER, not the viewer — see loadLocationSelection() for why.
  loadLocationSelection(set.owners).catch(() => {});

  loadSetFollowups(sn, ad?.acquisitions || []);
}

/** From "more actions" in set detail: the currently open set. */
function reimportOpenSetParts() {
  if (openSet?.set_number) reimportParts(openSet.set_number);
}

/** @param {import('../../frontend-types/contract').Instruction[]} instr @param {string} sn */
export function renderInstructions(instr, sn) {
  const items = instr
    .map(i => {
      const href = i.local_path || i.url;
      const isLocal = !!i.local_path;
      // Uploaded by hand or imported automatically? The server says so (is_manual, see
      // mergeInstructions in src/catalog/instructions.ts). Previously the rule lived here as a
      // path comparison — a second version of the same question that the Android app could not rebuild at all.
      const isUpload = !!i.is_manual;
      const label = esc(i.description) || t('instr.label');
      // Local files (PDF/image) open in the in-app viewer; external URLs open in a new tab.
      const link = isLocal
        ? html`<a href="${safeUrl(href)}" data-click="openPdfViewerLink" data-arg="${href}" data-arg2="${i.description || ''}" data-style="cursor:pointer">${rawHtml(label)}</a>`
        : html`<a href="${safeUrl(href)}" target="_blank" rel="noopener">${rawHtml(label)}${newTabHint()}</a>`;
      // The kind as text, not only as colour or icon: “manual” can be deleted, the other two cannot.
      const kind = isUpload ? 'manual' : isLocal ? 'local' : 'external';
      const badgeIco = isUpload ? 'file' : isLocal ? 'save' : 'globe';
      return html`<div class="ii" id="instr-${i.id}">
      ${link}
      <span class="ii-kind ii-kind-${kind}">${ico(badgeIco)}<span>${tRaw(`instr.badge_${kind}`)}</span></span>
      ${isUpload ? html`<button type="button" class="ii-remove" data-click="delInstr"${genuine()} data-arg="${sn}" data-arg2="${i.id}" title="${tRaw('instr.delete_tooltip')}" aria-label="${tRaw('instr.delete_tooltip')}">${ico('delete')}</button>` : ''}
    </div>`;
    })
    .join('');

  const uploadForm = html`
    <div id="instr-upload-form" data-style="margin-top:10px;padding:10px;background:var(--s50);border:1px dashed var(--bdr);border-radius:8px">
      <div data-style="font-size:var(--fs-1);font-weight:600;color:var(--mut);margin-bottom:7px">${tRaw('instr.upload_title')}</div>
      <div data-style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
        <div data-style="flex:1;min-width:140px">
          <label for="instr-desc" class="field-title-small">${tRaw('instr.desc_placeholder')}</label>
          <input type="text" id="instr-desc" />
        </div>
        <label class="btn bs btn-sm cursor-pointer">
          ${ico('file')} ${tRaw('instr.choose_file')}
          <input type="file" id="instr-file" accept=".pdf,.jpg,.jpeg,.png" class="file-hidden" data-change="uploadInstr" data-arg="${sn}" />
        </label>
      </div>
      <div id="instr-upload-status" role="status" data-style="font-size:var(--fs-1);margin-top:6px;color:var(--mut)"></div>
    </div>`;

  setHtml(
    G('m-instr'),
    html`
    <div class="row flex-wrap items-center" data-style="margin:12px 0 7px;gap:8px">
      <h3 class="area-title" data-style="margin:0">${tRaw('instr.section_title')} ${instr.length ? html`(${instr.length})` : ''}</h3>
      ${loggedInAccount?.isAdmin || !instr.some(i => !i.is_manual) ? html`<button data-click="redownloadInstr" data-arg="${sn}" class="btn bs btn-sm" data-style="margin-left:8px;font-size:var(--fs-0);padding:3px 8px">${tRaw('instr.reload')}</button>` : ''}
    </div>
    ${items ? rawHtml(items) : html`<div data-style="color:var(--mut);font-size:var(--fs-2)">${tRaw('instr.none_auto')}</div>`}
    ${uploadForm}`,
  );
}

/** @param {string} sn @param {string} instrId */
async function delInstr(sn, instrId) {
  const d = await deleteFinal({
    title: tRaw('instr.delete_title'),
    text: tRaw('instr.delete_text'),
    icon: 'file',
    request: () => api('DELETE', `/v2/sets/${sn}/instructions/${instrId}`),
  });
  if (!d) return;
  toast(tRaw('instr.deleted'), 'success');
  openModal(sn);
}

/**
 * @param {string} sn
 */
async function uploadInstr(sn) {
  const fi = G('instr-file');
  const file = fi.files?.[0];
  if (!file) return;
  const status = G('instr-upload-status');
  status.textContent = tRaw('common.uploading');
  const fd = new FormData();
  fd.append('file', file);
  const desc = G('instr-desc').value.trim();
  if (desc) fd.append('description', desc);
  try {
    const d = await api('POST', `/v2/sets/${sn}/instructions/upload`, fd);
    if (d.success) {
      toast(tRaw('instr.uploaded'), 'success');
      openModal(sn);
    } else {
      status.textContent = d.error || tRaw('settings.error');
      status.style.color = 'var(--r500)';
    }
  } catch {
    status.textContent = tRaw('common.network_error');
  }
}

/** @param {string} src @param {string} [name] what the image shows — without it a screen reader heard only "Close" */
export function openImageLightbox(src, name = '') {
  if (!src || src.endsWith('/assets/set-placeholder.svg')) return;
  G('lightbox-img').src = src;
  G('lightbox-img').setAttribute('alt', name || tRaw('common.image'));
  G('img-lightbox').classList.add('open');
}

// `removeAttribute`, NOT `src=''`: an empty src is not an empty address, it is the address of the
// PAGE. The browser loads it as an image, fails, and the error listener in actions.js reported on
// every close of the zoom `[img] could not load: https://<host>/`. Without the attribute the
// browser loads nothing at all.
export function closeImageLightbox() {
  G('img-lightbox').classList.remove('open');
  G('lightbox-img').removeAttribute('src');
}

// Escape closes the zoom via js/dialogs.js, like every dialog.
G('set-modal').addEventListener('click', e => e.target === e.currentTarget && closeModal());

/** @type {number | null} */
let _autosaveTimer = null;
/** The quantity change not yet saved; null when nothing is pending. @type {(() => void) | null} */
let _pendingQuantitySave = null;

/** Save right away when closing: the dialog forgets openSet, and a change 400 ms after "−" was
 * closed got lost. Observed instead of hooked into every close path (button, Esc, backdrop,
 * acquisition dialog). */
function saveQuantityNow() {
  if (_autosaveTimer !== null) clearTimeout(_autosaveTimer);
  _autosaveTimer = null;
  _pendingQuantitySave?.();
}
if (typeof MutationObserver === 'function')
  new MutationObserver(() => {
    if (!G('set-modal').classList.contains('open')) saveQuantityNow();
  }).observe(G('set-modal'), { attributes: true, attributeFilter: ['class'] });

export function autosaveSet() {
  if (!openSet) return;
  setQuantitiesField();
  if (_autosaveTimer !== null) clearTimeout(_autosaveTimer);
  const set = openSet;
  _pendingQuantitySave = () => {
    _pendingQuantitySave = null;
    const qty = parseInt(G('m-qty').value, 10) || 1;
    changeQuantity({ quantity: qty }, qty - (set.quantity || qty), G('m-qty'), set);
  };
  _autosaveTimer = setTimeout(saveQuantityNow, 400);
}

/** The stepper of one account in a household: a single step, relative, for exactly this account.
 * @param {string} account @param {string} step */
function quantityPerAccount(account, step) {
  const id = Number(account),
    n = Number(step);
  if (!openSet || !Number.isInteger(id) || !n) return;
  const button = document.querySelector(`#m-quantity [data-account="${id}"] [data-arg2="${n}"]`);
  changeQuantity({ quantity_delta: n, ...(id === loggedInAccount?.id ? {} : { owner_user_id: id }) }, n, button);
}

/**
 * Save, then reload everything in the detail that depends on quantity (stepper, acquisition prices,
 * the value header with gains/losses, and the acquisition line in the chart). A decrease names the
 * acquisition that went away and offers Undo like a delete; an increase names the estimated price.
 * @param {{ quantity?: number, quantity_delta?: number, owner_user_id?: number }} body @param {number} step
 * @param {Element | null} field @param {import('./state.js').Tile | null} [set] the set, even if the dialog is already closed
 */
async function changeQuantity(body, step, field, set = openSet) {
  if (!set || !step) return;
  const sn = set.set_number;
  const d = await api('PUT', `/v2/sets/${esc(sn)}`, body);
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  // Saved, but without a market price for the new acquisition: it follows with the price job.
  if (d.degraded?.includes('purchase-price')) toast(tRaw('set.purchase_price_follows'), 'info');
  if (d.dropped?.length) reportRemovedPurchase(sn, d, body.owner_user_id);
  const ad = await refreshDetail(sn, field);
  if (step > 0 && ad) reportNewCopies(sn, ad.acquisitions, step);
  emit('collectionLoad');
  if (activeTab() === 'finance') emit('financesLoad');
}

/** "Purchase from 09/13/2026 (€250.00) removed" with Undo; the acquisition sits in the trash.
 * @param {string} sn @param {import('../../frontend-types/contract').QuantityChanged} d @param {number} [accountId] */
function reportRemovedPurchase(sn, d, accountId) {
  const removed = d.dropped || [];
  const k = removed[0];
  const price = k?.purchase_price != null ? ` (${fmtMoney(k.purchase_price, k.currency || accountCurrency)})` : '';
  const owner = accountId ? (openSet?.owners || []).find(o => o.id === accountId) : null;
  const text =
    removed.length === 1 && k
      ? tRaw('detail.purchase_removed', { date: fmtDate(k.date || ''), price })
      : tRaw('detail.purchases_removed', { n: removed.length });
  const ids = typeof d.trash === 'number' ? [d.trash] : d.trash || [];
  deletedWithUndo(owner ? `${text} · ${accountName(owner)}` : text, { trash: ids }, () => {
    if (openSet?.set_number === sn) refreshDetail(sn, null);
  });
}

/**
 * Re-fetch the set and its acquisitions, and redraw the quantity block, the acquisition prices, the
 * header line and the value header with its chart. Focus stays on the pressed button, the feedback
 * sits at the field.
 * @param {string} sn @param {Element | null} field
 */
async function refreshDetail(sn, field) {
  const [d, ad] = await Promise.all([
    api('GET', `/v2/sets/${esc(sn)}`),
    api('GET', `/v2/sets/${esc(sn)}/acquisitions`),
  ]);
  if (!d?.success || !d.set || openSet?.set_number !== sn || !G('set-modal').classList.contains('open')) return ad;
  setOpenSet(d.set);
  const acqs = ad?.acquisitions || [];
  const focused = field && field === document.activeElement ? field : null;
  const quantityEl = G('m-quantity');
  if (quantityEl) setHtml(quantityEl, quantityBlock(d.set, acqs));
  const newField = G('m-qty');
  setQuantitiesField(d.set.quantity);
  const sumEl = G('m-acq-summary');
  if (sumEl) setHtml(sumEl, summary(acqs, sn));
  if (G('acq-modal').classList.contains('open')) renderAcqModalBody(sn, acqs, ad?.totals);
  setHtml(G('m-subtitle'), subtitle(d.set));
  // The pressed button has been replaced; focus goes to its successor, or, if that is disabled (last
  // "−"), to "+".
  const accountId = field instanceof HTMLElement ? field.dataset.arg : undefined;
  const buttons = accountId ? [...(quantityEl?.querySelectorAll(`[data-arg="${accountId}"]`) || [])] : [];
  const target =
    field?.id === 'm-qty'
      ? newField
      : (buttons.find(
          k =>
            k instanceof HTMLElement &&
            k.dataset.arg2 === /** @type {HTMLElement} */ (field).dataset.arg2 &&
            !k.hasAttribute('disabled'),
        ) ??
        buttons.find(k => !k.hasAttribute('disabled')) ??
        null);
  if (focused && target instanceof HTMLElement) target.focus({ preventScroll: true });
  reportAtField(target || quantityEl?.querySelector('[data-feedback]'));
  loadSetFollowups(sn, acqs);
  return ad;
}

/**
 * "+" creates an acquisition, usually with the market price as an estimate. That changes the
 * finances, so the toast says so with the amount and offers "Change" instead of only reporting "Saved".
 * @param {string} sn @param {import('../../frontend-types/contract').Acquisition[] | null | undefined} acqs @param {number} n
 */
function reportNewCopies(sn, acqs, n) {
  const latest = [...(acqs || [])].sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  const price = latest?.purchase_price;
  const plural = n > 1 ? 'copies' : 'copy';
  const text =
    price != null && latest.price_estimated
      ? tRaw(`acq.${plural}_estimated`, { n, price: fmtMoney(price, latest.currency || accountCurrency) })
      : price == null
        ? tRaw(`acq.${plural}_without_price`, { n })
        : tRaw('settings.saved');
  toast(text, 'success', { text: tRaw('acq.change'), fn: () => openAcqModal(sn) });
}

// No separate confirmation here anymore — delSet() asks (see there). The dialog closes only on an
// actual delete; otherwise it would state empty after a "Cancel".
G('btn-md').onclick = async () => {
  if (!openSet) return;
  if (await delSet(openSet.set_number)) closeModal();
};

/**
 * @param {string} sn
 */
async function redownloadInstr(sn) {
  toast(tRaw('instr.loading'), 'info');
  const d = await api('POST', `/v2/sets/${sn}/instructions`);
  if (d.success) {
    if (!d.job_id) toast(tRaw('instr.loaded', { count: d.instructions.length }), 'success');
    if (openSet) {
      openModal(sn);
    }
    emit('metricsLoad');
  } else toast(d.error, 'error');
}

registerTarget({ setDetail: openModal });

// Names below are registry-exposed (data-click/data-change in index.html, or connection.js) — kept unchanged.
registerActions({
  reimportOpenSetParts,
  autosaveSet,
  quantityPerAccount,
  closeImageLightbox,
  delInstr,
  redownloadInstr,
  uploadInstr,
  openModal,
});
