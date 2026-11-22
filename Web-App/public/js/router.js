import { G } from './dom.js';
import { toast, discardToasts } from './messages.js';
import { tRaw } from '../i18n.js';
import { onDialogChange, isOpen, topDialog } from './dialogs.js';
import { jumpTo } from './targets.js';
import { loggedInAccount } from './state.js';

// Every view as #/path, filters as a query behind it: a hash router needs no server routes, and
// login links (?token=, ?set=) stay untouched. Open dialogs are history entries, so that "back"
// closes them.

/** View (data-tab or view) → path in the address. */
/** @type {Record<string, string>} */
export const PATHS = {
  gallery: 'sammlung',
  parts: 'teile',
  minifigs: 'minifiguren',
  partslist: 'bauliste',
  finance: 'finanzen',
  wanted: 'merkliste',
  catalog: 'katalog',
  monitor: 'hintergrund',
  settings: 'einstellungen',
  profile: 'konto',
  vouchers: 'gutscheine',
  alerts: 'alarme',
  locations: 'lagerorte',
  household: 'haushalt',
  data: 'daten',
  app: 'app',
};
const VIEW = Object.fromEntries(Object.entries(PATHS).map(([a, p]) => [p, a]));
const VIEWS = new Set(['profile', 'vouchers', 'alerts', 'locations', 'household', 'data', 'app']);
const ONLY_ADMIN = new Set(['monitor', 'settings']);

/** Sections of the settings: element ID ↔ path. */
/** @type {Record<string, string>} */
const SECTIONS = {
  'settings-design': 'erscheinungsbild',
  'settings-bl': 'bricklink',
  'settings-rb': 'rebrickable',
  'settings-bs': 'brickset',
  usermgmt: 'benutzer',
  'settings-smtp': 'e-mail',
  'settings-background': 'hintergrund',
  'settings-config': 'konfiguration',
};
const SECTION_ID = Object.fromEntries(Object.entries(SECTIONS).map(([i, p]) => [p, i]));

/** Filter fields per view → name of the query parameter. */
/** @type {Record<string, Record<string, string>>} */
const FILTER = {
  gallery: { gs: 'suche', gtheme: 'thema', gsort: 'sortierung' },
  catalog: {
    'cat-search': 'suche',
    'cat-theme': 'thema',
    'cat-year-from': 'von',
    'cat-year-to': 'bis',
    'cat-sort': 'sortierung',
  },
  wanted: { mks: 'suche', mkcond: 'zustand', mksort: 'sortierung' },
  parts: {
    'parts-search': 'suche',
    'parts-spare': 'ersatz',
    'parts-order': 'ordnung',
    'parts-color': 'farbe',
    'parts-cat': 'kategorie',
  },
  minifigs: { 'fig-search': 'suche' },
};
const FILTER_FIELD = new Map(Object.entries(FILTER).flatMap(([a, f]) => Object.keys(f).map(id => [id, a])));
/** Values that stand in the fields on load: they do not belong in the address. */
const _default = new Map();
/**
 * @param {string} id
 */
function defaultFor(id) {
  if (!_default.has(id)) {
    const el = G(id);
    _default.set(id, el instanceof HTMLSelectElement ? (el.options[0]?.value ?? '') : '');
  }
  return _default.get(id);
}

let _view = 'gallery';
let _applyOn = 0; // > 0 while the router itself switches (no new entry)
let _ownBack = 0; // own history.back() after closing a dialog
/** @type {(() => void)[]} */
let _afterwards = []; // entries that may only be set after this back
let _started = false;

/** The open settings section as a path (read from the bar). */
function section() {
  const id = document.querySelector('.settings-nav a[aria-current="page"]')?.getAttribute('data-arg') || '';
  return SECTIONS[id] || '';
}

/** Splits `#/path/part?a=b` into view, subpath and filters. */
export function readAddress(hash = location.hash) {
  if (!hash || hash === '#/') return { view: 'gallery', sub: '', set: '', filter: {} };
  const m = /^#\/([^?]*)(?:\?(.*))?$/.exec(hash || '');
  if (!m) return null;
  const parts = m[1].split('/').filter(Boolean).map(decodeURIComponent);
  const filter = Object.fromEntries(new URLSearchParams(m[2] || ''));
  if (parts[0] === 'set' && parts[1]) return { view: 'gallery', set: parts[1], filter: {} };
  const view = VIEW[parts[0]];
  if (!view) return null;
  const set = parts[1] === 'set' && parts[2] ? parts[2] : '';
  return { view, sub: set ? '' : parts[1] || '', set, filter };
}

