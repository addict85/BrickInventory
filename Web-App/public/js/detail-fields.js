// Fields shared by several detail dialogs: storage location (select with new entry), price alert and
// closing the set dialog. Lives below the views, so that set detail, wishlist and part detail use them
// the same way.
import { registerActions } from './registry.js';
import { html, rawHtml } from './escaping.js';
import { api } from './api.js';
import { G, setHtml } from './dom.js';
import { amountForField, fmtN, readAmount } from './format.js';
import { reportAtField, toast } from './messages.js';
import { fieldError } from './form.js';
import { accountCurrency, loggedInAccount, gallerySets, openSet, setOpenSet } from './state.js';
import { scopeQuery, LOCATION_VIEWS, locationMode, setLocationMode } from './account-filter.js';
import { tRaw } from '../i18n.js';

/**
 * Save a set's storage location.
 *
 * ── Why on leaving the field and not on key press ───────────────────────────
 *
 * Like the quantity next to it (`autosaveSet`): a storage location is typed, not chosen. Saving per character
 * produced six requests for "Box 3" and left five intermediate states in the database along the way.
 * @param {string} sn
 */
export async function saveSetLocation(sn) {
  const el = G('m-storage');
  if (!el) return;
  const d = await api('PUT', `/v2/sets/${encodeURIComponent(sn)}/storage`, { storage: el.value });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  // The list in the background carries the place as well — without updating it the tile showed the old one until
  // someone reloads.
  const entry = (gallerySets || []).find(x => x.set_number === sn);
  if (entry) entry.storage = d.storage ?? null;
  if (openSet && openSet.set_number === sn) openSet.storage = d.storage ?? null;
  reportAtField(el);
  await loadLocations();
}

/**
 * Which alert block is meant: 'm' (set) or 'mk-m' (wishlist item). A module variable instead of a parameter,
 * because the dispatcher only passes the set number; only one dialog is ever open anyway.
 */
let _alertField = 'm';

/**
 * @param {string} prefix
 */
export function setAlertField(prefix) {
  _alertField = prefix === 'mk-m' ? 'mk-m' : 'm';
}

const alertId = (/** @type {string} */ part) => `${_alertField}-alert-${part}`;

/**
 * The alert block — formulated ONCE, used by both dialogs.
 *
 * The wishlist item detail shows the same alert: it is the same entry in price_alerts, with the same key.
 * A second form for it would be the next place where a rule is only updated on one of the two paths
 * — that has already happened several times in this tree.
 * @param {string} sn
 * @param {string} [state] condition of the inventory: a used set is mostly looked for used.
 */
export function alertBlock(sn, prefix = 'm', state = 'N') {
  const p = prefix === 'mk-m' ? 'mk-m' : 'm';
  // The look is in styles.css under .alert-field, not here: the fixed height in the style attribute cut the
  // chosen entry down to six pixels (measured in the browser, reasoning there).
  return html`
      <select id="${p}-alert-cond" class="alert-field" aria-label="${tRaw('detail.alert')}: ${tRaw('common.condition')}" data-change="toggleAlertState" data-arg="${sn}">
        <option value="N"${state !== 'U' ? ' selected' : ''}>${tRaw('common.condition_new')}</option>
        <option value="U"${state === 'U' ? ' selected' : ''}>${tRaw('common.condition_used')}</option>
      </select>
      <select id="${p}-alert-dir" class="alert-field" aria-label="${tRaw('detail.alert')}" data-change="saveAlert" data-arg="${sn}">
        <option value="below">${tRaw('detail.alert_below')}</option>
        <option value="above">${tRaw('detail.alert_above')}</option>
      </select>
      <label class="alert-price" for="${p}-alert-val"><span class="alert-price-title">${tRaw('detail.alert_price_ph')}</span>
      <input inputmode="decimal" type="text" autocomplete="off" id="${p}-alert-val" class="alert-field" aria-label="${tRaw('detail.alert_price')} (${accountCurrency})"
             data-input="alertTyped" data-arg="${sn}"
             data-change="saveAlert" /></label><span class="alert-currency" aria-hidden="true">${accountCurrency}</span>
      <span id="${p}-alert-state" class="alert-status"></span>
      <button type="button" class="close-view" data-click="viewFromDialog" data-arg="alerts">${tRaw('detail.all_alerts')}</button>
    `;
}

