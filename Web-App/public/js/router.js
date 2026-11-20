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
  profil: 'konto',
  gutscheine: 'gutscheine',
  alarme: 'alarme',
  lagerorte: 'lagerorte',
  haushalt: 'haushalt',
  daten: 'daten',
  app: 'app',
};
const VIEW = Object.fromEntries(Object.entries(PATHS).map(([a, p]) => [p, a]));
const VIEWS = new Set(['profil', 'gutscheine', 'alarme', 'lagerorte', 'haushalt', 'daten', 'app']);
const ONLY_ADMIN = new Set(['monitor', 'settings']);

/** Sections of the settings: element ID ↔ path. */
/** @type {Record<string, string>} */
const SECTIONS = {
  'einst-design': 'erscheinungsbild',
  'einst-bl': 'bricklink',
  'einst-rb': 'rebrickable',
  'einst-bs': 'brickset',
  usermgmt: 'benutzer',
  'einst-smtp': 'e-mail',
  'einst-hintergrund': 'hintergrund',
  'einst-konfig': 'konfiguration',
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
    'parts-ordnung': 'ordnung',
    'parts-color': 'farbe',
    'parts-cat': 'kategorie',
  },
  minifigs: { 'fig-search': 'suche' },
};
const FILTERFELD = new Map(Object.entries(FILTER).flatMap(([a, f]) => Object.keys(f).map(id => [id, a])));
/** Values that stand in the fields on load: they do not belong in the address. */
const _default = new Map();
/**
 * @param {string} id
 */
function vorgabe(id) {
  if (!_default.has(id)) {
    const el = G(id);
    _default.set(id, el instanceof HTMLSelectElement ? (el.options[0]?.value ?? '') : '');
  }
  return _default.get(id);
}

let _view = 'gallery';
let _applyAn = 0; // > 0 while the router itself switches (no new entry)
let _ownBack = 0; // own history.back() after closing a dialog
/** @type {(() => void)[]} */
let _afterwards = []; // entries that may only be set after this back
let _started = false;

/** The open settings section as a path (read from the bar). */
function abschnitt() {
  const id = document.querySelector('.einst-nav a[aria-current="page"]')?.getAttribute('data-arg') || '';
  return SECTIONS[id] || '';
}

/** Splits `#/path/part?a=b` into view, subpath and filters. */
export function readAddress(hash = location.hash) {
  if (!hash || hash === '#/') return { ansicht: 'gallery', unter: '', set: '', filter: {} };
  const m = /^#\/([^?]*)(?:\?(.*))?$/.exec(hash || '');
  if (!m) return null;
  const teile = m[1].split('/').filter(Boolean).map(decodeURIComponent);
  const filter = Object.fromEntries(new URLSearchParams(m[2] || ''));
  if (teile[0] === 'set' && teile[1]) return { ansicht: 'gallery', set: teile[1], filter: {} };
  const ansicht = VIEW[teile[0]];
  if (!ansicht) return null;
  const set = teile[1] === 'set' && teile[2] ? teile[2] : '';
  return { ansicht, unter: set ? '' : teile[1] || '', set, filter };
}

/**
 * @param {string} ansicht
 */
function filterOf(ansicht) {
  const q = new URLSearchParams();
  for (const [id, name] of Object.entries(FILTER[ansicht] || {})) {
    const v = /** @type {HTMLInputElement|null} */ (G(id))?.value?.trim();
    if (v && v !== vorgabe(id)) q.set(name, v);
  }
  return q.toString();
}

/** The address of the current view, with filters and subpage. */
function adresse(ansicht = _view) {
  let pfad = '#/' + PATHS[ansicht];
  if (ansicht === 'settings' && abschnitt()) pfad += '/' + abschnitt();
  const q = filterOf(ansicht);
  return pfad + (q ? '?' + q : '');
}

function zustand(extra = {}) {
  return { brick: 1, ansicht: _view, dlg: openDialogs(), ...extra };
}

function openDialogs() {
  return /** @type {string[]} */ (history.state?.dlg || []).slice();
}

/**
 * A view was switched (tab, menu, switch).
 * @param {string} ansicht
 */
