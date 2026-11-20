// Fields shared by several detail dialogs: storage location (select with new entry), price alert and
// closing the set dialog. Lives below the views, so that set detail, wishlist and part detail use them
// the same way.
import { registerActions } from './registry.js';
import { html, rawHtml } from './escaping.js';
import { api } from './api.js';
import { G, setzeHtml } from './dom.js';
import { amountForField, fmtN, readAmount } from './format.js';
import { meldeAmFeld, toast } from './messages.js';
import { feldFehler } from './form.js';
import { accountCurrency, loggedInAccount, gallerySets, openSet, setOpenSet } from './state.js';
import { scopeQuery, LAGER_VIEWS, lagerModus, setLagerModus } from './account-filter.js';
import { tRaw } from '../i18n.js';

/**
 * Save a set's storage location.
 *
 * ── Why on leaving the field and not on key press ───────────────────────────
 *
 * Like the quantity next to it (`autosaveSet`): a storage location is typed, not chosen. Saving per character
 * produced six requests for "Kiste 3" and left five intermediate states in the database along the way.
 * @param {string} sn
 */
export async function speichereSetLagerort(sn) {
  const el = G('m-storage');
  if (!el) return;
  const d = await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/storage`, { storage: el.value });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  // The list in the background carries the place as well — without updating it the tile showed the old one until
  // someone reloads.
  const eintrag = (gallerySets || []).find(x => x.set_number === sn);
  if (eintrag) eintrag.storage = d.storage ?? null;
  if (openSet && openSet.set_number === sn) openSet.storage = d.storage ?? null;
  meldeAmFeld(el);
  await loadLocations();
}

/**
 * Which alert block is meant: 'm' (set) or 'mk-m' (wishlist item). A module variable instead of a parameter,
 * because the dispatcher only passes the set number; only one dialog is ever open anyway.
 */
let _alarmField = 'm';

/**
 * @param {string} praefix
 */
export function setAlarmField(praefix) {
  _alarmField = praefix === 'mk-m' ? 'mk-m' : 'm';
}

const alarmId = (/** @type {string} */ teil) => `${_alarmField}-alert-${teil}`;

/**
 * The alert block — formulated ONCE, used by both dialogs.
 *
 * The wishlist item detail shows the same alert: it is the same entry in price_alerts, with the same key.
 * A second form for it would be the next place where a rule is only updated on one of the two paths
 * — that has already happened several times in this tree.
 * @param {string} sn
 * @param {string} [zustand] condition of the inventory: a used set is mostly looked for used.
 */
export function alarmBlock(sn, praefix = 'm', zustand = 'N') {
  const p = praefix === 'mk-m' ? 'mk-m' : 'm';
  // The look is in styles.css under .alarm-feld, not here: the fixed height in the style attribute cut the
  // chosen entry down to six pixels (measured in the browser, reasoning there).
  return html`
      <select id="${p}-alert-cond" class="alarm-feld" aria-label="${tRaw('detail.alert')}: ${tRaw('common.condition')}" data-change="wechsleAlarmZustand" data-arg="${sn}">
        <option value="N"${zustand !== 'U' ? ' selected' : ''}>${tRaw('common.condition_new')}</option>
        <option value="U"${zustand === 'U' ? ' selected' : ''}>${tRaw('common.condition_used')}</option>
      </select>
      <select id="${p}-alert-dir" class="alarm-feld" aria-label="${tRaw('detail.alert')}" data-change="speichereAlarm" data-arg="${sn}">
        <option value="unter">${tRaw('detail.alert_below')}</option>
        <option value="ueber">${tRaw('detail.alert_above')}</option>
      </select>
      <label class="alarm-preis" for="${p}-alert-val"><span class="alarm-preis-titel">${tRaw('detail.alert_preis_ph')}</span>
      <input inputmode="decimal" type="text" autocomplete="off" id="${p}-alert-val" class="alarm-feld" aria-label="${tRaw('detail.alert_price')} (${accountCurrency})"
             data-input="alarmGetippt" data-arg="${sn}"
             data-change="speichereAlarm" /></label><span class="alarm-waehrung" aria-hidden="true">${accountCurrency}</span>
      <span id="${p}-alert-state" class="alarm-stand"></span>
      <button type="button" class="zu-sicht" data-click="sichtAusDialog" data-arg="alarme">${tRaw('detail.alle_alarme')}</button>
    `;
}

/**
 * "New place" is recognized by an attribute, not by an agreed value: any invented value can be
 * typed in as a storage location by someone.
 */
const LOCATION_NEW_BRAND = html`data-neu="1"`;

const isNewEntry = (/** @type {Pick<HTMLSelectElement, 'selectedOptions'> | null | undefined} */ sel) =>
  sel?.selectedOptions?.[0]?.dataset?.neu === '1';

/** @type {string[]} */
let _locations = [];

/**
 * Remember the stock and update already drawn select fields.
 *
 * The places come over the network, but the dialog is already there. Without updating, the first display showed
 * an empty selection — and that is exactly when one looks.
 * @param {unknown[] | null | undefined} namen
 */
export function setLocationStock(namen) {
  _locations = [...new Set((namen || []).filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
  for (const sel of /** @type {NodeListOf<HTMLSelectElement>} */ (
    document.querySelectorAll('select[data-ortauswahl]')
  )) {
    // If the selection is currently at "new place", it should stay there — otherwise it would jump away from someone
    // while typing.
    const warNew = isNewEntry(sel);
    const vorher = sel.value;
    setzeHtml(sel, locationOptions(vorher));
    if (warNew) sel.selectedIndex = sel.options.length - 1;
    else if ([...sel.options].some(o => o.value === vorher)) sel.value = vorher;
  }
}

/**
 * @param {string} wert
 */
function locationOptions(wert) {
  const bekannt = _locations.includes(wert);
  return [
    html`<option value="">${tRaw('detail.storage_none')}</option>`,
    // A place the stock does not know (yet) — e.g. because it was only just typed in — must still
    // be there, otherwise the display would jump back to "—".
    ...(wert && !bekannt ? [html`<option value="${wert}" selected>${wert}</option>`] : []),
    ..._locations.map(o => html`<option value="${o}"${o === wert ? ' selected' : ''}>${o}</option>`),
    // ALWAYS last: setLocationStock() picks it up via options.length - 1.
    html`<option value="" ${LOCATION_NEW_BRAND}>${tRaw('detail.storage_new')}</option>`,
  ];
}

/**
 * The storage location as a selection that also accepts new values: a datalist looked like a text field and did not
 * open. Saving still goes via the text field, so that the saving rule exists only once.
 * @param {string} id  identifier of the text field (m-storage, setitem-storage); the
 *   selection gets the same one with the suffix "-sel".
 * @param {string | null | undefined} wert  current storage location, or empty.
 * @param {string} [attrs]  further attributes for the text field (data-change, data-part, …).
 */
export function locationBlock(id, wert, attrs = '') {
  const ort = String(wert || '');
  return html`
      <select id="${id}-sel" class="alarm-feld" aria-label="${tRaw('detail.storage')}" data-ortauswahl="1"
              data-change="lagerortGewaehlt" data-arg="${id}">${locationOptions(ort)}</select>
      <input type="text" id="${id}" class="alarm-feld" maxlength="60" aria-label="${tRaw('detail.storage')}" data-stil="display:none"
             placeholder="${tRaw('detail.storage_ph')}" value="${ort}"
             data-blur="lagerortGetippt" ${rawHtml(attrs)} />
    `;
}

/**
 * Chosen from the list — or "new place".
 * @param {string} id identifier of the text field; the selection is called id + "-sel".
 */
export function lagerortGewaehlt(id) {
  const sel = G(`${id}-sel`),
    feld = G(id);
  if (!sel || !feld) return;
  if (isNewEntry(sel)) {
    // Clear, show, focus: whoever chooses "new place" wants to type — not delete the old name first.
    feld.value = '';
    feld.style.display = '';
    feld.focus();
    return;
  }
  feld.style.display = 'none';
  feld.value = sel.value;
  // The change event by hand: a programmatically set value triggers none. Via the
  // event delegation (actions.js) it lands at exactly the handler that also saves an input made by
  // hand.
  feld.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * A new place has been typed completely. The field's change event has already saved; here only the
 * selection next to it is updated. `this` is the field (the dispatcher calls with the element as receiver).
 * @this {HTMLInputElement}
 */
export function lagerortGetippt() {
  const sel = G(`${this?.id}-sel`);
  if (!sel) return;
  const ort = String(this.value || '').trim();
  if (!_locations.includes(ort) && ort) _locations = [..._locations, ort].sort((a, b) => a.localeCompare(b));
  setzeHtml(sel, locationOptions(ort));
  sel.value = ort;
  if (ort) this.style.display = 'none';
}

/**
 * Which condition the alert applies to: new and used are often far apart, and whoever looks for used
 * should be able to wait for that. The server has the condition in the key.
 */
function alarmState() {
  return G(alarmId('cond'))?.value === 'U' ? 'U' : 'N';
}

/**
 * Load and show the price alert of the open set.
 * @param {string} sn
 */
export async function ladeAlarm(sn) {
  const d = await api('GET', `/v1/sets/${encodeURIComponent(sn)}/alert`);
  const dir = G(alarmId('dir')),
    val = G(alarmId('val'));
  if (!dir || !val) return;
  // If there is only an alert for the other condition, the selection is set to it: otherwise it would look as if it were missing.
  const alle = d?.alerts || [];
  const wahl = G(alarmId('cond'));
  if (wahl && alle.length && !alle.some(x => x.condition === alarmState()))
    wahl.value = alle[0]?.condition === 'U' ? 'U' : 'N';
  const a = alle.find(x => x.condition === alarmState());
  dir.value = a?.direction || 'unter';
  val.value = a ? amountForField(a.threshold) : '';
  showAlarmMarker(a);
}

/**
 * Only update the flag, never the input field: while typing, the server response would otherwise erase a
 * character just typed.
 * @param {import('../../frontend-types/contract').Preisalarm | undefined} a
 */
function showAlarmMarker(a) {
  const st = G(alarmId('state'));
  if (!st) return;
  // The flag says whether a notification was already sent. Showing it is the difference between "the alert is set"
  // and "the alert has fired" — otherwise one wonders why no more mail comes.
  st.textContent = !a ? '' : a.triggered ? tRaw('detail.alert_fired') : tRaw('detail.alert_armed');
  st.className = a ? `alarm-stand alarm-marke alarm-marke-${a.triggered ? 'aus' : 'an'}` : 'alarm-stand';
}

/**
 * Switching to the other condition only loads and does not save: a change is a question, not an input.
 * A running quiet period is dropped, so that the old threshold does not end up at the new condition.
 * @param {string} sn
 */
export function wechsleAlarmZustand(sn) {
  clearTimeout(_alarmRest);
  _alarmRest = null;
  return ladeAlarm(sn);
}

/**
 * How long it must be quiet before saving while typing.
 *
 * The same number as in the app (Alarmeingabe.RUHE_MS) — if the two drift apart, the same
 * field behaves differently in two places without anyone noticing.
 */
const ALARM_REST = 800;

/**
 * @type {ReturnType<typeof setTimeout> | null}
 */
let _alarmRest = null;

/**
 * Save while typing, debounced: whoever types and closes the window without clicking elsewhere lost
 * the input. The values are now copied, because the field may already be gone when the quiet period ends.
 * @param {string} sn
 */
export function alarmGetippt(sn) {
  const dir = G(alarmId('dir')),
    val = G(alarmId('val'));
  if (!dir || !val) return;
  const richtung = dir.value,
    roh = String(val.value || '').trim();
  clearTimeout(_alarmRest);
  _alarmRest = setTimeout(() => {
    _alarmRest = null;
    sendAlarm(sn, richtung, roh);
  }, ALARM_REST);
}

/**
 * Save or delete the price alert — IMMEDIATELY.
 *
 * For the direction: it is chosen, not typed, and a quiet period on a single choice would only be a
 * delay without gain. A still running quiet period is discarded, so that the old
 * direction does not follow shortly afterwards.
 * @param {string} sn
 */
export function speichereAlarm(sn) {
  const dir = G(alarmId('dir')),
    val = G(alarmId('val'));
  if (!dir || !val) return;
  clearTimeout(_alarmRest);
  _alarmRest = null;
  return sendAlarm(sn, dir.value, String(val.value || '').trim());
}

/**
 * THE one path to the server. An empty field deletes the alert, not a threshold of 0: clearing the field is the
 * natural gesture. The quiet period prevents a threshold at 2 from arising on the way to "249".
 * @param {string} sn
 * @param {string} richtung
 * @param {string} roh
 */
async function sendAlarm(sn, richtung, roh) {
  const zahl = readAmount(roh);
  // "abc" or "0" is not a wish to delete but a typo: the same message as on #/alarme.
  if (roh !== '' && !(zahl != null && zahl > 0)) {
    feldFehler(alarmId('val'), tRaw('alerts.new_preis_fehlt'));
    return;
  }
  const loeschen = zahl == null;
  const cond = alarmState();
  const d = loeschen
    ? await api('DELETE', `/v1/sets/${encodeURIComponent(sn)}/alert?condition=${cond}`)
    : await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`, {
        direction: richtung,
        threshold: zahl,
        condition: cond,
      });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  // Only the flag, not the field — the reasoning is at showAlarmMarker().
  showAlarmMarker(loeschen ? undefined : (d.alert ?? undefined));
  meldeAmFeld(G(alarmId('state')));
}

