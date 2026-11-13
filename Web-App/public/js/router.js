import { G } from './dom.js';
import { toast, verwirfToasts } from './meldungen.js';
import { tRaw } from '../i18n.js';
import { beiDialogWechsel, istOffen, obersterDialog } from './dialoge.js';
import { springe } from './ziele.js';
import { ME } from './zustand.js';

// Jede Ansicht als #/pfad, Filter als Query dahinter: Ein Hash-Router braucht keine Serverrouten, und
// Anmeldelinks (?token=, ?set=) bleiben unberührt. Offene Dialoge sind Verlaufseinträge, damit „Zurück“ sie
// schliesst.

/** Ansicht (data-tab bzw. Sicht) → Pfad in der Adresse. */
/** @type {Record<string, string>} */
export const PFADE = {
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
const ANSICHT = Object.fromEntries(Object.entries(PFADE).map(([a, p]) => [p, a]));
const SICHTEN = new Set(['profil', 'gutscheine', 'alarme', 'lagerorte', 'haushalt', 'daten', 'app']);
const NUR_VERWALTER = new Set(['monitor', 'settings']);

/** Abschnitte der Einstellungen: Element-ID ↔ Pfad. */
/** @type {Record<string, string>} */
const ABSCHNITTE = {
  'einst-design': 'erscheinungsbild',
  'einst-bl': 'bricklink',
  'einst-rb': 'rebrickable',
  'einst-bs': 'brickset',
  usermgmt: 'benutzer',
  'einst-smtp': 'e-mail',
  'einst-hintergrund': 'hintergrund',
  'einst-konfig': 'konfiguration',
};
const ABSCHNITT_ID = Object.fromEntries(Object.entries(ABSCHNITTE).map(([i, p]) => [p, i]));

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
const _vorgabe = new Map();
/**
 * @param {string} id
 */
function vorgabe(id) {
  if (!_vorgabe.has(id)) {
    const el = G(id);
    _vorgabe.set(id, el instanceof HTMLSelectElement ? (el.options[0]?.value ?? '') : '');
  }
  return _vorgabe.get(id);
}

let _ansicht = 'gallery';
let _wendeAn = 0; // > 0, solange der Router selbst umschaltet (kein neuer Eintrag)
let _eigeneZurueck = 0; // eigene history.back() nach dem Schliessen eines Dialogs
/** @type {(() => void)[]} */
let _danach = []; // Einträge, die erst nach diesem Zurück gesetzt werden dürfen
let _gestartet = false;

/** Der offene Einstellungsabschnitt als Pfad (aus der Leiste gelesen). */
function abschnitt() {
  const id = document.querySelector('.einst-nav a[aria-current="page"]')?.getAttribute('data-arg') || '';
  return ABSCHNITTE[id] || '';
}

/** Zerlegt `#/pfad/teil?a=b` in Ansicht, Unterpfad und Filter. */
export function leseAdresse(hash = location.hash) {
  if (!hash || hash === '#/') return { ansicht: 'gallery', unter: '', set: '', filter: {} };
  const m = /^#\/([^?]*)(?:\?(.*))?$/.exec(hash || '');
  if (!m) return null;
  const teile = m[1].split('/').filter(Boolean).map(decodeURIComponent);
  const filter = Object.fromEntries(new URLSearchParams(m[2] || ''));
  if (teile[0] === 'set' && teile[1]) return { ansicht: 'gallery', set: teile[1], filter: {} };
  const ansicht = ANSICHT[teile[0]];
  if (!ansicht) return null;
  const set = teile[1] === 'set' && teile[2] ? teile[2] : '';
  return { ansicht, unter: set ? '' : teile[1] || '', set, filter };
}

/**
 * @param {string} ansicht
 */
function filterVon(ansicht) {
  const q = new URLSearchParams();
  for (const [id, name] of Object.entries(FILTER[ansicht] || {})) {
    const v = /** @type {HTMLInputElement|null} */ (G(id))?.value?.trim();
    if (v && v !== vorgabe(id)) q.set(name, v);
  }
  return q.toString();
}

/** Die Adresse der aktuellen Ansicht, mit Filtern und Unterseite. */
function adresse(ansicht = _ansicht) {
  let pfad = '#/' + PFADE[ansicht];
  if (ansicht === 'settings' && abschnitt()) pfad += '/' + abschnitt();
  const q = filterVon(ansicht);
  return pfad + (q ? '?' + q : '');
}

function zustand(extra = {}) {
  return { brick: 1, ansicht: _ansicht, dlg: offeneDialoge(), ...extra };
}

function offeneDialoge() {
  return /** @type {string[]} */ (history.state?.dlg || []).slice();
}

/**
 * Eine Ansicht wurde gewechselt (Reiter, Menü, Umschalter).
 * @param {string} ansicht
 */
export function meldeAnsicht(ansicht) {
  if (!PFADE[ansicht]) return;
  const neu = ansicht !== _ansicht;
  if (neu) verwirfToasts();
  _ansicht = ansicht;
  if (!_gestartet || _wendeAn) return;
  // Ein offener Dialog bleibt nicht über einem Seitenwechsel stehen.
  const url = adresse();
  if (!neu && location.hash === url) return;
  history.pushState({ brick: 1, ansicht, dlg: [] }, '', url);
}

/** Einstellungsabschnitt per Klick gewechselt. */
export function meldeAbschnitt() {
  if (!_gestartet || _wendeAn || _ansicht !== 'settings' || location.hash === adresse()) return;
  history.pushState(zustand({ dlg: [] }), '', adresse());
}

/** Filter haben sich geändert: Adresse ersetzen, kein neuer Eintrag je Tastendruck. */
export function meldeFilter() {
  if (!_gestartet || _wendeAn) return;
  if (offeneDialoge().length) return;
  history.replaceState({ ...(history.state || {}), brick: 1, ansicht: _ansicht }, '', adresse());
}

/**
 * @param {string} id
 */
function dialogAdresse(id) {
  if (id === 'set-modal') {
    const nr = G('set-modal')?.dataset.nummer;
    if (nr) return '#/' + PFADE[_ansicht] + '/set/' + encodeURIComponent(nr);
  }
  return location.hash || adresse();
}

/**
 * Öffnen und Schliessen jedes Dialogs (aus dialoge.js, also nach einer Mikroaufgabe). Ob der Eintrag schon
 * stimmt, sagt deshalb der Verlauf selbst, nicht ein Merker: Nach „Zurück“ fehlt der Dialog dort bereits.
 */
/** @param {HTMLElement} dialog @param {boolean} offen */
function dialogGewechselt(dialog, offen) {
  if (!_gestartet || !dialog.id) return;
  if (_eigeneZurueck > 0) {
    _danach.push(() => dialogGewechselt(dialog, offen));
    return;
  }
  const stapel = offeneDialoge();
  if (offen) {
    if (stapel.includes(dialog.id)) return;
    history.pushState(zustand({ dlg: [...stapel, dialog.id] }), '', dialogAdresse(dialog.id));
    return;
  }
  // Vom Nutzer geschlossen (Knopf, Escape, Speichern): den eigenen Eintrag wieder abnehmen, sonst bräuchte
  // „Zurück“ einen leeren Schritt.
  if (stapel.at(-1) === dialog.id) {
    _eigeneZurueck++;
    history.back();
  } else if (stapel.includes(dialog.id))
    history.replaceState(zustand({ dlg: stapel.filter(d => d !== dialog.id) }), '', location.href);
}

/** @param {() => void} fn */
function mitRouter(fn) {
  _wendeAn++;
  try {
    return fn();
  } finally {
    _wendeAn--;
  }
}

/**
 * @param {HTMLElement} dialog
 */
function schliesse(dialog) {
  const zu = /** @type {HTMLElement|null} */ (dialog.querySelector('[data-dialog-zu]'));
  mitRouter(() => {
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
function zeigeAnsicht(ansicht, unter) {
  const abgewiesen = NUR_VERWALTER.has(ansicht) && !ME?.isAdmin;
  if (abgewiesen) ansicht = 'gallery';
  mitRouter(() => {
    if (ansicht === 'settings' && ABSCHNITT_ID[unter]) springe('einstAbschnitt', ABSCHNITT_ID[unter]);
    if (ansicht !== _ansicht || !document.getElementById('tab-' + ansicht)?.classList.contains('active')) {
      if (SICHTEN.has(ansicht)) springe('sicht', ansicht);
      else {
        const reiter = /** @type {HTMLElement|null} */ (document.querySelector(`.ntab[data-tab="${ansicht}"]`));
        reiter?.click();
      }
    }
  });
  if (ansicht !== _ansicht) verwirfToasts();
  _ansicht = ansicht;
  return abgewiesen;
}

/**
 * Die Adresse zeigte etwas anderes als die Ansicht: sagen, warum.
 * @param {string} grund
 */
function sageUmleitung(grund) {
  // Eine Umleitung ersetzt die vorige: Mehrere falsche Adressen hintereinander stapelten sonst Hinweise.
  verwirfToasts();
  toast(tRaw(grund === 'verwalter' ? 'router.nur_verwalter' : 'router.unbekannt'), 'info');
}
/** `#/…` ist ein Pfad der App; `#inhalt` oder `#` (Sprungverweis) nicht. */
const istAppPfad = (hash = location.hash) => /^#\/./.test(hash);

/** Filter aus der Adresse in die Felder; fehlt eine Option noch, folgt sie nach. */
/** @param {string} ansicht @param {Record<string, string>} filter */
function setzeFilter(ansicht, filter) {
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
    if (el.value !== soll && el instanceof HTMLSelectElement) wennOption(el, soll);
    else
      mitRouter(() =>
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })),
      );
  }
  return geaendert;
}