export function reportView(ansicht) {
  if (!PATHS[ansicht]) return;
  const neu = ansicht !== _view;
  if (neu) discardToasts();
  _view = ansicht;
  if (!_started || _applyAn) return;
  // An open dialog does not stay above a page change.
  const url = adresse();
  if (!neu && location.hash === url) return;
  history.pushState({ brick: 1, ansicht, dlg: [] }, '', url);
}

/** Settings section switched by click. */
export function reportSection() {
  if (!_started || _applyAn || _view !== 'settings' || location.hash === adresse()) return;
  history.pushState(zustand({ dlg: [] }), '', adresse());
}

/** Filters have changed: replace the address, no new entry per key press. */
export function reportFilter() {
  if (!_started || _applyAn) return;
  if (openDialogs().length) return;
  history.replaceState({ ...(history.state || {}), brick: 1, ansicht: _view }, '', adresse());
}

/**
 * @param {string} id
 */
function dialogAddress(id) {
  if (id === 'set-modal') {
    const nr = G('set-modal')?.dataset.nummer;
    if (nr) return '#/' + PATHS[_view] + '/set/' + encodeURIComponent(nr);
  }
  return location.hash || adresse();
}

/**
 * Opening and closing of every dialog (from dialogs.js, i.e. after a microtask). Whether the entry is already
 * right is therefore said by the history itself, not by a flag: after "back" the dialog is already missing there.
 */
/** @param {HTMLElement} dialog @param {boolean} offen */
function dialogSwitched(dialog, offen) {
  if (!_started || !dialog.id) return;
  if (_ownBack > 0) {
    _afterwards.push(() => dialogSwitched(dialog, offen));
    return;
  }
  const stapel = openDialogs();
  if (offen) {
    if (stapel.includes(dialog.id)) return;
    history.pushState(zustand({ dlg: [...stapel, dialog.id] }), '', dialogAddress(dialog.id));
    return;
  }
  // Closed by the user (button, Escape, save): remove the own entry again, otherwise "back" would need
  // an empty step.
  if (stapel.at(-1) === dialog.id) {
    _ownBack++;
    history.back();
  } else if (stapel.includes(dialog.id))
    history.replaceState(zustand({ dlg: stapel.filter(d => d !== dialog.id) }), '', location.href);
}

/** @param {() => void} fn */
function withRouter(fn) {
  _applyAn++;
  try {
    return fn();
  } finally {
    _applyAn--;
  }
}

/**
 * @param {HTMLElement} dialog
 */
function schliesse(dialog) {
  const zu = /** @type {HTMLElement|null} */ (dialog.querySelector('[data-dialog-zu]'));
  withRouter(() => {
    if (zu) zu.click();
    else {
      dialog.classList.remove('open');
      dialog.style.display = dialog.style.display ? 'none' : '';
    }
  });
}

/**
 * Open a view without creating an entry. An admin page opens the collection for other accounts;
 * true means "rejected", so that the caller sets the address accordingly and says so.
 * @param {string} ansicht
 * @param {string} unter
 */
function showView(ansicht, unter) {
  const abgewiesen = ONLY_ADMIN.has(ansicht) && !loggedInAccount?.isAdmin;
  if (abgewiesen) ansicht = 'gallery';
  withRouter(() => {
    if (ansicht === 'settings' && SECTION_ID[unter]) jumpTo('einstAbschnitt', SECTION_ID[unter]);
    if (ansicht !== _view || !document.getElementById('tab-' + ansicht)?.classList.contains('active')) {
      if (VIEWS.has(ansicht)) jumpTo('view', ansicht);
      else {
        const reiter = /** @type {HTMLElement|null} */ (document.querySelector(`.ntab[data-tab="${ansicht}"]`));
        reiter?.click();
      }
    }
  });
  if (ansicht !== _view) discardToasts();
  _view = ansicht;
  return abgewiesen;
}

/**
 * The address showed something other than the view: say why.
 * @param {string} grund
 */
function sayRedirect(grund) {
  // A redirect replaces the previous one: several wrong addresses in a row would otherwise stack hints.
  discardToasts();
  toast(tRaw(grund === 'verwalter' ? 'router.nur_verwalter' : 'router.unbekannt'), 'info');
}
/** `#/…` is a path of the app; `#inhalt` or `#` (skip link) is not. */
const isAppPath = (hash = location.hash) => /^#\/./.test(hash);