/**
 * On opening, show which alerts have fired since the last visit — the counterpart to the app's hourly
 * query. The marker comes from the server (no own clock) and applies per account.
 */
export async function showOpenAlerts() {
  if (!loggedInAccount?.id) return;
  const schluessel = 'bim_alarm_marke_' + loggedInAccount.id;
  /** @type {string | null} */
  let marke = null;
  try {
    marke = localStorage.getItem(schluessel);
  } catch (_) {}
  const d = await api('GET', `/v1/alerts/pending${marke ? '?since=' + encodeURIComponent(marke) : ''}`).catch(
    () => null,
  );
  // Without `now` no new marker — and without a new marker better save nothing at all than a wrong one.
  if (!d?.success || !d.now) return;
  try {
    localStorage.setItem(schluessel, String(d.now));
  } catch (_) {}
  // First visit: only remember, report nothing. Otherwise a freshly logged-in account would be hit with thresholds
  // that were crossed weeks ago.
  if (!marke) return;
  const unter = tRaw('detail.alert_below'),
    ueber = tRaw('detail.alert_above');
  for (const a of d.alerts || []) {
    const richtung = a.direction === 'unter' ? unter : ueber;
    // Amounts as everywhere in the UI ("712,40 €"), in the alert's currency.
    const schwelle = fmtN(a.threshold, a.currency_code);
    const txt =
      a.last_price == null
        ? `${a.set_number}: ${richtung} ${schwelle}`
        : `${a.set_number}: ${fmtN(a.last_price, a.currency_code)} (${richtung} ${schwelle})`;
    toast(txt, 'info');
  }
}

