// Tabs, user menu, views and the filters that reload several lists. Stands above all views and
// may load each; the router reaches the views via targets.js, not via an import.
import { registerTarget } from './targets.js';
import { registerActions } from './registry.js';
import { G, emptyState, alle, eins, setzeHtml, rollArt } from './dom.js';
import { loggedInAccount, lastImportAt } from './state.js';
import { loadSchedules, loadMonitor, stopMonitor } from './monitor.js';
import { resetMinifigsFilter, loadManualFigsTable, loadMinifigs } from './minifigs.js';
import { initCatalog, resetCatalog } from './catalog.js';
import { pollJobStatus, stopJobPolling } from './admin.js';
import { ladeAlarmUebersicht } from './alerts.js';
import { ladeLagerortVerwaltung } from './storage-locations.js';
import {
  loadApiLimits,
  loadCacheStats,
  loadCacheTtl,
  loadProfile,
  loadRateLimitStats,
  loadSettings,
} from './settings.js';
import { loadTls, loadTokens } from './accesses.js';
import { loadHousehold } from './household.js';
import { ladeGutscheine } from './vouchers.js';
import { ladeMerkliste, resetWantedFilter } from './wanted.js';
import { loadTrash } from './trash.js';
import { ladePasskeys } from './passkeys.js';
import { ladeZweitenFaktor } from './second-factor.js';
import { loadParts, resetPartsFilter, loadManualParts } from './parts.js';
import { loadBrickColors } from './part-add.js';
import { reportView, reportFilter } from './router.js';
import { setLagerModus, setScopeMode } from './account-filter.js';
import { collectionSubtitle } from './account-locations.js';
import { setScrollLabel } from './scrollbar.js';
import { tRaw } from '../i18n.js';
import { subscribe, emit } from './events.js';
import { esc } from './escaping.js';

// Mirror the tab's icon into the page title (left of the text), so that the same icon as in the nav tab appears
// at the top. The source is the nav tab itself — emoji OR inline SVG —, that way both stay in sync automatically.
/**
 * @param {string | undefined} tab
 */