/** Filters from the address into the fields; if an option is still missing, it follows later. */
/** @param {string} ansicht @param {Record<string, string>} filter */
function setFilter(ansicht, filter) {
  const felder = FILTER[ansicht];
  if (!felder) return false;
  let geaendert = false;
  for (const [id, name] of Object.entries(felder)) {
    const el = /** @type {HTMLInputElement|HTMLSelectElement|null} */ (G(id));
    if (!el) continue;
    const soll = filter[name] || vorgabe(id);
    if (el.value === soll) continue;
    el.value = soll;
    geaendert = true;
    if (el.value !== soll && el instanceof HTMLSelectElement) ifOption(el, soll);
    else
      withRouter(() =>
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })),
      );
  }
  return geaendert;
}

/** @param {HTMLSelectElement} sel @param {string} wert */
function ifOption(sel, wert) {
  const b = new MutationObserver(() => {
    if (![...sel.options].some(o => o.value === wert)) return;
    b.disconnect();
    sel.value = wert;
    withRouter(() => sel.dispatchEvent(new Event('change', { bubbles: true })));
  });
  b.observe(sel, { childList: true, subtree: true });
  setTimeout(() => b.disconnect(), 15000);
}

/**
 * Establish the state of a history entry (back, forward, start).
 * @param {NonNullable<ReturnType<typeof readAddress>>} ziel @param {string[]} dlg
 * @returns {boolean} true if the view was rejected (admin page) */
function applyAn(ziel, dlg) {
  // Close dialogs that are not open in the target, from the top down.
  for (let d = topDialog(), n = 0; d && n < 10; d = topDialog(), n++) {
    if (dlg.includes(d.id)) break;
    schliesse(d);
    if (topDialog() === d) break;
  }
  const abgewiesen = showView(ziel.ansicht, ziel.unter ?? '');
  if (abgewiesen) return true;
  setFilter(ziel.ansicht, ziel.filter || {});
  if (ziel.set && !G('set-modal')?.classList.contains('open')) withRouter(() => jumpTo('setDetail', ziel.set));
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
  const ziel = readAddress();
  if (!ziel) {
    // A skip link (#inhalt, href="#") is not a target: restore the address. An unknown path
    // on the other hand shows the collection and says so.
    const unbekannt = isAppPath();
    if (unbekannt) showView('gallery', '');
    history.replaceState(zustand(), '', adresse());
    if (unbekannt) sayRedirect('unbekannt');
    return;
  }
  const dlg = /** @type {string[]} */ (ev.state?.dlg || (ziel.set ? ['set-modal'] : []));
  if (applyAn(ziel, dlg)) {
    history.replaceState(zustand({ dlg: [] }), '', adresse());
    sayRedirect('verwalter');
    return;
  }
  // Dialogs that cannot be restored drop out of the entry.
  const offen = dlg.filter(id => (G(id) && isOpen(G(id))) || (id === 'set-modal' && ziel.set));
  history.replaceState({ brick: 1, ansicht: _view, dlg: offen }, '', location.href);
});

/** After login: read the address and open the matching view. */
export function routeOnStart() {
  const ziel = readAddress();
  _started = true;
  if (!ziel) {
    const unbekannt = isAppPath();
    history.replaceState({ brick: 1, ansicht: _view, dlg: [] }, '', location.pathname + location.search);
    if (unbekannt) sayRedirect('unbekannt');
    return;
  }
  const abgewiesen = applyAn(ziel, []);
  history.replaceState({ brick: 1, ansicht: _view, dlg: [] }, '', adresse());
  if (abgewiesen) {
    sayRedirect('verwalter');
    return;
  }
  // A set link opens the dialog above the view; "back" closes it.
  if (ziel.set) jumpTo('setDetail', ziel.set);
}

// Filter inputs go through the fields; the address follows.
if (typeof document !== 'undefined') {
  for (const art of ['input', 'change'])
    document.addEventListener(art, ev => {
      const id = /** @type {HTMLElement} */ (ev.target)?.id;
      if (id && FILTERFELD.get(id) === _view) reportFilter();
    });
  onDialogChange(dialogSwitched);
}