/**
 * The place selection in the detail is the OWNER's stock: for the grandchild's set the grandchild's shelves are
 * up for choice. A datalist allows choosing and typing something new at the same time.
 * @param {({ id: number } | number)[] | null | undefined} besitzer
 */
export async function loadLocationSelection(besitzer) {
  const dl = G('lagerorte');
  if (!dl) return;
  const ids = (besitzer || [])
    .map((/** @type {{ id: number } | number} */ o) => (typeof o === 'number' ? o : (o?.id ?? o)))
    .filter(n => Number.isFinite(Number(n)));
  const frage = ids.length ? '?owner=' + encodeURIComponent(ids.join(',')) : '';
  const d = await api('GET', `/v1/storage/locations${frage}`);
  if (!d?.success) return;
  setzeHtml(
    dl,
    (d.orte || []).map(o => html`<option value="${o.name}"></option>`),
  );
  // The same list feeds the select field in the detail (locationBlock).
  setLocationStock((d.orte || []).map(o => o.name));
}

/** The accounts whose storage locations are up for choice when capturing; set by loading the household. @type {number[]} */
let _stockAccounts = [];

/**
 * The whole stock is up for choice (/v1/storage/locations), even a new, empty place; the filters only show
 * occupied places (/v1/storage), because an empty place would find nothing there.
 * @param {number[]} [konten] household accounts; without a value the most recently named ones
 */
