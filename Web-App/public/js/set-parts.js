import { forgetManualItem } from './manual-detail.js';
import { detailRow, loadDisplay, rowsButton } from './components.js';
import { colorName, locale, t, tRaw } from '../i18n.js';
import { escHex, escJs, esc, html, joinHtml } from './escaping.js';
import { api } from './api.js';
import { imageTag, placeholderContent, fullUrl, imgUrl, thumbUrl, setDialogImage } from './images.js';
import { ico, G, setHtml } from './dom.js';
import { toast } from './messages.js';
import { scopeQuery } from './account-filter.js';
import { loadLocations, locationBlock, loadLocationSelection } from './detail-fields.js';
import { jumpTo } from './targets.js';
import { registerActions } from './registry.js';
// Detail dialog for parts and minifigs from sets: with zoom and the list of sets they occur in, without
// a market price and without an editable quantity — the quantity comes from the inventories. Same frame
// as openManDetail.
/** The sets a part or minifig occurs in, as a clickable list. @param {{ set_number: string, name?: string | null, set_name?: string | null, image_local?: string | null, image_url?: string | null, quantity?: number | null }[]} sets */
function usedInList(sets) {
  // The sets as a table (image, number, name) like in the Finances tab: as running text each name sat
  // somewhere else. Every row opens the set detail and closes this dialog, two open windows couldn't be closed.
  const setImage = (/** @type {{ image_local?: string | null, image_url?: string | null }} */ s) => {
    const small = thumbUrl(s.image_local || s.image_url) || s.image_local || s.image_url || '';
    return small
      ? imageTag({ src: imgUrl(small, true), orig: imgUrl(s.image_url || ''), alt: '', class: 'image-34', ph: 'set' })
      : html`<span class="image-ph image-34" aria-hidden="true">${placeholderContent('set')}</span>`;
  };
  return sets.length
    ? html`<table aria-label="${tRaw('setitem.used_in')}" data-style="width:100%;border-collapse:collapse"><tbody>${sets.map(
        s => html`
        <tr>
          <td data-style="width:34px;padding:4px 8px 4px 0">${setImage(s)}</td>
          <td data-style="width:1%;white-space:nowrap;padding:4px 10px 4px 0;font-family:var(--mono);font-size:var(--fs-1);color:var(--b600)">${rowsButton({ click: 'openSetFromItem', arg: s.set_number }, s.set_number, tRaw('row.open', { name: s.set_name || s.set_number, nr: s.set_number }))}</td>
          <td data-style="padding:4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0">${s.set_name || ''}</td>
          <td data-style="width:1%;white-space:nowrap;padding:4px 0 4px 10px;text-align:right;color:var(--mut);font-size:var(--fs-1)">×${(s.quantity || 0).toLocaleString(locale())}</td>
        </tr>`,
      )}</tbody></table>`
    : html`<span data-style="color:var(--mut);font-size:var(--fs-2)">${t('setitem.used_in_none')}</span>`;
}

/**
 * @param {string} type
 * @param {string} id
 * @param {string | number} colorId
 */