/**
 * "New place" is recognized by an attribute, not by an agreed value: any invented value can be
 * typed in as a storage location by someone.
 */
const LOCATION_NEW_BRAND = html`data-new="1"`;

const isNewEntry = (/** @type {Pick<HTMLSelectElement, 'selectedOptions'> | null | undefined} */ sel) =>
  sel?.selectedOptions?.[0]?.dataset?.new === '1';

/** @type {string[]} */
let _locations = [];

/**
 * Remember the stock and update already drawn select fields.
 *
 * The places come over the network, but the dialog is already there. Without updating, the first display showed
 * an empty selection — and that is exactly when one looks.
 * @param {unknown[] | null | undefined} names
 */
export function setLocationStock(names) {
  _locations = [...new Set((names || []).filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
  for (const sel of /** @type {NodeListOf<HTMLSelectElement>} */ (
    document.querySelectorAll('select[data-place-selection]')
  )) {
    // If the selection is currently at "new place", it should stay there — otherwise it would jump away from someone
    // while typing.
    const warNew = isNewEntry(sel);
    const before = sel.value;
    setHtml(sel, locationOptions(before));
    if (warNew) sel.selectedIndex = sel.options.length - 1;
    else if ([...sel.options].some(o => o.value === before)) sel.value = before;
  }
}

/**
 * @param {string} value
 */
function locationOptions(value) {
  const known = _locations.includes(value);
  return [
    html`<option value="">${tRaw('detail.storage_none')}</option>`,
    // A place the stock does not know (yet) — e.g. because it was only just typed in — must still
    // be there, otherwise the display would jump back to "—".
    ...(value && !known ? [html`<option value="${value}" selected>${value}</option>`] : []),
    ..._locations.map(o => html`<option value="${o}"${o === value ? ' selected' : ''}>${o}</option>`),
    // ALWAYS last: setLocationStock() picks it up via options.length - 1.
    html`<option value="" ${LOCATION_NEW_BRAND}>${tRaw('detail.storage_new')}</option>`,
  ];
}

/**
 * The storage location as a selection that also accepts new values: a datalist looked like a text field and did not
 * open. Saving still goes via the text field, so that the saving rule exists only once.
 * @param {string} id  identifier of the text field (m-storage, setitem-storage); the
 *   selection gets the same one with the suffix "-sel".
 * @param {string | null | undefined} value  current storage location, or empty.
 * @param {string} [attrs]  further attributes for the text field (data-change, data-part, …).
 */
export function locationBlock(id, value, attrs = '') {
  const place = String(value || '');
  return html`
      <select id="${id}-sel" class="alert-field" aria-label="${tRaw('detail.storage')}" data-place-selection="1"
              data-change="locationSelected" data-arg="${id}">${locationOptions(place)}</select>
      <input type="text" id="${id}" class="alert-field" maxlength="60" aria-label="${tRaw('detail.storage')}" data-style="display:none"
             placeholder="${tRaw('detail.storage_ph')}" value="${place}"
             data-blur="locationTyped" ${rawHtml(attrs)} />
    `;
}

/**
 * Chosen from the list — or "new place".
 * @param {string} id identifier of the text field; the selection is called id + "-sel".
 */
export function locationSelected(id) {
  const sel = G(`${id}-sel`),
    field = G(id);
  if (!sel || !field) return;
  if (isNewEntry(sel)) {
    // Clear, show, focus: whoever chooses "new place" wants to type — not delete the old name first.
    field.value = '';
    field.style.display = '';
    field.focus();
    return;
  }
  field.style.display = 'none';
  field.value = sel.value;
  // The change event by hand: a programmatically set value triggers none. Via the
  // event delegation (actions.js) it lands at exactly the handler that also saves an input made by
  // hand.
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * A new place has been typed completely. The field's change event has already saved; here only the
 * selection next to it is updated. `this` is the field (the dispatcher calls with the element as receiver).
 * @this {HTMLInputElement}
 */
export function locationTyped() {
  const sel = G(`${this?.id}-sel`);
  if (!sel) return;
  const place = String(this.value || '').trim();
  if (!_locations.includes(place) && place) _locations = [..._locations, place].sort((a, b) => a.localeCompare(b));
  setHtml(sel, locationOptions(place));
  sel.value = place;
  if (place) this.style.display = 'none';
}

/**
 * Which condition the alert applies to: new and used are often far apart, and whoever looks for used
 * should be able to wait for that. The server has the condition in the key.
 */
function alertState() {
  return G(alertId('cond'))?.value === 'U' ? 'U' : 'N';
}

/**
 * Load and show the price alert of the open set.
 * @param {string} sn
 */
export async function loadAlert(sn) {
  const d = await api('GET', `/v2/sets/${encodeURIComponent(sn)}/alert`);
  const dir = G(alertId('dir')),
    val = G(alertId('val'));
  if (!dir || !val) return;
  // If there is only an alert for the other condition, the selection is set to it: otherwise it would look as if it were missing.
  const all = d?.alerts || [];
  const choice = G(alertId('cond'));
  if (choice && all.length && !all.some(x => x.condition === alertState()))
    choice.value = all[0]?.condition === 'U' ? 'U' : 'N';
  const a = all.find(x => x.condition === alertState());
  dir.value = a?.direction || 'below';
  val.value = a ? amountForField(a.threshold) : '';
  showAlertMarker(a);
}

/**
 * Only update the flag, never the input field: while typing, the server response would otherwise erase a
 * character just typed.
 * @param {import('../../frontend-types/contract').PriceAlert | undefined} a
 */
function showAlertMarker(a) {
  const st = G(alertId('state'));
  if (!st) return;
  // The flag says whether a notification was already sent. Showing it is the difference between "the alert is set"
  // and "the alert has fired" — otherwise one wonders why no more mail comes.
  st.textContent = !a ? '' : a.triggered ? tRaw('detail.alert_fired') : tRaw('detail.alert_armed');
  st.className = a ? `alert-status alert-badge alert-badge-${a.triggered ? 'off' : 'on'}` : 'alert-status';
}

/**
 * Switching to the other condition only loads and does not save: a change is a question, not an input.
 * A running quiet period is dropped, so that the old threshold does not end up at the new condition.
 * @param {string} sn
 */
export function toggleAlertState(sn) {
  clearTimeout(_alertRest);
  _alertRest = null;
  return loadAlert(sn);
}

/**
 * How long it must be quiet before saving while typing.
 *
 * The same number as in the app (Alarmeingabe.RUHE_MS) — if the two drift apart, the same
 * field behaves differently in two places without anyone noticing.
 */
const ALERT_REST = 800;

/**
 * @type {ReturnType<typeof setTimeout> | null}
 */
let _alertRest = null;

/**
 * Save while typing, debounced: whoever types and closes the window without clicking elsewhere lost
 * the input. The values are now copied, because the field may already be gone when the quiet period ends.
 * @param {string} sn
 */
export function alertTyped(sn) {
  const dir = G(alertId('dir')),
    val = G(alertId('val'));
  if (!dir || !val) return;
  const direction = dir.value,
    raw = String(val.value || '').trim();
  clearTimeout(_alertRest);
  _alertRest = setTimeout(() => {
    _alertRest = null;
    sendAlert(sn, direction, raw);
  }, ALERT_REST);
}

/**
 * Save or delete the price alert — IMMEDIATELY.
 *
 * For the direction: it is chosen, not typed, and a quiet period on a single choice would only be a
 * delay without gain. A still running quiet period is discarded, so that the old
 * direction does not follow shortly afterwards.
 * @param {string} sn
 */
export function saveAlert(sn) {
  const dir = G(alertId('dir')),
    val = G(alertId('val'));
  if (!dir || !val) return;
  clearTimeout(_alertRest);
  _alertRest = null;
  return sendAlert(sn, dir.value, String(val.value || '').trim());
}

/**
 * THE one path to the server. An empty field deletes the alert, not a threshold of 0: clearing the field is the
 * natural gesture. The quiet period prevents a threshold at 2 from arising on the way to "249".
 * @param {string} sn
 * @param {string} direction
 * @param {string} raw
 */
async function sendAlert(sn, direction, raw) {
  const number = readAmount(raw);
  // "abc" or "0" is not a wish to delete but a typo: the same message as on #/alarme.
  if (raw !== '' && !(number != null && number > 0)) {
    fieldError(alertId('val'), tRaw('alerts.new_price_missing'));
    return;
  }
  const remove = number == null;
  const cond = alertState();
  const d = remove
    ? await api('DELETE', `/v2/sets/${encodeURIComponent(sn)}/alert?condition=${cond}`)
    : await api('PUT', `/v2/sets/${encodeURIComponent(sn)}/alert`, {
        direction: direction,
        threshold: number,
        condition: cond,
      });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  // Only the flag, not the field — the reasoning is at showAlertMarker().
  showAlertMarker(remove ? undefined : (d.alert ?? undefined));
  reportAtField(G(alertId('state')));
}

/**
 * On opening, show which alerts have fired since the last visit — the counterpart to the app's hourly
 * query. The marker comes from the server (no own clock) and applies per account.
 */
export async function showOpenAlerts() {
  if (!loggedInAccount?.id) return;
  const key = 'bim_alert_seen_' + loggedInAccount.id;
  /** @type {string | null} */
  let mark = null;
  try {
    mark = localStorage.getItem(key);
  } catch (_) {}
  const d = await api('GET', `/v2/alerts/pending${mark ? '?since=' + encodeURIComponent(mark) : ''}`).catch(() => null);
  // Without `now` no new marker — and without a new marker better save nothing at all than a wrong one.
  if (!d?.success || !d.now) return;
  try {
    localStorage.setItem(key, String(d.now));
  } catch (_) {}
  // First visit: only remember, report nothing. Otherwise a freshly logged-in account would be hit with thresholds
  // that were crossed weeks ago.
  if (!mark) return;
  const sub = tRaw('detail.alert_below'),
    via = tRaw('detail.alert_above');
  for (const a of d.alerts || []) {
    const direction = a.direction === 'below' ? sub : via;
    // Amounts as everywhere in the UI ("712,40 €"), in the alert's currency.
    const threshold = fmtN(a.threshold, a.currency_code);
    const txt =
      a.last_price == null
        ? `${a.set_number}: ${direction} ${threshold}`
        : `${a.set_number}: ${fmtN(a.last_price, a.currency_code)} (${direction} ${threshold})`;
    toast(txt, 'info');
  }
}

/**
 * The place selection in the detail is the OWNER's stock: for the grandchild's set the grandchild's shelves are
 * up for choice. A datalist allows choosing and typing something new at the same time.
 * @param {({ id: number } | number)[] | null | undefined} owner
 */
export async function loadLocationSelection(owner) {
  const dl = G('locations');
  if (!dl) return;
  const ids = (owner || [])
    .map((/** @type {{ id: number } | number} */ o) => (typeof o === 'number' ? o : (o?.id ?? o)))
    .filter(n => Number.isFinite(Number(n)));
  const question = ids.length ? '?owner=' + encodeURIComponent(ids.join(',')) : '';
  const d = await api('GET', `/v2/storage/locations${question}`);
  if (!d?.success) return;
  setHtml(
    dl,
    (d.locations || []).map(o => html`<option value="${o.name}"></option>`),
  );
  // The same list feeds the select field in the detail (locationBlock).
  setLocationStock((d.locations || []).map(o => o.name));
}

/** The accounts whose storage locations are up for choice when capturing; set by loading the household. @type {number[]} */
let _stockAccounts = [];

/**
 * The whole stock is up for choice (/v2/storage/locations), even a new, empty place; the filters only show
 * occupied places (/v2/storage), because an empty place would find nothing there.
 * @param {number[]} [accounts] household accounts; without a value the most recently named ones
 */
export async function loadLocations(accounts) {
  if (accounts) _stockAccounts = accounts;
  const question = _stockAccounts.length > 1 ? '?owner=' + encodeURIComponent(_stockAccounts.join(',')) : '';
  const [supply, used] = await Promise.all([
    api('GET', `/v2/storage/locations${question}`),
    api('GET', `/v2/storage${scopeQuery('gallery')}`),
  ]);
  if (supply?.success) {
    const names = (supply.locations || []).map(o => o.name);
    const dl = G('locations');
    if (dl)
      setHtml(
        dl,
        [...new Set(names)].map(n => html`<option value="${n}"></option>`),
      );
    setLocationStock(names);
  }
  if (used?.success) initStorageSelects(used.locations || []);
}

/**
 * The quantity field in the set detail including "−": for one copy "−" would be deletion; the button stays reachable
 * and says where that is done. Here, because the purchase price dialog updates the quantity too.
 * @param {number} [quantity] new value; without it only align the button with the field
 */
export function setQuantitiesField(quantity) {
  const field = G('m-qty'),
    minus = G('m-qty-dec');
  if (!field) return;
  if (quantity !== undefined) field.value = String(quantity);
  if (!minus) return;
  const last = (parseInt(field.value, 10) || 1) <= 1;
  minus.setAttribute('aria-disabled', String(last));
  minus.title = last ? tRaw('detail.qty_last') : '';
  if (last) minus.setAttribute('aria-describedby', 'm-qty-last');
  else minus.removeAttribute('aria-describedby');
}

// Here and not in the set detail: the purchase price dialog closes it too, and that one lies below in the import
// graph.
export function closeModal() {
  G('set-modal').classList.remove('open');
  setOpenSet(null);
}

registerActions({
  closeModal,
  saveAlert,
  alertTyped,
  toggleAlertState,
  saveSetLocation,
  locationSelected,
  locationTyped,
});

/**
 * Fill the storage location filters. Without places they stay hidden: a choice with only "all" answers nothing —
 * the same rule as for the account filter.
 * @param {import('../../frontend-types/contract').Storage[]} locations
 */
export function initStorageSelects(locations) {
  // Long names shortened: a select field is as wide as its longest option; the full name is in the title.
  const short = (/** @type {string} */ s) => (s.length > 32 ? s.slice(0, 30) + '…' : s);
  const opts = [
    html`<option value="">${tRaw('filter.storage_all')}</option>`,
    ...locations.map(
      o =>
        html`<option value="${o.location}"${o.location.length > 32 ? html` title="${o.location}"` : ''}>${short(o.location)}</option>`,
    ),
  ].join('');
  for (const view of LOCATION_VIEWS) {
    const el = G('storage-' + view);
    if (!el) continue;
    if (!locations.length) {
      el.style.display = 'none';
      continue;
    }
    setHtml(el, rawHtml(opts));
    // If the stored choice points to a place that has since become empty, an empty label would otherwise state here
    // above a filtered list — the same trap as with the account filter.
    const saved = locationMode(view);
    el.value = [...el.options].some(o => o.value === saved) ? saved : '';
    if (el.value !== saved) setLocationMode(view, el.value);
    el.style.display = '';
  }
}