/** @param {HTMLSelectElement} sel @param {string} wert */
function wennOption(sel, wert) {
  const b = new MutationObserver(() => {
    if (![...sel.options].some(o => o.value === wert)) return;
    b.disconnect();
    sel.value = wert;
    mitRouter(() => sel.dispatchEvent(new Event('change', { bubbles: true })));
  });
  b.observe(sel, { childList: true, subtree: true });
  setTimeout(() => b.disconnect(), 15000);
}

/**
 * Den Zustand eines Verlaufseintrags herstellen (Zurück, Vor, Start).
 * @param {NonNullable<ReturnType<typeof leseAdresse>>} ziel @param {string[]} dlg
 * @returns {boolean} true, wenn die Ansicht abgewiesen wurde (Verwalterseite) */
function wendeAn(ziel, dlg) {
  // Dialoge, die im Ziel nicht offen sind, von oben her schliessen.
  for (let d = obersterDialog(), n = 0; d && n < 10; d = obersterDialog(), n++) {
    if (dlg.includes(d.id)) break;
    schliesse(d);
    if (obersterDialog() === d) break;
  }
  const abgewiesen = zeigeAnsicht(ziel.ansicht, ziel.unter ?? '');
  if (abgewiesen) return true;
  setzeFilter(ziel.ansicht, ziel.filter || {});
  if (ziel.set && !G('set-modal')?.classList.contains('open')) mitRouter(() => springe('setDetail', ziel.set));
  return false;
}

