// Account and storage location fields: household members, account filter and the storage location fields of the capture paths. One
// shared source, so that all forms show the same list.
import { api } from './api.js';
import { G, setzeHtml } from './dom.js';
import { SCOPE_VIEWS, scopeMode, setScopeMode } from './account-filter.js';
import { loadLocations, locationBlock } from './detail-fields.js';
import { tRaw } from '../i18n.js';
import { html, rawHtml } from './escaping.js';
import { subscribe } from './events.js';
/** @typedef {import('../../frontend-types/contract').HouseholdMember} HouseholdMember */

/**
 * Make the account filter per view visible and fill it with the stored value.
 *
 * Stays hidden as long as the account has no sub-accounts: a filter with exactly one possible answer is
 * not a choice but a question that does not arise.
 * @param {HouseholdMember[]} members
 */
export function initScopeSelects(members) {
  const isMain = members.length > 1;
  // All, own, then every sub-account by name. "Sub-accounts" as a collective item added nothing; the
  // server still understands accounts=subs for older apps.
  const subs = members.filter(m => !m.is_self);
  const opts = [
    html`<option value="all">${tRaw('household.scope_all')}</option>`,
    html`<option value="own">${tRaw('household.scope_own')}</option>`,
    ...subs.map(m => html`<option value="${m.id}">${m.username}</option>`),
  ].join('');

  for (const view of SCOPE_VIEWS) {
    const el = G('scope-' + view);
    if (!el) continue;
    if (!isMain) {
      el.style.display = 'none';
      continue;
    }
    setzeHtml(el, rawHtml(opts));
    // A stored choice may point to an account that has since been unlinked — then fall back to "all"
    // instead of showing an empty selection.
    const saved = scopeMode(view);
    el.value = [...el.options].some(o => o.value === saved) ? saved : 'all';
    if (el.value !== saved) setScopeMode(view, el.value);
    el.style.display = '';
  }

  for (const view of ['gallery', 'parts', 'minifigs']) collectionSubtitle(view);

  // The parts list's switch "include sub-accounts" follows the same rule: invisible without sub-accounts.
  // It lives here because isMain is determined here from the same response.
  const subsBox = G('pl-bestand-subs-box');
  if (subsBox) {
    subsBox.style.display = isMain ? 'inline-flex' : 'none';
    // No check mark if there is nothing to include: otherwise the choice would stay set invisibly when the last
    // sub-account is unlinked and would keep having an effect.
    if (!isMain) {
      const cb = G('pl-bestand-subs');
      if (cb) cb.checked = false;
    }
  }
}

/** Subtitle per header of the collection: with "all accounts" the page counts foreign inventory too, "your collection"
 * would then not be right. The title itself stays fixed so that the header does not jump while loading.
 * @param {string} view */
export function collectionSubtitle(view) {
  const el = G(view + '-unter'),
    wahl = G('scope-' + view);
  if (!el) return;
  const basis = { gallery: 'gallery', parts: 'parts', minifigs: 'figs' }[view];
  const haushalt = !!wahl && wahl.style.display !== 'none' && wahl.value === 'all';
  const schluessel = `${basis}.subtitle${haushalt ? '_haushalt' : ''}`;
  el.setAttribute('data-i18n', schluessel);
  el.textContent = tRaw(schluessel);
}

/**
 * The household's accounts, as they were last loaded.
 *
 * Remembered because not every selection is in index.html: the wishlist's detail builds its rows when
 * opening and needs the list then — long after loadHouseholdMembers(). A second fetch would be a second
 * state of the same response.
 * @type {HouseholdMember[]}
 */
let _haushalt = [];

/** The remembered accounts. Empty as long as no response has arrived yet. */
export function householdAccounts() {
  return _haushalt;
}

/**
 * Account selection when capturing, only in the household: for an account without links the server delivers exactly
 * one entry, and a selection with one option stays hidden.
 */
export async function loadHouseholdMembers() {
  const d = await api('GET', '/v1/sets/household-members');
  const members = d?.members || [];
  _haushalt = members;
  // The same response decides about the account filter: more than one account means a main account with sub-accounts.
  initScopeSelects(members);
  // The storage locations in ONE go: they fill the select fields of the filters AND the shared <datalist> of the
  // input fields. Two calls would be two states of the same list.
  const orte = loadLocations(members.map(m => m.id)).catch(() => {});
  // The default for the capture fields (Marco's star) — a fetch of its own, reasoning at
  // loadLocationDefault().
  loadLocationDefault().catch(() => {});
  drawAccountSelection(members);
  drawLocationFields();
  // Only with the places is the filter row settled (storage location selection); startup waits for it.
  await orte;
}

/**
 * All five capture paths (set, part, figure, catalog, wishlist) get the same account selection: capturing something for
 * a child should work the same everywhere. A choice that was made stays when redrawing.
 * @param {HouseholdMember[]} members
 */