export async function openSetItemDetail(type, id, colorId) {
  const color = parseInt(String(colorId), 10) || 0;
  forgetManualItem();
  const modal = G('setitem-modal');
  const bodyEl = G('setitem-body');
  const imgEl = G('setitem-img');

  G('setitem-tit').textContent = id;
  G('setitem-sub').textContent = '';
  imgEl.style.display = 'none';
  setHtml(bodyEl, loadDisplay('', { style: 'padding:1rem' }));
  modal.classList.add('open');

  // Pass the account scope along as everywhere: in a household, the sibling account's set belongs too.
  // scopeQuery() appended, not in the path, so test/frontend-api-paths.test.js can read the address.
  const url =
    (type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/sets`
      : `/v1/parts/${encodeURIComponent(id)}/${color}/sets`) + scopeQuery(type === 'fig' ? 'minifigs' : 'parts');
  const d = await api('GET', url);
  // Closed in the meantime? Then nothing more gets written in.
  if (!modal.classList.contains('open')) return;

  const item = d?.item || null;
  const sets = d?.sets || [];

  G('setitem-tit').textContent = item?.name || id;
  G('setitem-sub').textContent = id + (item?.color_name ? ' · ' + colorName(item.color_name) : '');

  // Image as in the manual dialog: through the server proxy at full resolution. data-orig feeds the zoom
  // (openImageLightboxFromEl in actions.js) — without this attribute there would be no zooming, and that
  // was exactly part of what was asked for.
  const raw = item?.image_local || item?.image_url || '';
  const full = raw ? imgUrl(fullUrl(raw), false) : '';
  if (full) {
    setDialogImage(imgEl, full, full);
    imgEl.style.display = '';
  } else {
    imgEl.style.display = 'none';
  }

  const rows = [];
  // Quantity for display only: it comes from the sets' inventories. toLocaleString as on the parts tile —
  // fmtN() is the money formatter and turned 6 into "EUR 6.00×".
  rows.push(
    detailRow(
      t('setitem.total_qty'),
      html`<span data-style="font-family:var(--mono);font-weight:600">×${String((item?.total_quantity || 0).toLocaleString(locale()) ?? '')}</span>`,
    ),
  );

  if (type === 'part' && item?.color_name) {
    const dot = item.color_hex
      ? html`<span data-style="display:inline-block;width:12px;height:12px;border-radius:50%;border:1px solid rgba(0,0,0,.15);margin-right:4px;vertical-align:middle" data-color-hex="${escHex(item.color_hex, 'var(--s300)')}"></span>`
      : '';
    rows.push(detailRow(t('parts.color_label'), `${dot}${esc(colorName(item.color_name))}`));
  }
  if (item?.category_name) rows.push(detailRow(t('setitem.category'), esc(item.category_name)));
  if (item?.is_spare) rows.push(detailRow(t('parts.spare_tag'), ico('ok')));

  // Storage location for parts only: a minifig sits in its set, whose location is in the set detail. The
  // field writes to every row of the part/color pair, because it means the part, not one of its rows.
  if (type === 'part') {
    // The location list belongs to the owner, as with a set. owner_ids instead of owners, because grouped
    // part rows carry no owner badge.
    loadLocationSelection(item?.owner_ids).catch(() => {});
    rows.push(
      detailRow(
        t('detail.storage'),
        locationBlock(
          'setitem-storage',
          item?.storage,
          `data-change="savePartLocation" data-entry-type="part" data-part="${escJs(id)}" data-color="${color}" ` +
            `data-owners="${esc((item?.owner_ids || []).join(','))}"`,
        ),
        { valueStyle: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end' },
      ),
    );
  }

  const list = usedInList(sets);
  // The table sits below the label (flex-direction:column): in the .dr row it slid next to "Used in" with
  // a single set, and the image touched the text.
  rows.push(
    detailRow(t('setitem.used_in'), list, {
      rowsStyle: 'flex-direction:column;align-items:stretch;gap:4px',
      valueStyle: 'flex-direction:column;align-items:stretch;gap:0;min-width:0',
    }),
  );

  setHtml(bodyEl, joinHtml(rows));
}

/**
 * Save a part's or minifig's storage location, on leaving the field (otherwise an intermediate state per
 * keystroke). `this` instead of a fixed id, because two dialogs share this handler.
 * @this {unknown}
 */
async function savePartLocation() {
  const el = this instanceof HTMLInputElement ? this : G('setitem-storage');
  if (!el) return;
  const number = el.dataset.part ?? '';
  const color = parseInt(el.dataset.color ?? '', 10) || 0;
  const url =
    el.dataset.entryType === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(number)}/storage`
      : `/v1/parts/${encodeURIComponent(number)}/${color}/storage`;
  const d = await api('PUT', url, { storage: el.value });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  await loadLocations();
  // A freshly typed location is now in the stock list — without this it would sit on the part but be
  // missing from the list it's chosen from next time.
  await loadLocationSelection(el.dataset.owners ? el.dataset.owners.split(',').map(Number) : []);
}

function closeSetItemDetail() {
  G('setitem-modal').classList.remove('open');
}
G('setitem-modal').addEventListener('click', e => e.target === e.currentTarget && closeSetItemDetail());

/**
 * From the part dialog to the set detail — one closes, the other opens.
 * @param {string} setNumber
 */
function openSetFromItem(setNumber) {
  closeSetItemDetail();
  jumpTo('setDetail', setNumber);
}

registerActions({
  openSetFromItem,
  openSetItemDetail,
  closeSetItemDetail,
  savePartLocation,
});
