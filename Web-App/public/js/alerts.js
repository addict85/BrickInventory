import { genuine, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { api } from './api.js';
import { imageTag, placeholderContent, imgUrl, thumbUrl } from './images.js';
import { ico, G, setHtml } from './dom.js';
import { fmtN, readAmount, amountForField } from './format.js';
import { fieldError } from './form.js';
import { toast } from './messages.js';
import { uploadCsv } from './components.js';
import { deleteRestorable } from './deletion.js';
import { gallerySets } from './state.js';
import { esc, html, rawHtml } from './escaping.js';
// Settings, price alerts section: overview, change threshold, delete, CSV import.

/** A price alert created directly from the overview, without going via the set. */
async function createAlert() {
  const raw = String(G('alert-new-set')?.value || '').trim();
  const sn = /^\d+$/.test(raw) ? raw + '-1' : raw;
  const threshold = readAmount(G('alert-new-price')?.value);
  if (!sn) {
    fieldError('alert-new-set', tRaw('alerts.new_set_missing'));
    return;
  }
  if (!(Number(threshold) > 0)) {
    fieldError('alert-new-price', tRaw('alerts.new_price_missing'));
    return;
  }
  const d = await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`, {
    direction: G('alert-new-direction').value,
    threshold,
    condition: G('alert-new-state').value,
  });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  G('alert-new-set').value = '';
  G('alert-new-price').value = '';
  toast(tRaw('alerts.new_ok', { set: sn }), 'success');
  await loadAlertOverview();
}

/**
 * All price alerts in one place: in the set detail, an alert is only found once the set itself has been
 * found. Threshold as a field (saves on blur), plus the last price, without which it cannot be judged.
 */
export async function loadAlertOverview() {
  const el = G('alerts-list');
  if (!el) return;
  const suggestions = G('alert-new-sets');
  if (suggestions)
    setHtml(
      suggestions,
      gallerySets.map(x => html`<option value="${x.set_number}">${x.name || ''}</option>`),
    );
  const d = await api('GET', '/v1/alerts');
  if (!d?.success) return;
  const alerts = d.alerts || [];
  if (!alerts.length) {
    setHtml(el, html`<p class="text-mut">${tRaw('alerts.empty')}</p>`);
    return;
  }
  setHtml(
    el,
    alerts.map(a => {
      const condition = a.condition === 'U' ? tRaw('common.condition_used') : tRaw('common.condition_new');
      const direction = a.direction === 'unter' ? tRaw('alerts.below') : tRaw('alerts.above');
      // The key is (set, condition) — both are needed, otherwise changing one hits the wrong one of a
      // set's two possible alerts.
      const key = `${a.set_number}|${a.condition}`;
      const last = a.last_price == null ? '' : t('alerts.last', { price: fmtN(a.last_price, a.currency_code) });
      // "armed" vs "fired" is never carried by color alone, since green and grey look the same to people
      // with red-green color blindness: word, shape (filled/outlined) and symbol (●/○) each carry it on
      // their own, same as elsewhere in the app.
      const badge = a.triggered
        ? `<span class="alert-badge alert-badge-off">${esc(tRaw('alerts.fired'))}</span>`
        : `<span class="alert-badge alert-badge-on">${esc(tRaw('alerts.armed'))}</span>`;
      // Image like in Finances: first the downloaded copy, then the address from the own collection,
      // lastly the catalog's. An alert on a set one does NOT own only has the last one — which is why it's
      // in the response at all.
      const imageSource = a.image_local || a.image_url || a.set_img_url || '';
      const image = imageSource
        ? imageTag({ src: imgUrl(thumbUrl(imageSource) || imageSource, true), alt: '', class: 'image-38', ph: 'set' })
        : `<span class="image-ph image-38" aria-hidden="true">${placeholderContent('set')}</span>`;
      // The row opens the set detail, but only if the set is in the collection — otherwise an error would
      // show instead of the dialog. The field and delete button have their own data-click, otherwise every
      // click into the field would open the dialog above it.
      const opens = a.besitzt ? ` class="cursor-pointer" data-click="openModal" data-arg="${esc(a.set_number)}"` : '';
      return html`<div class="alert-item"${rawHtml(opens)}>
      ${rawHtml(image)}
      <div class="alert-item-text">
        <div><strong>${a.name || a.set_number}</strong></div>
        <div class="alert-item-sub">${a.name ? html`${a.set_number}${' · '}` : ''}${condition}</div>
      </div>
      <div class="alert-item-status">${rawHtml(badge)}<span class="alert-item-last">${last}</span></div>
      <div class="alert-item-threshold">
        <span class="alert-item-direction">${direction}</span>
        <span class="alert-item-amount"><input inputmode="decimal" type="text" autocomplete="off" value="${amountForField(a.threshold)}" aria-label="${tRaw('detail.alert_price')} ${a.set_number}"
               data-change="changeAlertThreshold" data-arg="${key}" data-val="1" data-click="stopEvent" class="alert-item-field" />
        <span class="alert-item-currency">${a.currency_code}</span></span>
      </div>
      <button class="btn bs btn-sm alert-item-delete" data-click="deleteAlert"${genuine()} data-arg="${key}"
              aria-label="${tRaw('common.delete')}: ${a.set_number}" title="${tRaw('common.delete')}"
              data-arg2="${a.set_number}">${ico('delete')}</button>
    </div>`;
    }),
  );
}

/**
 * (Set, condition) from the row's key — one place, two readers.
 * @param {string} s
 */
function alertKey(s) {
  const i = String(s).lastIndexOf('|');
  return { setNumber: String(s).slice(0, i), condition: String(s).slice(i + 1) };
}

/**
 * @param {string} key
 * @param {string} value
 */
async function changeAlertThreshold(key, value) {
  const threshold = readAmount(value);
  // No silently writing back nonsense: whoever enters 0 or text should see that nothing happened, instead
  // of looking for an alert later that doesn't exist.
  if (!(threshold != null && threshold > 0)) {
    toast(tRaw('alerts.bad_value'), 'error');
    await loadAlertOverview();
    return;
  }
  const { setNumber, condition } = alertKey(key);
  // Written via the EXISTING route on the set — the overview gets no write path of its own (see
  // routes/api_v1/sets.ts).
  const d = await api('PUT', `/v1/sets/${encodeURIComponent(setNumber)}/alert`, { condition, threshold });
  if (!d?.success) toast(d?.error || tRaw('settings.error'), 'error');
  await loadAlertOverview();
}

/**
 * @param {string} key
 * @param {string} setNumber
 */
async function deleteAlert(key, setNumber) {
  // Restorable: the undo writes the old threshold back, so no question before (js/deletion.js).
  const { setNumber: sn, condition } = alertKey(key);
  const before = (await api('GET', `/v1/sets/${encodeURIComponent(sn)}/alert`))?.alerts?.find(
    a => a.condition === condition,
  );
  await deleteRestorable({
    request: () => api('DELETE', `/v1/sets/${encodeURIComponent(sn)}/alert?condition=${encodeURIComponent(condition)}`),
    message: tRaw('alerts.deleted', { set: setNumber }),
    undo: before
      ? async () => {
          const r = await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`, {
            direction: before.direction === 'ueber' ? 'ueber' : 'unter',
            threshold: Number(before.threshold),
            condition,
          });
          if (!r?.success) toast(r?.error || tRaw('settings.error'), 'error');
          return !!r?.success;
        }
      : undefined,
    after: loadAlertOverview,
  });
  await loadAlertOverview();
}

/**
 * Read price alerts from a CSV. Thresholds are not converted (a wrong exchange rate would be worse), but
 * apply in the account currency; a currency notice therefore reports with "info" rather than a success tone.
 */
async function importAlertsCsv() {
  const status = G('alerts-csv-status');
  const d = await uploadCsv({
    feld: 'alerts-csv-file',
    pfad: '/v1/alerts/import/csv',
    hinweise: a => [a.waehrung_hinweis],
    show: l => {
      if (status) status.textContent = l ? tRaw('import.running') : '';
    },
  });
  if (d) await loadAlertOverview();
}

// Names below are registry-exposed (index.html/connection.js/tests) — kept unchanged.
registerActions({
  createAlert,
  changeAlertThreshold,
  importAlertsCsv,
  deleteAlert,
});