function syncTabTitleIcon(tab) {
  const nav = document.querySelector(`.ntab[data-tab="${tab}"]`);
  const slot = document.querySelector(`.ptitle[data-tab-title="${esc(tab)}"] .ptitle-icon`);
  if (!nav || !slot) return;
  // Everything before the .tab-label is the icon (emoji text node or <svg>).
  const label = nav.querySelector('.tab-label');
  // Copies instead of outerHTML: re-read as text, the icon's style would stand there as a style attribute again,
  // and the CSP forbids that.
  const kopien = [];
  for (const node of nav.childNodes) {
    if (node === label) break;
    if (node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').trim() : true) kopien.push(node.cloneNode(true));
  }
  slot.replaceChildren(...kopien);
}

/**
 * Sets, parts and minifigures share ONE target in the bar ("collection"); switching happens at the top of the
 * page. Parts and minifigures keep their invisible tab — code and restoration address them
 * through it.
 */
const SAMMLUNG = ['gallery', 'parts', 'minifigs'];

/**
 * @param {string | null | undefined} tab
 */
function markGroup(tab) {
  // An own class instead of .active: `.ntab.active` everywhere names the open tab.
  const sammlung = document.querySelector('.ntab[data-tab="gallery"]');
  sammlung?.classList.toggle('gruppe-aktiv', !!tab && SAMMLUNG.includes(tab));
  // The three buttons switch the view; the open one is the current page.
  alle('.sammlung-wahl [data-arg]').forEach(b => {
    if (b.dataset.arg === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  // That way screen readers learn which tab is open. "Collection" only counts as the current page if
  // the view's own tab is not visible (on the phone).
  const offen = document.querySelector('.ntab.active');
  const openVisible = !!offen?.getClientRects().length;
  document.querySelectorAll('.ntab').forEach(x => {
    if (x.classList.contains('active') || (x.classList.contains('gruppe-aktiv') && !openVisible && x !== offen))
      x.setAttribute('aria-current', 'page');
    else x.removeAttribute('aria-current');
  });
}

/** On the phone: the filters behind a button, so that the list starts at the top. @this {HTMLElement} */
export function filterUmschalten() {
  const leiste = this?.closest?.('.filterleiste');
  if (!leiste) return;
  const offen = leiste.classList.toggle('offen');
  this.setAttribute('aria-expanded', String(offen));
}

/** Whoever is not an admin sees a sentence in the settings tab instead of an empty page. */
function showSettingAccess() {
  const f = G('einst-kein-zugriff');
  if (!f) return;
  f.hidden = !!loggedInAccount?.isAdmin;
  setzeHtml(
    f,
    loggedInAccount?.isAdmin
      ? ''
      : emptyState({ ico: 'schloss', titel: tRaw('settings.kein_zugriff'), text: tRaw('settings.kein_zugriff_text') }),
  );
}

/**
 * Open a tab — from the collection's switch or the menu.
 * @param {string} name
 */
export function oeffneReiter(name) {
  const fromMenu = !!G('umenu-pop')?.contains(document.activeElement);
  closeMenu();
  eins(`.ntab[data-tab="${name}"]`)?.click();
  if (fromMenu) focusOnTitle(G('tab-' + name));
}

/**
 * After a choice in the menu the focus is on a now hidden entry and would fall to the page start;
 * the heading of the new page is the place where keyboard and screen reader continue.
 */
/** @param {HTMLElement | null} flaeche */
function focusOnTitle(flaeche) {
  const titel = /** @type {HTMLElement|null} */ (flaeche?.querySelector('.ptitle') ?? null);
  if (!titel) {
    G('btn-umenu')?.focus();
    return;
  }
  if (!titel.hasAttribute('tabindex')) titel.setAttribute('tabindex', '-1');
  titel.focus({ preventScroll: true });
}

export function bindTabs() {
  alle('.ntab').forEach(t => {
    // Avoid duplicate listeners
    if (t._tabBound) return;
    t._tabBound = true;
    t.addEventListener('click', () => {
      document.querySelectorAll('.ntab').forEach(x => {
        x.classList.remove('active');
      });
      document.querySelectorAll('.tab').forEach(x => {
        x.classList.remove('active');
      });
      // Invisible tabs (settings, monitoring) are opened by the account menu — then the menu button marks where
      // one is.
      const unter = t.classList.contains('ntab-unter');
      G('btn-umenu')?.classList.toggle('aktiv', unter);
      if (unter) G('btn-umenu')?.setAttribute('aria-current', 'page');
      else G('btn-umenu')?.removeAttribute('aria-current');
      t.classList.add('active');
      G('tab-' + t.dataset.tab).classList.add('active');
      const tab = t.dataset.tab ?? '';
      reportView(tab);
      markGroup(tab);
      showPageName(G('tab-' + tab), unter);
      syncTabTitleIcon(tab);
      // The year label at the scroll bar belongs ONLY in the catalog. Without this unregistering the function registered there
      // kept delivering a year — even in the gallery, where the number means nothing.
      if (tab !== 'catalog') setScrollLabel(null);
      // loadGallery() loads the metrics itself; a second call cost double on the budget (apiThrottle.ts).
      if (tab === 'gallery') emit('sammlungLaden');
      if (tab === 'catalog') {
        initCatalog();
      }
      if (tab === 'wanted') {
        ladeMerkliste();
      }
      if (tab === 'parts') {
        loadParts();
        loadManualParts();
        loadBrickColors();
        // If the import was only just now, load once more after the background job
        if (Date.now() - lastImportAt < 30000)
          setTimeout(() => {
            loadParts();
            loadManualParts();
          }, 5000);
      }
      if (tab === 'minifigs') {
        loadMinifigs();
        if (Date.now() - lastImportAt < 30000) setTimeout(loadMinifigs, 5000);
      }
      if (tab === 'finance') {
        emit('finanzenLaden');
      } // loadFinance already fetches parts+minifigs valuation in parallel
      if (tab === 'partslist') {
        /* session-only, no server load needed */
      }
      // Since 16.10. the tab only carries the admin sections; whatever used to be loaded along here
      // is now fetched by the respective view when opening (see oeffneSicht below). Whoever looks up the API keys
      // needs no voucher list.
      if (tab === 'settings') {
        showSettingAccess();
        loadSettings();
        if (loggedInAccount?.isAdmin) {
          loadApiLimits();
          loadCacheTtl();
          loadSchedules();
        }
      }
      if (tab === 'monitor') {
        loadMonitor();
        loadCacheStats();
        loadRateLimitStats();
        stopJobPolling();
        pollJobStatus();
      }
      if (tab !== 'monitor' && stopMonitor()) stopJobPolling();
    });
  });
  // Fill all page title icons — runs on every bindTabs() call, i.e. also after login (showApp calls
  // bindTabs again), when the content becomes visible. That way the icon appears left of the title on all tabs,
  // not only after a click.
  alle('.ptitle[data-tab-title]').forEach(h => {
    syncTabTitleIcon(h.dataset.tabTitle);
  });
}

// Call moved to startApp() (js/init.js), which js/main.js calls AFTER all modules have been evaluated.
// In the module body it ran too early: with mutual imports the translation object from i18n.js is then not
// initialized yet, and t() throws.

// The views behind the user menu, as in the Android app. Every view only loads what it shows: before,
// the settings tab fetched five areas on every opening, of which one usually wanted to see one.
/** @type {Record<string, () => unknown>} */
const VIEWS = {
  profil: () => {
    loadSettings();
    loadProfile();
    ladeZweitenFaktor();
    ladePasskeys();
  },
  gutscheine: () => ladeGutscheine(),
  alarme: () => ladeAlarmUebersicht(),
  lagerorte: () => ladeLagerortVerwaltung(),
  haushalt: () => loadHousehold(),
  daten: () => loadTrash(),
  app: () => {
    loadTokens();
    loadTls();
  },
};

/**
 * Open a view from the menu.
 * @param {string} name
 */
export function oeffneSicht(name) {
  if (!VIEWS[name]) return;
  const flaeche = G('tab-' + name);
  if (!flaeche) return;
  const fromMenu = !!G('umenu-pop')?.contains(document.activeElement);
  document.querySelectorAll('.ntab').forEach(x => {
    x.classList.remove('active');
  });
  document.querySelectorAll('.tab').forEach(x => {
    x.classList.remove('active');
  });
  flaeche.classList.add('active');
  markGroup(null);
  showPageName(flaeche, true);
  closeMenu();
  reportView(name);
  // The views live in the account menu, not in the bar: then the menu button shows where one is — otherwise
  // no tab would be marked as active.
  G('btn-umenu')?.classList.add('aktiv');
  G('btn-umenu')?.setAttribute('aria-current', 'page');
  // To the top: otherwise the view opens at the spot where the previous one was scrolled, and one sees the
  // middle of a foreign page.
  window.scrollTo({ top: 0, behavior: rollArt() });
  if (fromMenu) focusOnTitle(flaeche);
  VIEWS[name]();
}

/**
 * Page name in the window title and, for pages behind the menu, in the header: there no tab marks the open
 * page, otherwise one would only know from the content where one is.
 * @param {Element | null} flaeche
 * @param {boolean} inHeader
 */
function showPageName(flaeche, inHeader) {
  // Without soft hyphens: in the page title and in the tab bar they become visible or disturb the search.
  const titel = (flaeche?.querySelector('.ptitle')?.textContent || '').replace(/\u00AD/g, '').trim();
  const kopf = G('kopf-sicht');
  if (kopf) {
    kopf.textContent = inHeader ? titel : '';
    kopf.hidden = !(inHeader && titel);
  }
  document.title = titel ? `${titel} – BrickInventory` : 'BrickInventory Manager';
  observeTitle(flaeche);
}

/** @type {MutationObserver | null} */
let _setDetailObserver = null;
/**
 * Open set detail: the window title names the set, after closing the page again. Observed
 * instead of set at every closing path: button, Esc, background and the purchase price dialog close it.
 */
function observeSetDetail() {
  const dialog = G('set-modal'),
    titel = G('m-tit');
  if (_setDetailObserver || !dialog || !titel || typeof MutationObserver !== 'function') return;
  let offen = false;
  const setUp = () => {
    const name = (titel.textContent || '').trim();
    if (dialog.classList.contains('open') && name) {
      offen = true;
      document.title = `${name} – BrickInventory`;
    } else if (offen) {
      offen = false;
      refreshPageName();
    }
  };
  _setDetailObserver = new MutationObserver(setUp);
  _setDetailObserver.observe(dialog, { attributes: true, attributeFilter: ['class'] });
  _setDetailObserver.observe(titel, { childList: true, characterData: true, subtree: true });
}

/** At startup the collection is already open without a tab having been clicked: set the title anyway. */
export function refreshPageName() {
  observeSetDetail();
  const flaeche = document.querySelector('.tab.active');
  const reiter = flaeche && document.querySelector(`.ntab[data-tab="${flaeche.id.replace(/^tab-/, '')}"]`);
  showPageName(flaeche, !reiter || reiter.classList.contains('ntab-unter'));
}

/**
 * On the phone the page name only stands in the header once the heading has scrolled out; otherwise it would stand
 * twice below each other.
 * @type {IntersectionObserver | null}
 */
let _titleObserver = null;
/**
 * @param {Element | null} flaeche
 */
function observeTitle(flaeche) {
  const kopf = G('kopf-sicht'),
    h1 = flaeche?.querySelector('.ptitle');
  _titleObserver?.disconnect();
  if (!kopf || !h1 || typeof IntersectionObserver !== 'function') return;
  // Measured on the real header bar (taller than 64 px at 200 % font) and immediately, not only in the first
  // callback: until then the previous page's state applied, and the title briefly stood twice below each other.
  const leiste = document.querySelector('header')?.getBoundingClientRect().bottom ?? 64;
  kopf.classList.toggle('titel-sichtbar', h1.getBoundingClientRect().bottom > leiste);
  _titleObserver = new IntersectionObserver(([e]) => kopf.classList.toggle('titel-sichtbar', e.isIntersecting), {
    rootMargin: `-${Math.round(leiste)}px 0px 0px 0px`,
  });
  _titleObserver.observe(h1);
}

function closeMenu(focusBack = false) {
  const pop = G('umenu-pop');
  const drin = !!pop && pop.contains(document.activeElement);
  if (pop) pop.style.display = 'none';
  const knopf = G('btn-umenu');
  if (knopf) knopf.setAttribute('aria-expanded', 'false');
  if (knopf && focusBack && drin) knopf.focus();
}

/** The visible entries; `admin-only` is hidden for other accounts. */
function menuEntries() {
  return /** @type {HTMLElement[]} */ ([...(G('umenu-pop')?.querySelectorAll('[role="menuitem"]') ?? [])]).filter(
    e => e.style.display !== 'none',
  );
}

/** Opens the menu and sets the focus on the first (or last) entry. */
function openMenu(letzter = false) {
  const pop = G('umenu-pop');
  if (!pop) return;
  pop.style.display = 'block';
  G('btn-umenu')?.setAttribute('aria-expanded', 'true');
  const e = menuEntries();
  (letzter ? e[e.length - 1] : e[0])?.focus();
}

/** Open and close the menu. */
export function benutzerMenue() {
  const pop = G('umenu-pop');
  if (!pop) return;
  if (pop.style.display !== 'none') {
    closeMenu();
    return;
  }
  openMenu();
}

// Keyboard according to the APG pattern "Menu Button": a screen reader announces role=menu, and users then expect
// arrow keys instead of Tab.
document.addEventListener('keydown', ev => {
  const ziel = ev.target instanceof Element ? ev.target : null;
  if (ziel?.id === 'btn-umenu' && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
    ev.preventDefault();
    openMenu(ev.key === 'ArrowUp');
    return;
  }
  if (!ziel?.closest('#umenu-pop')) return;
  const e = menuEntries(),
    i = e.indexOf(/** @type {HTMLElement} */ (ziel));
  const nach = { ArrowDown: (i + 1) % e.length, ArrowUp: (i - 1 + e.length) % e.length, Home: 0, End: e.length - 1 }[
    ev.key
  ];
  if (nach !== undefined) {
    ev.preventDefault();
    e[nach]?.focus();
    return;
  }
  if (ev.key === 'Tab') closeMenu();
});

// Close when someone taps next to it or presses Escape. Escape brings the focus back to the menu button,
// otherwise it would fall to the page start.
document.addEventListener('click', ev => {
  const pop = G('umenu-pop');
  if (!pop || pop.style.display === 'none') return;
  if (ev.target instanceof Element && ev.target.closest('.umenu-wrap')) return;
  closeMenu();
});

document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') {
    closeMenu(true);
    closeImportMenus(null, true);
  }
});

// Logged out, #inhalt is hidden; the skip link then leads into the login form instead of nowhere.
document.querySelector('.sprunglink')?.addEventListener('click', ev => {
  if (G('inhalt')?.checkVisibility?.() !== false) return;
  const felder = /** @type {HTMLElement[]} */ ([
    ...document.querySelectorAll('#login-screen input:not([type=hidden])'),
  ]);
  const feld = felder.find(f => f.checkVisibility?.() !== false);
  if (!feld) return;
  ev.preventDefault();
  feld.focus();
});

/**
 * Close open import menus, except the one in which `ausser` lies.
 * @param {Node | null} ausser
 */
function closeImportMenus(ausser, focusBack = false) {
  /** @type {NodeListOf<HTMLDetailsElement>} */ (document.querySelectorAll('details.import-menue[open]')).forEach(d => {
    if (ausser && d.contains(ausser)) return;
    d.open = false;
    if (focusBack && d.contains(document.activeElement)) d.querySelector('summary')?.focus();
  });
}

// A click next to it closes the menu; a choice within it (file, template) as well.
document.addEventListener('click', ev => {
  const ziel = ev.target instanceof Element ? ev.target : null;
  closeImportMenus(ziel);
  const d = /** @type {HTMLDetailsElement|null} */ (ziel?.closest('.import-klappe a')?.closest('details') ?? null);
  if (d) d.open = false;
});

document.addEventListener('change', ev => {
  const d =
    ev.target instanceof Element
      ? /** @type {HTMLDetailsElement|null} */ (ev.target.closest('details.import-menue'))
      : null;
  if (d) d.open = false;
});

/**
 * Clear all filters of a view (button in the empty state without hits).
 * @param {string} ansicht
 */
function filterZuruecksetzen(ansicht) {
  if (ansicht === 'gallery') {
    G('gs').value = '';
    G('gtheme').value = '';
    setLagerModus('gallery', '');
    if (G('storage-gallery')) G('storage-gallery').value = '';
    emit('sammlungLaden');
  } else if (ansicht === 'merkliste') resetWantedFilter();
  else if (ansicht === 'catalog') resetCatalog();
  else if (ansicht === 'parts') resetPartsFilter();
  else if (ansicht === 'minifigs') resetMinifigsFilter();
  reportFilter();
}

/**
 * Switch — reloads ONLY the affected view, as with the account filter.
 *
 * In the parts tab BOTH lists: since the storage location filter also hits the manually captured parts
 * (getManualParts), switching without loadManualParts() would be a half-applied filter — at the top
 * unfiltered, at the bottom filtered. The same reasoning as for onScopeChange() below.
 * @param {string} view
 */
export function onStorageChange(view) {
  const el = G('storage-' + view);
  if (!el) return;
  setLagerModus(view, el.value);
  if (view === 'gallery') emit('sammlungLaden');
  if (view === 'parts') {
    loadParts();
    loadManualParts();
  }
}

/**
 * Switch — reloads ONLY the affected view.
 *
 * The choice applies per view; reloading all four at the same time would touch three views nobody
 * is looking at right now, and trigger price fetches along the way.
 * @param {string} view
 */
export function onScopeChange(view) {
  const el = G('scope-' + view);
  if (!el) return;
  setScopeMode(view, el.value);
  collectionSubtitle(view);
  if (view === 'gallery') emit('sammlungLaden');
  // The parts and minifigures tabs each have TWO lists: the one from sets and the manually captured one. Only
  // reloading loadParts() left the manual area unfiltered — it loads via an endpoint of its
  // own.
  if (view === 'parts') {
    loadParts();
    loadManualParts();
  }
  // The minifigures tab has the same two lists — yet only loadMinifigs() stood here. The manual
  // cards thus depended on the account filter of the LAST load: loadManualFigsTable() sends the filter along,
  // but was never called when switching. Exactly the gap the sentence above describes for both
  // tabs.
  if (view === 'minifigs') {
    loadMinifigs();
    loadManualFigsTable();
  }
  if (view === 'finance') emit('finanzenLaden');
  // The wishlist loads ONE list and has no metrics above it — unlike the gallery, where loadStats()
  // mitmuss.
  if (view === 'merkliste') ladeMerkliste();
}

// A real language change rebuilds the open tab. The gallery is only redrawn: a reload
// emptied the grid in between.
subscribe('spracheGewechselt', ({ realSwitch }) => {
  if (!realSwitch) return;
  const aktiv = /** @type {HTMLElement|null} */ (document.querySelector('.ntab.active'))?.dataset?.tab;
  if (aktiv === 'parts') {
    loadParts();
    loadManualParts();
  }
  if (aktiv === 'minifigs') loadMinifigs();
  if (aktiv === 'finance') emit('finanzenLaden');
  if (aktiv === 'settings') {
    loadSettings();
    loadProfile();
  }
  if (aktiv === 'monitor') {
    loadMonitor();
    loadCacheStats();
  }
  if (aktiv === 'gallery') emit('sammlungZeichnen');
});

/**
 * From a dialog to a menu page (set detail → price alerts). First the dialog closes via its own
 * close button, so that it cleans up as usual; only then the page.
 * @this {HTMLElement} @param {string} name
 */
function sichtAusDialog(name) {
  const zu = this.closest('.ovl')?.querySelector('[data-dialog-zu]');
  if (zu instanceof HTMLElement) zu.click();
  oeffneSicht(name);
}

registerTarget({ view: oeffneSicht });

registerActions({
  filterUmschalten,
  filterZuruecksetzen,
  benutzerMenue,
  oeffneSicht,
  oeffneReiter,
  sichtAusDialog,
  onScopeChange,
  onStorageChange,
});
