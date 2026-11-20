import { G } from './dom.js';
import { toast, discardToasts } from './messages.js';
import { tRaw } from '../i18n.js';
import { onDialogChange, isOpen, topDialog } from './dialogs.js';
import { jumpTo } from './targets.js';
import { loggedInAccount } from './state.js';

// Jede Ansicht als #/pfad, Filter als Query dahinter: Ein Hash-Router braucht keine Serverrouten, und
// Anmeldelinks (?token=, ?set=) bleiben unberührt. Offene Dialoge sind Verlaufseinträge, damit „Zurück“ sie
// schliesst.

/** Ansicht (data-tab bzw. Sicht) → Pfad in der Adresse. */
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

/** Abschnitte der Einstellungen: Element-ID ↔ Pfad. */
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

/** Filterfelder je Ansicht → Name des Query-Parameters. */
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
/** Werte, die beim Laden in den Feldern stehen: Sie gehören nicht in die Adresse. */
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
let _applyAn = 0; // > 0, solange der Router selbst umschaltet (kein neuer Eintrag)
let _ownBack = 0; // eigene history.back() nach dem Schliessen eines Dialogs
/** @type {(() => void)[]} */
let _afterwards = []; // Einträge, die erst nach diesem Zurück gesetzt werden dürfen
let _started = false;

/** Der offene Einstellungsabschnitt als Pfad (aus der Leiste gelesen). */
function abschnitt() {
  const id = document.querySelector('.einst-nav a[aria-current="page"]')?.getAttribute('data-arg') || '';
  return SECTIONS[id] || '';
}

/** Zerlegt `#/pfad/teil?a=b` in Ansicht, Unterpfad und Filter. */
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

/** Die Adresse der aktuellen Ansicht, mit Filtern und Unterseite. */
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
 * Eine Ansicht wurde gewechselt (Reiter, Menü, Umschalter).
 * @param {string} ansicht
 */
export function reportView(ansicht) {
  if (!PATHS[ansicht]) return;
  const neu = ansicht !== _view;
  if (neu) discardToasts();
  _view = ansicht;
  if (!_started || _applyAn) return;
  // Ein offener Dialog bleibt nicht über einem Seitenwechsel stehen.
  const url = adresse();
  if (!neu && location.hash === url) return;
  history.pushState({ brick: 1, ansicht, dlg: [] }, '', url);
}

/** Einstellungsabschnitt per Klick gewechselt. */
export function reportSection() {
  if (!_started || _applyAn || _view !== 'settings' || location.hash === adresse()) return;
  history.pushState(zustand({ dlg: [] }), '', adresse());
}

/** Filter haben sich geändert: Adresse ersetzen, kein neuer Eintrag je Tastendruck. */
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
 * Öffnen und Schliessen jedes Dialogs (aus dialogs.js, also nach einer Mikroaufgabe). Ob der Eintrag schon
 * stimmt, sagt deshalb der Verlauf selbst, nicht ein Merker: Nach „Zurück“ fehlt der Dialog dort bereits.
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
  // Vom Nutzer geschlossen (Knopf, Escape, Speichern): den eigenen Eintrag wieder abnehmen, sonst bräuchte
  // „Zurück“ einen leeren Schritt.
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
 * Ansicht öffnen, ohne einen Eintrag anzulegen. Eine Verwalterseite öffnet für andere Konten die Sammlung;
 * true heisst „abgewiesen“, damit der Aufrufer die Adresse dazu passend setzt und es sagt.
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
 * Die Adresse zeigte etwas anderes als die Ansicht: sagen, warum.
 * @param {string} grund
 */
function sayRedirect(grund) {
  // Eine Umleitung ersetzt die vorige: Mehrere falsche Adressen hintereinander stapelten sonst Hinweise.
  discardToasts();
  toast(tRaw(grund === 'verwalter' ? 'router.nur_verwalter' : 'router.unbekannt'), 'info');
}
/** `#/…` ist ein Pfad der App; `#inhalt` oder `#` (Sprungverweis) nicht. */
const isAppPath = (hash = location.hash) => /^#\/./.test(hash);

/** Filter aus der Adresse in die Felder; fehlt eine Option noch, folgt sie nach. */
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
 * Den Zustand eines Verlaufseintrags herstellen (Zurück, Vor, Start).
 * @param {NonNullable<ReturnType<typeof readAddress>>} ziel @param {string[]} dlg
 * @returns {boolean} true, wenn die Ansicht abgewiesen wurde (Verwalterseite) */
function applyAn(ziel, dlg) {
  // Dialoge, die im Ziel nicht offen sind, von oben her schliessen.
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
    // Ein Sprungverweis (#inhalt, href="#") ist kein Ziel: Adresse zurückstellen. Ein unbekannter Pfad
    // dagegen zeigt die Sammlung und sagt es.
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
  // Dialoge, die nicht wieder hergestellt werden können, fallen aus dem Eintrag.
  const offen = dlg.filter(id => (G(id) && isOpen(G(id))) || (id === 'set-modal' && ziel.set));
  history.replaceState({ brick: 1, ansicht: _view, dlg: offen }, '', location.href);
});

/** Nach der Anmeldung: Adresse lesen und die Ansicht dazu öffnen. */
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
  // Ein Set-Link öffnet den Dialog über der Ansicht; „Zurück“ schliesst ihn.
  if (ziel.set) jumpTo('setDetail', ziel.set);
}

// Filtereingaben laufen über die Felder; die Adresse folgt nach.
if (typeof document !== 'undefined') {
  for (const art of ['input', 'change'])
    document.addEventListener(art, ev => {
      const id = /** @type {HTMLElement} */ (ev.target)?.id;
      if (id && FILTERFELD.get(id) === _view) reportFilter();
    });
  onDialogChange(dialogSwitched);
}