export async function loadLocations(konten) {
  if (konten) _stockAccounts = konten;
  const frage = _stockAccounts.length > 1 ? '?owner=' + encodeURIComponent(_stockAccounts.join(',')) : '';
  const [vorrat, belegt] = await Promise.all([
    api('GET', `/v1/storage/locations${frage}`),
    api('GET', `/v1/storage${scopeQuery('gallery')}`),
  ]);
  if (vorrat?.success) {
    const namen = (vorrat.orte || []).map(o => o.name);
    const dl = G('lagerorte');
    if (dl)
      setzeHtml(
        dl,
        [...new Set(namen)].map(n => html`<option value="${n}"></option>`),
      );
    setLocationStock(namen);
  }
  if (belegt?.success) initStorageSelects(belegt.orte || []);
}

/**
 * The quantity field in the set detail including "−": for one copy "−" would be deletion; the button stays reachable
 * and says where that is done. Here, because the purchase price dialog updates the quantity too.
 * @param {number} [menge] new value; without it only align the button with the field
 */
export function setQuantitiesField(menge) {
  const feld = G('m-qty'),
    minus = G('m-qty-dec');
  if (!feld) return;
  if (menge !== undefined) feld.value = String(menge);
  if (!minus) return;
  const letztes = (parseInt(feld.value, 10) || 1) <= 1;
  minus.setAttribute('aria-disabled', String(letztes));
  minus.title = letztes ? tRaw('detail.qty_letztes') : '';
  if (letztes) minus.setAttribute('aria-describedby', 'm-qty-letztes');
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
  speichereAlarm,
  alarmGetippt,
  wechsleAlarmZustand,
  speichereSetLagerort,
  lagerortGewaehlt,
  lagerortGetippt,
});

