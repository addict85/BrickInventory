import { genuine, registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api, apiRaw } from './api.js';
import { ico, G, setHtml } from './dom.js';
import { fmtDate, fmtN, amountForField } from './format.js';
import { responseError, amountFromField, fieldError } from './form.js';
import { toast } from './messages.js';
import { openPdfViewer } from './pdfviewer.js';
import { accountCurrency, settingsSnapshot } from './state.js';
import { html, joinHtml } from './escaping.js';
import { confirmDelete } from './confirm-prompt.js';
import { deleteRestorable } from './deletion.js';

// Vouchers (LEGO gift cards) sit in the profile instead of a tab of their own, to be quickly reachable.

/** The most recently loaded list — for the buttons that point to a row. */
/** @type {import('../../frontend-types/contract').Voucher[]} */
let _vouchers = [];
/** The most recently loaded vouchers, for reading by the balance lookup. */
export const vouchers = () => _vouchers;

/** The id of the voucher currently being edited; null = new entry. */
/** @type {number | string | null} */
let _edited = null;

/** @param {string} id */
const el = (/** @type {string} */ id) => /** @type {Field} */ (document.getElementById(id));

// The handlers take the id FIRST: the dispatcher in actions.js passes `data-arg`, `data-arg2` …
// in order and appends the event LAST, so an `(ev, id)` would silently get the id in `ev`.

/** Revealed PINs: even after fetching only on request, against the shoulder next to you. */
const _visible = new Set();

/** Number and PIN in plaintext per id: the server's list only carries the mask,
 * the plaintext is fetched (and logged) once per voucher and page. */
const _plaintext = new Map();

/**
 * @param {number} id
 */
async function fetchPlaintext(id) {
  if (_plaintext.has(id)) return _plaintext.get(id);
  const d = await api('POST', `/v2/vouchers/${id}/plaintext`, {});
  if (!d?.success) {
    if (d) toast(d.error || tRaw('vouchers.load_error'), 'error');
    return null;
  }
  _plaintext.set(id, { number: d.number, pin: d.pin });
  return _plaintext.get(id);
}

/**
 * The copy icon — two sheets, as everywhere else.
 *
 * Inline and not as a font character: an emoji looks different on every system and is missing entirely with some
 * fonts. `currentColor` lets it adopt the button's color, i.e. also in dark mode.
 */