/**
 * @param {string} view
 */
function filterOf(view) {
  const q = new URLSearchParams();
  for (const [id, name] of Object.entries(FILTER[view] || {})) {
    const v = /** @type {HTMLInputElement|null} */ (G(id))?.value?.trim();
    if (v && v !== defaultFor(id)) q.set(name, v);
  }
  return q.toString();
}

/** The address of the current view, with filters and subpage. */
function address(view = _view) {
  let path = '#/' + PATHS[view];
  if (view === 'settings' && section()) path += '/' + section();
  const q = filterOf(view);
  return path + (q ? '?' + q : '');
}

function state(extra = {}) {
  return { brick: 1, view: _view, dlg: openDialogs(), ...extra };
}

function openDialogs() {
  return /** @type {string[]} */ (history.state?.dlg || []).slice();
}

/**
 * A view was switched (tab, menu, switch).
 * @param {string} view
 */
export function reportView(view) {
  if (!PATHS[view]) return;
  const newValue = view !== _view;
  if (newValue) discardToasts();
  _view = view;
  if (!_started || _applyOn) return;
  // An open dialog does not stay above a page change.
  const url = address();
  if (!newValue && location.hash === url) return;
  history.pushState({ brick: 1, view, dlg: [] }, '', url);
}

/** Settings section switched by click. */
export function reportSection() {
  if (!_started || _applyOn || _view !== 'settings' || location.hash === address()) return;
  history.pushState(state({ dlg: [] }), '', address());
}

/** Filters have changed: replace the address, no new entry per key press. */
export function reportFilter() {
  if (!_started || _applyOn) return;
  if (openDialogs().length) return;
  history.replaceState({ ...(history.state || {}), brick: 1, view: _view }, '', address());
}

/**
 * @param {string} id
 */
function dialogAddress(id) {
  if (id === 'set-modal') {
    const nr = G('set-modal')?.dataset.number;
    if (nr) return '#/' + PATHS[_view] + '/set/' + encodeURIComponent(nr);
  }
  return location.hash || address();
}

/**
 * Opening and closing of every dialog (from dialogs.js, i.e. after a microtask). Whether the entry is already
 * right is therefore said by the history itself, not by a flag: after "back" the dialog is already missing there.
 */
/** @param {HTMLElement} dialog @param {boolean} open */
function dialogSwitched(dialog, open) {
  if (!_started || !dialog.id) return;
  if (_ownBack > 0) {
    _afterwards.push(() => dialogSwitched(dialog, open));
    return;
  }
  const batch = openDialogs();
  if (open) {
    if (batch.includes(dialog.id)) return;
    history.pushState(state({ dlg: [...batch, dialog.id] }), '', dialogAddress(dialog.id));
    return;
  }
  // Closed by the user (button, Escape, save): remove the own entry again, otherwise "back" would need
  // an empty step.
  if (batch.at(-1) === dialog.id) {
    _ownBack++;
    history.back();
  } else if (batch.includes(dialog.id))
    history.replaceState(state({ dlg: batch.filter(d => d !== dialog.id) }), '', location.href);
}

/** @param {() => void} fn */
function withRouter(fn) {
  _applyOn++;
  try {
    return fn();
  } finally {
    _applyOn--;
  }
}

/**
 * @param {HTMLElement} dialog
 */
function close(dialog) {
  const close = /** @type {HTMLElement|null} */ (dialog.querySelector('[data-dialog-close]'));
  withRouter(() => {
    if (close) close.click();
    else {
      dialog.classList.remove('open');
      dialog.style.display = dialog.style.display ? 'none' : '';
    }
  });
}

/**
 * Open a view without creating an entry. An admin page opens the collection for other accounts;
 * true means "rejected", so that the caller sets the address accordingly and says so.
 * @param {string} view
 * @param {string} sub
 */
function showView(view, sub) {
  const rejected = ONLY_ADMIN.has(view) && !loggedInAccount?.isAdmin;
  if (rejected) view = 'gallery';
  withRouter(() => {
    if (view === 'settings' && SECTION_ID[sub]) jumpTo('settingsSection', SECTION_ID[sub]);
    if (view !== _view || !document.getElementById('tab-' + view)?.classList.contains('active')) {
      if (VIEWS.has(view)) jumpTo('view', view);
      else {
        const tab = /** @type {HTMLElement|null} */ (document.querySelector(`.ntab[data-tab="${view}"]`));
        tab?.click();
      }
    }
  });
  if (view !== _view) discardToasts();
  _view = view;
  return rejected;
}