window.addEventListener('popstate', ev => {
  if (!_gestartet) return;
  if (_eigeneZurueck > 0) {
    if (--_eigeneZurueck === 0) {
      const f = _danach;
      _danach = [];
      for (const x of f) x();
    }
    return;
  }
  const ziel = leseAdresse();
  if (!ziel) {
    // Ein Sprungverweis (#inhalt, href="#") ist kein Ziel: Adresse zurückstellen. Ein unbekannter Pfad
    // dagegen zeigt die Sammlung und sagt es.
    const unbekannt = istAppPfad();
    if (unbekannt) zeigeAnsicht('gallery', '');
    history.replaceState(zustand(), '', adresse());
    if (unbekannt) sageUmleitung('unbekannt');
    return;
  }
  const dlg = /** @type {string[]} */ (ev.state?.dlg || (ziel.set ? ['set-modal'] : []));
  if (wendeAn(ziel, dlg)) {
    history.replaceState(zustand({ dlg: [] }), '', adresse());
    sageUmleitung('verwalter');
    return;
  }
  // Dialoge, die nicht wieder hergestellt werden können, fallen aus dem Eintrag.
  const offen = dlg.filter(id => (G(id) && istOffen(G(id))) || (id === 'set-modal' && ziel.set));
  history.replaceState({ brick: 1, ansicht: _ansicht, dlg: offen }, '', location.href);
});

/** Nach der Anmeldung: Adresse lesen und die Ansicht dazu öffnen. */
export function routeBeimStart() {
  const ziel = leseAdresse();
  _gestartet = true;
  if (!ziel) {
    const unbekannt = istAppPfad();
    history.replaceState({ brick: 1, ansicht: _ansicht, dlg: [] }, '', location.pathname + location.search);
    if (unbekannt) sageUmleitung('unbekannt');
    return;
  }
  const abgewiesen = wendeAn(ziel, []);
  history.replaceState({ brick: 1, ansicht: _ansicht, dlg: [] }, '', adresse());
  if (abgewiesen) {
    sageUmleitung('verwalter');
    return;
  }
  // Ein Set-Link öffnet den Dialog über der Ansicht; „Zurück“ schliesst ihn.
  if (ziel.set) springe('setDetail', ziel.set);
}

// Filtereingaben laufen über die Felder; die Adresse folgt nach.
if (typeof document !== 'undefined') {
  for (const art of ['input', 'change'])
    document.addEventListener(art, ev => {
      const id = /** @type {HTMLElement} */ (ev.target)?.id;
      if (id && FILTERFELD.get(id) === _ansicht) meldeFilter();
    });
  beiDialogWechsel(dialogGewechselt);
}