/**
 * Fill the storage location filters. Without places they stay hidden: a choice with only "all" answers nothing —
 * the same rule as for the account filter.
 * @param {import('../../frontend-types/contract').Lagerort[]} orte
 */
export function initStorageSelects(orte) {
  // Long names shortened: a select field is as wide as its longest option; the full name is in the title.
  const kurz = (/** @type {string} */ s) => (s.length > 32 ? s.slice(0, 30) + '…' : s);
  const opts = [
    html`<option value="">${tRaw('filter.storage_all')}</option>`,
    ...orte.map(
      o => html`<option value="${o.ort}"${o.ort.length > 32 ? html` title="${o.ort}"` : ''}>${kurz(o.ort)}</option>`,
    ),
  ].join('');
  for (const view of LAGER_VIEWS) {
    const el = G('storage-' + view);
    if (!el) continue;
    if (!orte.length) {
      el.style.display = 'none';
      continue;
    }
    setzeHtml(el, rawHtml(opts));
    // If the stored choice points to a place that has since become empty, an empty label would otherwise stand here
    // above a filtered list — the same trap as with the account filter.
    const gespeichert = lagerModus(view);
    el.value = [...el.options].some(o => o.value === gespeichert) ? gespeichert : '';
    if (el.value !== gespeichert) setLagerModus(view, el.value);
    el.style.display = '';
  }
}