function drawAccountSelection(members) {
  const markup = members
    .map(
      m =>
        html`<option value="${m.id}"${m.is_self ? ' selected' : ''}>${m.username}${m.is_self ? html`${' '}${tRaw('household.ich')}` : ''}</option>`,
    )
    .join('');
  for (const id of ['add-owner', 'ap-owner', 'af-owner', 'cat-m-owner', 'mk-owner']) {
    const box = G(`${id}-box`),
      sel = G(id);
    if (!box || !sel) continue;
    if (members.length < 2) {
      box.style.display = 'none';
      continue;
    }
    const vorher = sel.value;
    setzeHtml(sel, rawHtml(markup));
    if (vorher && [...sel.querySelectorAll('option')].some(o => o.value === vorher)) sel.value = vorher;
    box.style.display = '';
  }
}

// Generated select fields carry texts in the language they were built in; redraw them on a change, the
// choice stays. loadLocations() updates the storage locations including stock and filters.
subscribe('spracheGewechselt', () => {
  if (!_haushalt.length) return;
  initScopeSelects(_haushalt);
  drawAccountSelection(_haushalt);
  loadLocations().catch(() => {});
});

/**
 * The storage location fields of the five capture paths, drawn once from locationBlock() instead of five times in the HTML.
 * Together with the account selection, because both wait until the household is loaded.
 */
export const ERFASSUNGS_ORTFELDER = ['add-storage', 'ap-storage', 'af-storage', 'cat-m-storage', 'mk-take-storage'];

/**
 * The storage location that should already be there when capturing — Marco's star.
 *
 * "Furthermore I would like to be able to set a storage location as default in the settings.
 *  It should then already be preselected for a new capture."
 *
 * Empty means: no default, the fields stand at "—" as before.
 */
let _locationDefault = '';

/**
 * Redraw a storage location field of a capture path.
 * @param {string} id
 * @param {string} wert
 */
function drawLocationField(id, wert) {
  const slot = G(`${id}-slot`);
  if (!slot) return;
  setzeHtml(slot, locationBlock(id, wert));
  // The visible label is in the HTML, the two controls are created here — a `for=` pointing at them
  // would be a dangling reference in the source (test/a11y.test.js reports exactly that, rightly). aria-labelledby
  // establishes the connection at runtime, and that for BOTH: select and text field carry the same name,
  // because they are the same field.
  for (const el of slot.children) el.setAttribute('aria-labelledby', `${id}-label`);
  slot.dataset.gezeichnet = '1';
}

export function drawLocationFields() {
  for (const id of ERFASSUNGS_ORTFELDER) {
    const slot = G(`${id}-slot`);
    // Only once: a second pass would throw away a choice already made.
    if (!slot || slot.dataset.gezeichnet === '1') continue;
    drawLocationField(id, _locationDefault);
  }
}

/**
 * The default lives with the stock (/v1/storage/locations), not with the occupied places. Only a still empty
 * field is filled in afterwards: whoever has chosen by themselves in the meantime keeps their choice.
 */
export async function loadLocationDefault() {
  const d = await api('GET', '/v1/storage/locations');
  if (!d?.success) return;
  _locationDefault = d.vorgabe?.name || '';
  if (!_locationDefault) return;
  for (const id of ERFASSUNGS_ORTFELDER) {
    if (!(G(id)?.value || '').trim()) drawLocationField(id, _locationDefault);
  }
}

/**
 * Establish the initial state: a place from before would look like a default. If there is a default, it
 * stands there; drawn instead of set, so that select and text field say the same thing.
 * @param {string} id
 */
export function emptyLocationField(id) {
  if (G(`${id}-slot`)) {
    drawLocationField(id, _locationDefault);
    return;
  }
  // Without a slot the composite field does not exist; then the old path stays. Today each of the
  // five capture paths has one (public/ index.html), but a form without a slot should not crash here.
  const feld = G(id),
    sel = G(`${id}-sel`);
  if (feld) {
    feld.value = _locationDefault;
    feld.style.display = 'none';
  }
  if (sel) sel.selectedIndex = 0;
}

/**
 * The chosen storage location, `''` if none is there — never undefined: a cleared field means "no place", a
 * missing key "take the default", and the server only inserts the default in the second case.
 * @param {string} id
 */
export function selectedStorage(id) {
  return (G(id)?.value || '').trim();
}

/**
 * A form's chosen target account — undefined as long as there is none.
 * @param {string} selectId
 */
export function selectedOwner(selectId) {
  const box = G(`${selectId}-box`),
    sel = G(selectId);
  if (!box || box.style.display === 'none' || !sel?.value) return undefined;
  return parseInt(sel.value, 10);
}