const COPY_ICON_SVG = html`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13"
  height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

/** "6123-4567-8901" and "612345678901" → "6123 4567 8901". */
/** @param {unknown} raw */
export function groupNumber(raw) {
  return String(raw ?? '')
    .replace(/[\s-]/g, '')
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** The currency of the issuing country's cards; without a country that of the account. */
/** @type {Record<string, string>} */
const COUNTRY_CURRENCY = {
  'de-CH': 'CHF',
  'de-DE': 'EUR',
  'de-AT': 'EUR',
  'fr-FR': 'EUR',
  'it-IT': 'EUR',
  'nl-NL': 'EUR',
  'en-GB': 'GBP',
  'en-US': 'USD',
};
/** Without a stored issuing country, the country of the account currency (as the server derives it). */
/** @type {Record<string, string>} */
export const COUNTRY_TO_CURRENCY = { CHF: 'de-CH', EUR: 'de-DE', GBP: 'en-GB', USD: 'en-US' };
export function countryCurrency() {
  const country = G('voucher-country')?.value || settingsSnapshot?.voucher_country || '';
  return COUNTRY_CURRENCY[country] || accountCurrency;
}

/** Suggestion in the form and the sentence below it if the chosen currency differs. */
function checkCurrency() {
  const field = G('v-currency'),
    hint = el('v-currency-hint');
  if (!field || !hint) return;
  const should = countryCurrency();
  hint.hidden = field.value === should;
  hint.textContent = tRaw('vouchers.currency_hint', { w: should });
}

/** @param {import('../../frontend-types/contract').Voucher} g */
function row(g) {
  const k = _plaintext.get(g.id);
  const openPin = _visible.has(g.id) && !!k;
  // The number in groups of four: 19 digits in one go cannot be read when typing them at the checkout, and
  // that is exactly what it is for. First remove the own separators, otherwise they count ("6123 -456 7-89"). Still the
  // RAW number is copied — with spaces no payment field accepts it.
  const number = groupNumber(k ? k.number : g.number);
  return html`
    <div class="voucher-row" data-id="${g.id}">
      <div class="voucher-main">
        <div class="voucher-num-row">
          <span class="voucher-num">${number}</span>
          <button class="v-btn" data-click="copyVoucher" data-arg="${g.id}" data-arg2="number"
                  title="${tRaw('vouchers.copy_number')}"
                  aria-label="${tRaw('vouchers.copy_number')}">${COPY_ICON_SVG}<span class="v-btn-text">${tRaw('vouchers.short_copy')}</span></button>
        </div>
        <div class="voucher-meta">
          <span class="voucher-amount">${fmtN(g.amount, g.currency)}</span>
          ${countryCurrency() && g.currency !== countryCurrency() ? html`<span class="voucher-deviation">${tRaw('vouchers.currency_different', { w: countryCurrency() })}</span>` : ''}
          <!-- The status NEXT TO the amount, not instead of it: an amount alone says nothing
               without the date it was queried; a never queried card says so in WORDS, not by colour. -->
          <span class="voucher-status">${g.balance_checked_at ? tRaw('vouchers.balance_as_of', { date: fmtDate(g.balance_checked_at) }) : tRaw('vouchers.balance_never')}${g.has_pdf ? '' : html` · <span class="voucher-nopdf">${tRaw('vouchers.no_pdf_short')}</span>`}</span>
        </div>
      </div>
      <div class="voucher-pin">
        <span class="voucher-pin-label">${tRaw('vouchers.pin')}</span>
        <code>${g.pin ? (openPin ? k.pin : '••••') : '–'}</code>
        ${
          g.pin
            ? html`<button class="v-btn" data-click="toggleVoucherPin" data-arg="${g.id}"
                     title="${tRaw(openPin ? 'vouchers.pin_hide' : 'vouchers.pin_show')}"
                     aria-label="${tRaw(openPin ? 'vouchers.pin_hide' : 'vouchers.pin_show')}">
                     ${ico(openPin ? 'eye-close' : 'eye')}<span class="v-btn-text">${tRaw(openPin ? 'vouchers.short_hide' : 'vouchers.short_show')}</span></button>
                   <button class="v-btn" data-click="copyVoucher" data-arg="${g.id}" data-arg2="pin"
                     title="${tRaw('vouchers.copy_pin')}"
                     aria-label="${tRaw('vouchers.copy_pin')}">${COPY_ICON_SVG}<span class="v-btn-text">${tRaw('vouchers.short_copy')}</span></button>`
            : ''
        }
      </div>
      <div class="voucher-actions">
        <button class="btn bs btn-sm v-text" type="button" data-click="editVoucher" data-arg="${g.id}"
                aria-label="${tRaw('common.edit')}: ${number}">${ico('edit')}<span>${tRaw('common.edit')}</span></button>
        <details class="more-menu v-more">
          <summary class="btn bs btn-sm v-text" aria-label="${tRaw('vouchers.more')}: ${number}">${ico('menu')}<span>${tRaw('vouchers.more')}</span></summary>
          <div class="more-list">
            ${g.pin ? html`<button class="btn bs btn-sm v-text" type="button" data-click="queryBalance" data-arg="${g.id}">${ico('refresh')}<span>${tRaw('vouchers.balance_one')}</span></button>` : ''}
            <button class="btn bs btn-sm v-text" type="button" data-click="openVoucherPdf" data-arg="${g.id}">${ico('file')}<span>${tRaw('vouchers.pdf_open')}</span></button>
            <button class="btn bs btn-sm v-text v-btn-danger" type="button" data-click="deleteVoucher"${genuine()} data-arg="${g.id}"
                    aria-label="${tRaw('common.delete')}: ${number}">${ico('delete')}<span>${tRaw('common.delete')}</span></button>
          </div>
        </details>
      </div>
    </div>`;
}

/** Load and draw the list. */
export async function loadVouchers() {
  const list = el('vouchers-list');
  if (!list) return;
  const d = await api('GET', '/v2/vouchers');
  if (!d?.success) {
    setHtml(list, html`<div class="voucher-empty">${tRaw('vouchers.load_error')}</div>`);
    return;
  }
  _vouchers = d.vouchers || [];
  const countryField = G('voucher-country');
  if (countryField)
    countryField.value = settingsSnapshot?.voucher_country || COUNTRY_TO_CURRENCY[accountCurrency] || 'de-CH';
  showCountryCurrency();
  const removeEmpty = /** @type {HTMLInputElement | null} */ (G('vouchers-remove-empty'));
  if (removeEmpty) removeEmpty.checked = settingsSnapshot?.remove_empty_vouchers === '1';
  const cur = G('v-currency');
  if (cur && !_edited && !G('v-amount')?.value) cur.value = countryCurrency();
  checkCurrency();
  setHtml(
    list,
    _vouchers.length
      ? joinHtml(_vouchers.map(row))
      : html`<div class="voucher-empty" data-i18n="vouchers.empty">${tRaw('vouchers.empty')}</div>`,
  );
  // Sum, "query all" and export have nothing to do without vouchers.
  document.querySelectorAll('[data-only-with-vouchers]').forEach(e => {
    /** @type {HTMLElement} */ (e).hidden = !_vouchers.length;
  });

  // The sum per currency: adding up mixed ones would look right and be wrong; with no value at all only
  // the label "sum" stood there.
  const sumEl = el('vouchers-total');
  if (sumEl) {
    /** @type {Map<string, number>} */
    const per = new Map();
    for (const g of _vouchers) per.set(g.currency, (per.get(g.currency) || 0) + g.amount);
    sumEl.textContent = [...per].map(([w, voucherAmount]) => fmtN(voucherAmount, w)).join(' · ');
  }
}

function clearForm() {
  _edited = null;
  const cur = G('v-currency');
  if (cur) cur.value = countryCurrency();
  checkCurrency();
  for (const id of ['v-number', 'v-pin', 'v-amount']) {
    const e = el(id);
    if (e) e.value = '';
  }
  const file = el('v-pdf');
  if (file) {
    file.value = '';
    voucherFileSelected.call(file);
  }
  const title = el('vouchers-form-title');
  if (title) title.textContent = tRaw('vouchers.add');
  const cancel = el('v-cancel');
  if (cancel) cancel.style.display = 'none';
}

/** @param {string} id */
export function editVoucher(id) {
  const g = _vouchers.find(x => String(x.id) === String(id));
  if (!g) return;
  _edited = g.id;
  // Without a fetch the form carries the mask; the server leaves it standing as "unchanged".
  const k = _plaintext.get(g.id);
  el('v-number').value = k ? k.number : g.number;
  el('v-pin').value = (k ? k.pin : g.pin) || '';
  el('v-amount').value = amountForField(g.amount);
  const cur = el('v-currency');
  if (cur) cur.value = g.currency;
  el('vouchers-form-title').textContent = tRaw('vouchers.edit');
  el('v-cancel').style.display = '';
  // The file stays as it is: a voucher gets its PDF when created. Replacing it afterwards
  // would be a process of its own and answers no question anyone has.
  const pdfRow = el('v-pdf').parentElement;
  if (pdfRow) pdfRow.style.display = 'none';
  el('v-number').focus();
}

export function cancelVoucher() {
  clearForm();
  const pdfRow = el('v-pdf').parentElement;
  if (pdfRow) pdfRow.style.display = '';
}

/** Server error codes → field in the form (message at the field instead of a toast). */
const VOUCHER_FIELDS = {
  number_invalid: 'v-number',
  voucher_exists: 'v-number',
  pin_invalid: 'v-pin',
  amount_invalid: 'v-amount',
  currency_invalid: 'v-currency',
};

/** @typedef {{ number: string, pin: string, amount: number | string, currency: string }} VoucherInput */

/** @param {VoucherInput} v */
async function updateVoucher(v) {
  const d = await api('PUT', `/v2/vouchers/${_edited}`, v);
  if (!d?.success) {
    responseError(d, VOUCHER_FIELDS, tRaw('vouchers.save_error'));
    return;
  }
  _plaintext.delete(_edited);
  toast(tRaw('vouchers.saved'), 'success');
  clearForm();
  const pdfRow = el('v-pdf').parentElement;
  if (pdfRow) pdfRow.style.display = '';
  await loadVouchers();
}

/** The PDF did not yield enough. What WAS read is filled in — the user adds the rest and presses once
 * more, with the same file. That is the difference between "did not work" and "the amount is still
 * missing here". @param {{ number?: string, pin?: string, amount?: number | string | null, currency?: string }} g what the server read @param {VoucherInput} v */
function fillFromPdf(g, v) {
  if (g.number && !v.number) el('v-number').value = g.number;
  if (g.pin && !v.pin) el('v-pin').value = g.pin;
  if (g.amount != null && v.amount === '') el('v-amount').value = amountForField(g.amount);
  if (g.currency && el('v-currency')) el('v-currency').value = g.currency;
}

/** FormData instead of api(): the helper sends JSON. A file only goes as multipart, and the browser sets
 * `Content-Type` itself in the process (including boundary) — setting it here breaks the request. Only
 * filled-in fields are sent: an empty field would overwrite what was read from the PDF with nothing.
 * @param {File} file @param {VoucherInput} v */
async function uploadVoucherPdf(file, v) {
  const form = new FormData();
  form.append('file', file);
  if (v.number) form.append('number', v.number);
  if (v.pin) form.append('pin', v.pin);
  if (v.amount !== '') form.append('amount', String(v.amount));
  if (v.currency) form.append('currency', v.currency);
  let r, d;
  try {
    r = await apiRaw('POST', '/v2/vouchers/pdf', { body: form });
    d = await r.json();
  } catch {
    toast(tRaw('vouchers.save_error'), 'error');
    return;
  }
  if (r.status === 422) {
    fillFromPdf(d?.parsed || {}, v);
    toast(tRaw('vouchers.pdf_incomplete'), 'error');
    return;
  }
  if (!d?.success) {
    responseError(d, VOUCHER_FIELDS, tRaw('vouchers.save_error'));
    return;
  }
  // Whether a PDF yielded one or several vouchers is decided by the server; `multiple` says so. Then
  // the same message as for CSV imports, so that nobody reads "saved" for three vouchers and guesses.
  if (d.multiple) {
    toast(
      tRaw('import.summary', { added: d.multiple.added, updated: d.multiple.updated, errors: d.multiple.errors }),
      d.multiple.errors ? 'info' : 'success',
    );
  } else {
    toast(tRaw('vouchers.saved'), 'success');
  }
  clearForm();
  await loadVouchers();
}

/** @param {VoucherInput} v */
async function createVoucher(v) {
  const d = await api('POST', '/v2/vouchers', v);
  if (!d?.success) {
    responseError(d, VOUCHER_FIELDS, tRaw('vouchers.save_error'));
    return;
  }
  toast(tRaw('vouchers.saved'), 'success');
  clearForm();
  await loadVouchers();
}

/**
 * Save, one button for both paths: if a file is in the field, the server reads it, and filled-in fields
 * win. That way one can upload a PDF and add the amount oneself if it does not yield it.
 */
export async function saveVoucher() {
  const number = el('v-number').value.trim();
  const pin = el('v-pin').value.trim();
  const voucherAmount = amountFromField('v-amount', 'common.value_negative');
  const file = el('v-pdf')?.files?.[0] || null;
  // All gaps at once: the server reported them one after the other. A PDF can deliver number and amount.
  const empty = file ? [] : [!number && 'v-number', voucherAmount.ok && voucherAmount.value === null && 'v-amount'];
  const missing = /** @type {string[]} */ (empty.filter(Boolean));
  for (const id of missing) fieldError(id, tRaw('vouchers.required_missing'));
  if (!voucherAmount.ok || missing.length) {
    el(missing[0] ?? 'v-amount')?.focus();
    return;
  }
  const v = { number, pin, amount: voucherAmount.value ?? '', currency: el('v-currency')?.value || 'CHF' };
  if (_edited) await updateVoucher(v);
  else if (file) await uploadVoucherPdf(file, v);
  else await createVoucher(v);
}

/** @param {string} id */
export async function deleteVoucher(id) {
  const g = _vouchers.find(x => String(x.id) === String(id));
  if (!g) return;
  // A voucher is cash, hence the question; the server keeps the card for the undo: the toast
  // restores it with PIN and PDF, as with the wanted list (js/deletion.js).
  const yes = await confirmDelete(
    tRaw('vouchers.delete_title'),
    tRaw('vouchers.delete_confirm', { number: groupNumber(g.number) }),
    'delete',
    { button: 'common.delete', kind: 'bd' },
  );
  if (!yes) return;
  _plaintext.delete(g.id);
  await deleteRestorable({
    request: () => api('DELETE', `/v2/vouchers/${id}`),
    message: tRaw('vouchers.deleted'),
    undo: async () => {
      const r = await api('POST', `/v2/vouchers/${id}/restore`);
      if (!r?.success) toast(r?.error || tRaw('vouchers.save_error'), 'error');
      return !!r?.success;
    },
    after: loadVouchers,
  });
  await loadVouchers();
}

/** @param {string} id */
export async function toggleVoucherPin(id) {
  const n = Number(id);
  if (_visible.has(n)) _visible.delete(n);
  else if (await fetchPlaintext(n)) _visible.add(n);
  else return;
  loadVouchers();
}

/**
 * The PDF in the instructions' viewer, as in the Android app: it can display and download, two
 * buttons of its own for that would be duplicates.
 */
/** @param {string} id */
export async function openVoucherPdf(id) {
  const g = _vouchers.find(x => String(x.id) === String(id));
  const f = await pdfRelease(`/v2/vouchers/${id}/pdf-grant`);
  if (!f) return;
  const r = await apiRaw('GET', `/v2/vouchers/${id}/pdf?ticket=${encodeURIComponent(f.ticket)}`, {
    signal: f.deadline,
  });
  if (!r.ok) {
    toast((await r.json().catch(() => ({}))).error || tRaw('settings.error'), 'error');
    return;
  }
  const data = await r.arrayBuffer();
  openPdfViewer(URL.createObjectURL(new Blob([data], { type: 'application/pdf' })), g ? g.number : 'PDF', {
    data,
    fileName: `voucher-${id}.pdf`,
  });
}

/**
 * Confirmation, then a ticket for exactly one fetch of the PDF (60 s).
 * @param {string} path
 */
async function pdfRelease(path) {
  const d = await api('POST', path, {});
  if (!d?.success) {
    if (d) toast(d.error || tRaw('settings.error'), 'error');
    return null;
  }
  // After the deadline the ticket no longer applies; a hanging fetch then aborts.
  return { ticket: d.ticket, deadline: AbortSignal.timeout(d.valid_seconds * 1000) };
}

/**
 * Copy number or PIN, raw instead of grouped: the spaces are a reading aid at the checkout, a
 * payment field does not accept them. navigator.clipboard needs HTTPS, hence the fallback.
 */
/** @param {string} id @param {string} field */
export async function copyVoucher(id, field) {
  const g = _vouchers.find(x => String(x.id) === String(id));
  if (!g) return;
  const k = await fetchPlaintext(g.id);
  if (!k) return;
  const value = field === 'pin' ? k.pin || '' : String(k.number);
  if (!value) return;
  let worked = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      worked = true;
    }
  } catch {
    worked = false;
  }
  if (!worked) {
    try {
      const smallField = document.createElement('textarea');
      smallField.value = value;
      // Outside the view instead of `display:none`: a hidden element cannot be selected, and
      // without a selection execCommand copies nothing.
      smallField.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(smallField);
      smallField.select();
      worked = document.execCommand('copy');
      smallField.remove();
    } catch {
      worked = false;
    }
  }
  toast(
    tRaw(worked ? (field === 'pin' ? 'vouchers.copied_pin' : 'vouchers.copied_number') : 'vouchers.copy_error'),
    worked ? 'success' : 'error',
  );
}

/**
 * All vouchers as one PDF, via fetch instead of a link: the header X-Gutschein-Befunde says where the amount
 * could not be replaced — an <a href> would throw away exactly this information.
 */
async function exportVouchers() {
  const f = await pdfRelease('/v2/vouchers/export/pdf-grant');
  if (!f) return;
  toast(tRaw('vouchers.export_running'), 'info');
  try {
    const r = await apiRaw('GET', `/v2/vouchers/export/pdf?ticket=${encodeURIComponent(f.ticket)}`, {
      signal: f.deadline,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast(d.error || tRaw('settings.error'), 'error');
      return;
    }
    const blob = await r.blob();
    /** @type {{ kind?: string, reason?: string, number?: string }[]} */
    let findings = [];
    try {
      const header = r.headers.get('X-Gutschein-Befunde');
      if (header) findings = JSON.parse(atob(header));
    } catch {
      /* without findings the PDF is fine anyway */
    }

    // Download via a short-lived object URL: the name comes from the Content-Disposition if it
    // is readable, otherwise from the date.
    const name =
      (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] ||
      `brickinventory-vouchers-${new Date().toISOString().slice(0, 10)}.pdf`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    // The findings: 'unveraendert' now means exactly one thing — it should have been replaced and could not be.
    // "Was already right" is a kind of its own and no longer an open item.
    const open = findings.filter(b => b.kind === 'unveraendert' && b.reason);
    if (!open.length) {
      toast(tRaw('vouchers.export_done', { n: findings.length }), 'success');
    } else {
      // tRaw instead of t(), because a toast is plain text: t() escapes, and 9'325 would visibly become
      // "9&#39;325". The numbers are in the message, so that one knows which card on paper carries the old
      // amount.
      toast(
        tRaw('vouchers.export_done', { n: findings.length }) +
          ' — ' +
          tRaw('vouchers.export_open', { n: open.length }) +
          ': ' +
          open.map(b => b.number).join(', '),
        'info',
      );
    }
  } catch {
    toast(tRaw('settings.error'), 'error');
  }
}

/**
 * Save the issuing country — a global setting.
 *
 * A path of its own and not the big save button of the settings page: the field stands in the
 * voucher section, and whoever chooses something there expects it to apply. The server only accepts the value from an
 * admin — that is why the field is not even visible for everyone else (`admin-only` in index.html).
 */
export async function saveVoucherCountry() {
  const field = el('voucher-country');
  if (!field) return;
  const d = await api('POST', '/v2/settings', { voucher_country: field.value });
  if (d?.success && settingsSnapshot) settingsSnapshot.voucher_country = G('voucher-country')?.value;
  if (!_edited) {
    const cur = G('v-currency');
    if (cur) cur.value = countryCurrency();
  }
  checkCurrency();
  showCountryCurrency();
  await loadVouchers();
  toast(d?.success ? tRaw('settings.saved') : d?.error || tRaw('settings.error'), d?.success ? 'success' : 'error');
}

/** The account's switch: the server removes cards at 0.00 after a balance query (button or night).
 * The box follows the server: until it answers it still shows the old state. */
export async function saveRemoveEmpty() {
  const box = /** @type {HTMLInputElement | null} */ (G('vouchers-remove-empty'));
  if (!box) return;
  const want = box.checked;
  box.checked = !want;
  const value = want ? '1' : '0';
  const d = await api('POST', '/v2/settings', { remove_empty_vouchers: value });
  if (d?.success) {
    box.checked = want;
    if (settingsSnapshot) settingsSnapshot.remove_empty_vouchers = value;
  }
  toast(d?.success ? tRaw('settings.saved') : d?.error || tRaw('settings.error'), d?.success ? 'success' : 'error');
}

/** The name of the chosen file next to the button — the native field showed it itself. @this {HTMLInputElement | undefined} */
function voucherFileSelected() {
  const name = el('v-pdf-name');
  if (!name) return;
  const file = this?.files?.[0];
  name.textContent = file ? file.name : tRaw('vouchers.pdf_none');
}

/** Below the issuing country: in which currency its cards are denominated. */
function showCountryCurrency() {
  const z = el('voucher-country-currency');
  if (z) z.textContent = tRaw('vouchers.country_currency', { w: countryCurrency() });
}

registerActions({
  checkCurrency,
  voucherFileSelected,
  exportVouchers,
  loadVouchers,
  saveVoucher,
  editVoucher,
  cancelVoucher,
  deleteVoucher,
  toggleVoucherPin,
  openVoucherPdf,
  copyVoucher,
  saveVoucherCountry,
  saveRemoveEmpty,
});

// "More" collapses as soon as someone taps next to it, chooses inside it or presses Escape.
if (typeof document !== 'undefined') {
  document.addEventListener('click', ev => {
    const target = ev.target instanceof Element ? ev.target : null;
    for (const d of document.querySelectorAll('details.v-more[open]'))
      if (!d.contains(target) || target?.closest('.more-list button'))
        /** @type {HTMLDetailsElement} */ (d).open = false;
  });
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    for (const d of document.querySelectorAll('details.v-more[open]')) {
      /** @type {HTMLDetailsElement} */ (d).open = false;
      if (d.contains(document.activeElement)) /** @type {HTMLElement|null} */ (d.querySelector('summary'))?.focus();
    }
  });
}