/**
 * The address showed something other than the view: say why.
 * @param {string} reason
 */
function sayRedirect(reason) {
  // A redirect replaces the previous one: several wrong addresses in a row would otherwise stack hints.
  discardToasts();
  toast(tRaw(reason === 'admin' ? 'router.only_admin' : 'router.unknown'), 'info');
}
/** `#/…` is a path of the app; `#content` or `#` (skip link) is not. */
const isAppPath = (hash = location.hash) => /^#\/./.test(hash);

/** Filters from the address into the fields; if an option is still missing, it follows later. */
/** @param {string} view @param {Record<string, string>} filter */
function setFilter(view, filter) {
  const fields = FILTER[view];
  if (!fields) return false;
  let changed = false;
  for (const [id, name] of Object.entries(fields)) {
    const el = /** @type {HTMLInputElement|HTMLSelectElement|null} */ (G(id));
    if (!el) continue;
    const should = filter[name] || defaultFor(id);
    if (el.value === should) continue;
    el.value = should;
    changed = true;
    if (el.value !== should && el instanceof HTMLSelectElement) ifOption(el, should);
    else
      withRouter(() =>
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })),
      );
  }
  return changed;
}

/** @param {HTMLSelectElement} sel @param {string} value */
function ifOption(sel, value) {
  const b = new MutationObserver(() => {
    if (![...sel.options].some(o => o.value === value)) return;
    b.disconnect();
    sel.value = value;
    withRouter(() => sel.dispatchEvent(new Event('change', { bubbles: true })));
  });
  b.observe(sel, { childList: true, subtree: true });
  setTimeout(() => b.disconnect(), 15000);
}

/**
 * Establish the state of a history entry (back, forward, start).
 * @param {NonNullable<ReturnType<typeof readAddress>>} target @param {string[]} dlg
 * @returns {boolean} true if the view was rejected (admin page) */
function applyOn(target, dlg) {
  // Close dialogs that are not open in the target, from the top down.
  for (let d = topDialog(), n = 0; d && n < 10; d = topDialog(), n++) {
    if (dlg.includes(d.id)) break;
    close(d);
    if (topDialog() === d) break;
  }
  const rejected = showView(target.view, target.sub ?? '');
  if (rejected) return true;
  setFilter(target.view, target.filter || {});
  if (target.set && !G('set-modal')?.classList.contains('open')) withRouter(() => jumpTo('setDetail', target.set));
  return false;
}

window.addEventListener('popstate', ev => {
  if (!_started) return;
  if (_ownBack > 0) {
    if (--_ownBack === 0) {
      const f = _afterwards;
      _afterwards = [];
      for (const x of f) x();
    }
    return;
  }
  const target = readAddress();
  if (!target) {
    // A skip link (#content, href="#") is not a target: restore the address. An unknown path
    // on the other hand shows the collection and says so.
    const unknown = isAppPath();
    if (unknown) showView('gallery', '');
    history.replaceState(state(), '', address());
    if (unknown) sayRedirect('unknown');
    return;
  }
  const dlg = /** @type {string[]} */ (ev.state?.dlg || (target.set ? ['set-modal'] : []));
  if (applyOn(target, dlg)) {
    history.replaceState(state({ dlg: [] }), '', address());
    sayRedirect('admin');
    return;
  }
  // Dialogs that cannot be restored drop out of the entry.
  const open = dlg.filter(id => (G(id) && isOpen(G(id))) || (id === 'set-modal' && target.set));
  history.replaceState({ brick: 1, view: _view, dlg: open }, '', location.href);
});

/** After login: read the address and open the matching view. */
export function routeOnStart() {
  const target = readAddress();
  _started = true;
  if (!target) {
    const unknown = isAppPath();
    history.replaceState({ brick: 1, view: _view, dlg: [] }, '', location.pathname + location.search);
    if (unknown) sayRedirect('unknown');
    return;
  }
  const rejected = applyOn(target, []);
  history.replaceState({ brick: 1, view: _view, dlg: [] }, '', address());
  if (rejected) {
    sayRedirect('admin');
    return;
  }
  // A set link opens the dialog above the view; "back" closes it.
  if (target.set) jumpTo('setDetail', target.set);
}

// Filter inputs go through the fields; the address follows.
if (typeof document !== 'undefined') {
  for (const kind of ['input', 'change'])
    document.addEventListener(kind, ev => {
      const id = /** @type {HTMLElement} */ (ev.target)?.id;
      if (id && FILTER_FIELD.get(id) === _view) reportFilter();
    });
  onDialogChange(dialogSwitched);
}
