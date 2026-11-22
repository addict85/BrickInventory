// Tabs, user menu, views and the filters that reload several lists. Stands above all views and
// may load each; the router reaches the views via targets.js, not via an import.
import { registerTarget } from './targets.js';
import { registerActions } from './registry.js';
import { G, emptyState, queryAll, queryOne, setHtml, rollKind } from './dom.js';
import { loggedInAccount, lastImportAt } from './state.js';
import { loadSchedules, loadMonitor, stopMonitor } from './monitor.js';
import { resetMinifigsFilter, loadManualFigsTable, loadMinifigs } from './minifigs.js';
import { initCatalog, resetCatalog } from './catalog.js';
import { pollJobStatus, stopJobPolling } from './admin.js';
import { loadAlertOverview } from './alerts.js';
import { loadLocationManagement } from './storage-locations.js';
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
import { loadVouchers } from './vouchers.js';
import { loadWanted, resetWantedFilter } from './wanted.js';
import { loadTrash } from './trash.js';
import { loadPasskeys } from './passkeys.js';
import { loadSecondFactor } from './second-factor.js';
import { loadParts, resetPartsFilter, loadManualParts } from './parts.js';
import { loadBrickColors } from './part-add.js';
import { reportView, reportFilter } from './router.js';
import { setLocationMode, setScopeMode } from './account-filter.js';
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
  // Copies instead of outerHTML: re-read as text, the icon's style would state there as a style attribute again,
  // and the CSP forbids that.
  const copies = [];
  for (const node of nav.childNodes) {
    if (node === label) break;
    if (node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').trim() : true) copies.push(node.cloneNode(true));
  }
  slot.replaceChildren(...copies);
}

/**
 * Sets, parts and minifigures share ONE target in the bar ("collection"); switching happens at the top of the
 * page. Parts and minifigures keep their invisible tab — code and restoration address them
 * through it.
 */
const COLLECTION = ['gallery', 'parts', 'minifigs'];

/**
 * @param {string | null | undefined} tab
 */
function markGroup(tab) {
  // An own class instead of .active: `.ntab.active` everywhere names the open tab.
  const collection = document.querySelector('.ntab[data-tab="gallery"]');
  collection?.classList.toggle('group-active', !!tab && COLLECTION.includes(tab));
  // The three buttons switch the view; the open one is the current page.
  queryAll('.collection-choice [data-arg]').forEach(b => {
    if (b.dataset.arg === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  // That way screen readers learn which tab is open. "Collection" only counts as the current page if
  // the view's own tab is not visible (on the phone).
  const open = document.querySelector('.ntab.active');
  const openVisible = !!open?.getClientRects().length;
  document.querySelectorAll('.ntab').forEach(x => {
    if (x.classList.contains('active') || (x.classList.contains('group-active') && !openVisible && x !== open))
      x.setAttribute('aria-current', 'page');
    else x.removeAttribute('aria-current');
  });
}

/** On the phone: the filters behind a button, so that the list starts at the top. @this {HTMLElement} */
export function toggleFilter() {
  const bar = this?.closest?.('.filter-bar');
  if (!bar) return;
  const open = bar.classList.toggle('open');
  this.setAttribute('aria-expanded', String(open));
}

/** Whoever is not an admin sees a sentence in the settings tab instead of an empty page. */
function showSettingAccess() {
  const f = G('settings-no-access');
  if (!f) return;
  f.hidden = !!loggedInAccount?.isAdmin;
  setHtml(
    f,
    loggedInAccount?.isAdmin
      ? ''
      : emptyState({ ico: 'lock', title: tRaw('settings.no_access'), text: tRaw('settings.no_access_text') }),
  );
}

/**
 * Open a tab — from the collection's switch or the menu.
 * @param {string} name
 */
export function openTab(name) {
  const fromMenu = !!G('umenu-pop')?.contains(document.activeElement);
  closeMenu();
  queryOne(`.ntab[data-tab="${name}"]`)?.click();
  if (fromMenu) focusOnTitle(G('tab-' + name));
}

/**
 * After a choice in the menu the focus is on a now hidden entry and would fall to the page start;
 * the heading of the new page is the place where keyboard and screen reader continue.
 */
/** @param {HTMLElement | null} surface */
function focusOnTitle(surface) {
  const title = /** @type {HTMLElement|null} */ (surface?.querySelector('.ptitle') ?? null);
  if (!title) {
    G('btn-umenu')?.focus();
    return;
  }
  if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
  title.focus({ preventScroll: true });
}

export function bindTabs() {
  queryAll('.ntab').forEach(t => {
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
      const sub = t.classList.contains('ntab-sub');
      G('btn-umenu')?.classList.toggle('active', sub);
      if (sub) G('btn-umenu')?.setAttribute('aria-current', 'page');
      else G('btn-umenu')?.removeAttribute('aria-current');
      t.classList.add('active');
      G('tab-' + t.dataset.tab).classList.add('active');
      const tab = t.dataset.tab ?? '';
      reportView(tab);
      markGroup(tab);
      showPageName(G('tab-' + tab), sub);
      syncTabTitleIcon(tab);
      // The year label at the scroll bar belongs ONLY in the catalog. Without this unregistering the function registered there
      // kept delivering a year — even in the gallery, where the number means nothing.
      if (tab !== 'catalog') setScrollLabel(null);
      // loadGallery() loads the metrics itself; a second call cost double on the budget (apiThrottle.ts).
      if (tab === 'gallery') emit('collectionLoad');
      if (tab === 'catalog') {
        initCatalog();
      }
      if (tab === 'wanted') {
        loadWanted();
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
        emit('financesLoad');
      } // loadFinance already fetches parts+minifigs valuation in parallel
      if (tab === 'partslist') {
        /* session-only, no server load needed */
      }
      // Since 16.10. the tab only carries the admin sections; whatever used to be loaded along here
      // is now fetched by the respective view when opening (see openView below). Whoever looks up the API keys
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
  queryAll('.ptitle[data-tab-title]').forEach(h => {
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
  profile: () => {
    loadSettings();
    loadProfile();
    loadSecondFactor();
    loadPasskeys();
  },
  vouchers: () => loadVouchers(),
  alerts: () => loadAlertOverview(),
  locations: () => loadLocationManagement(),
  household: () => loadHousehold(),
  data: () => loadTrash(),
  app: () => {
    loadTokens();
    loadTls();
  },
};

/**
 * Open a view from the menu.
 * @param {string} name
 */
export function openView(name) {
  if (!VIEWS[name]) return;
  const surface = G('tab-' + name);
  if (!surface) return;
  const fromMenu = !!G('umenu-pop')?.contains(document.activeElement);
  document.querySelectorAll('.ntab').forEach(x => {
    x.classList.remove('active');
  });
  document.querySelectorAll('.tab').forEach(x => {
    x.classList.remove('active');
  });
  surface.classList.add('active');
  markGroup(null);
  showPageName(surface, true);
  closeMenu();
  reportView(name);
  // The views live in the account menu, not in the bar: then the menu button shows where one is — otherwise
  // no tab would be marked as active.
  G('btn-umenu')?.classList.add('active');
  G('btn-umenu')?.setAttribute('aria-current', 'page');
  // To the top: otherwise the view opens at the spot where the previous one was scrolled, and one sees the
  // middle of a foreign page.
  window.scrollTo({ top: 0, behavior: rollKind() });
  if (fromMenu) focusOnTitle(surface);
  VIEWS[name]();
}

/**
 * Page name in the window title and, for pages behind the menu, in the header: there no tab marks the open
 * page, otherwise one would only know from the content where one is.
 * @param {Element | null} surface
 * @param {boolean} inHeader
 */
function showPageName(surface, inHeader) {
  // Without soft hyphens: in the page title and in the tab bar they become visible or disturb the search.
  const title = (surface?.querySelector('.ptitle')?.textContent || '').replace(/\u00AD/g, '').trim();
  const header = G('header-view');
  if (header) {
    header.textContent = inHeader ? title : '';
    header.hidden = !(inHeader && title);
  }
  document.title = title ? `${title} – BrickInventory` : 'BrickInventory Manager';
  observeTitle(surface);
}

/** @type {MutationObserver | null} */
let _setDetailObserver = null;
/**
 * Open set detail: the window title names the set, after closing the page again. Observed
 * instead of set at every closing path: button, Esc, background and the purchase price dialog close it.
 */
function observeSetDetail() {
  const dialog = G('set-modal'),
    title = G('m-tit');
  if (_setDetailObserver || !dialog || !title || typeof MutationObserver !== 'function') return;
  let open = false;
  const setUp = () => {
    const name = (title.textContent || '').trim();
    if (dialog.classList.contains('open') && name) {
      open = true;
      document.title = `${name} – BrickInventory`;
    } else if (open) {
      open = false;
      refreshPageName();
    }
  };
  _setDetailObserver = new MutationObserver(setUp);
  _setDetailObserver.observe(dialog, { attributes: true, attributeFilter: ['class'] });
  _setDetailObserver.observe(title, { childList: true, characterData: true, subtree: true });
}

/** At startup the collection is already open without a tab having been clicked: set the title anyway. */
export function refreshPageName() {
  observeSetDetail();
  const surface = document.querySelector('.tab.active');
  const tab = surface && document.querySelector(`.ntab[data-tab="${surface.id.replace(/^tab-/, '')}"]`);
  showPageName(surface, !tab || tab.classList.contains('ntab-sub'));
}

/**
 * On the phone the page name only stands in the header once the heading has scrolled out; otherwise it would state
 * twice below each other.
 * @type {IntersectionObserver | null}
 */
let _titleObserver = null;
/**
 * @param {Element | null} surface
 */
function observeTitle(surface) {
  const header = G('header-view'),
    h1 = surface?.querySelector('.ptitle');
  _titleObserver?.disconnect();
  if (!header || !h1 || typeof IntersectionObserver !== 'function') return;
  // Measured on the real header bar (taller than 64 px at 200 % font) and immediately, not only in the first
  // callback: until then the previous page's state applied, and the title briefly stood twice below each other.
  const bar = document.querySelector('header')?.getBoundingClientRect().bottom ?? 64;
  header.classList.toggle('title-visible', h1.getBoundingClientRect().bottom > bar);
  _titleObserver = new IntersectionObserver(([e]) => header.classList.toggle('title-visible', e.isIntersecting), {
    rootMargin: `-${Math.round(bar)}px 0px 0px 0px`,
  });
  _titleObserver.observe(h1);
}

function closeMenu(focusBack = false) {
  const pop = G('umenu-pop');
  const inside = !!pop && pop.contains(document.activeElement);
  if (pop) pop.style.display = 'none';
  const button = G('btn-umenu');
  if (button) button.setAttribute('aria-expanded', 'false');
  if (button && focusBack && inside) button.focus();
}

/** The visible entries; `admin-only` is hidden for other accounts. */
function menuEntries() {
  return /** @type {HTMLElement[]} */ ([...(G('umenu-pop')?.querySelectorAll('[role="menuitem"]') ?? [])]).filter(
    e => e.style.display !== 'none',
  );
}

/** Opens the menu and sets the focus on the first (or last) entry. */
function openMenu(last = false) {
  const pop = G('umenu-pop');
  if (!pop) return;
  pop.style.display = 'block';
  G('btn-umenu')?.setAttribute('aria-expanded', 'true');
  const e = menuEntries();
  (last ? e[e.length - 1] : e[0])?.focus();
}

/** Open and close the menu. */
export function userMenu() {
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
  const target = ev.target instanceof Element ? ev.target : null;
  if (target?.id === 'btn-umenu' && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
    ev.preventDefault();
    openMenu(ev.key === 'ArrowUp');
    return;
  }
  if (!target?.closest('#umenu-pop')) return;
  const e = menuEntries(),
    i = e.indexOf(/** @type {HTMLElement} */ (target));
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

// Logged out, #content is hidden; the skip link then leads into the login form instead of nowhere.
document.querySelector('.skip-link')?.addEventListener('click', ev => {
  if (G('content')?.checkVisibility?.() !== false) return;
  const fields = /** @type {HTMLElement[]} */ ([
    ...document.querySelectorAll('#login-screen input:not([type=hidden])'),
  ]);
  const field = fields.find(f => f.checkVisibility?.() !== false);
  if (!field) return;
  ev.preventDefault();
  field.focus();
});

/**
 * Close open import menus, except the one in which `except` lies.
 * @param {Node | null} except
 */
function closeImportMenus(except, focusBack = false) {
  /** @type {NodeListOf<HTMLDetailsElement>} */ (document.querySelectorAll('details.import-menu[open]')).forEach(d => {
    if (except && d.contains(except)) return;
    d.open = false;
    if (focusBack && d.contains(document.activeElement)) d.querySelector('summary')?.focus();
  });
}

// A click next to it closes the menu; a choice within it (file, template) as well.
document.addEventListener('click', ev => {
  const target = ev.target instanceof Element ? ev.target : null;
  closeImportMenus(target);
  const d = /** @type {HTMLDetailsElement|null} */ (target?.closest('.import-toggle a')?.closest('details') ?? null);
  if (d) d.open = false;
});

document.addEventListener('change', ev => {
  const d =
    ev.target instanceof Element
      ? /** @type {HTMLDetailsElement|null} */ (ev.target.closest('details.import-menu'))
      : null;
  if (d) d.open = false;
});

/**
 * Clear all filters of a view (button in the empty state without hits).
 * @param {string} view
 */
function resetFilter(view) {
  if (view === 'gallery') {
    G('gs').value = '';
    G('gtheme').value = '';
    setLocationMode('gallery', '');
    if (G('storage-gallery')) G('storage-gallery').value = '';
    emit('collectionLoad');
  } else if (view === 'wanted') resetWantedFilter();
  else if (view === 'catalog') resetCatalog();
  else if (view === 'parts') resetPartsFilter();
  else if (view === 'minifigs') resetMinifigsFilter();
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
  setLocationMode(view, el.value);
  if (view === 'gallery') emit('collectionLoad');
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
  if (view === 'gallery') emit('collectionLoad');
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
  if (view === 'finance') emit('financesLoad');
  // The wishlist loads ONE list and has no metrics above it — unlike the gallery, where loadStats()
  // mitmuss.
  if (view === 'wanted') loadWanted();
}

// A real language change rebuilds the open tab. The gallery is only redrawn: a reload
// emptied the grid in between.
subscribe('languageChanged', ({ realSwitch }) => {
  if (!realSwitch) return;
  const active = /** @type {HTMLElement|null} */ (document.querySelector('.ntab.active'))?.dataset?.tab;
  if (active === 'parts') {
    loadParts();
    loadManualParts();
  }
  if (active === 'minifigs') loadMinifigs();
  if (active === 'finance') emit('financesLoad');
  if (active === 'settings') {
    loadSettings();
    loadProfile();
  }
  if (active === 'monitor') {
    loadMonitor();
    loadCacheStats();
  }
  if (active === 'gallery') emit('collectionDraw');
});

/**
 * From a dialog to a menu page (set detail → price alerts). First the dialog closes via its own
 * close button, so that it cleans up as usual; only then the page.
 * @this {HTMLElement} @param {string} name
 */
function viewFromDialog(name) {
  const close = this.closest('.ovl')?.querySelector('[data-dialog-close]');
  if (close instanceof HTMLElement) close.click();
  openView(name);
}

registerTarget({ view: openView });

registerActions({
  toggleFilter,
  resetFilter,
  userMenu,
  openView,
  openTab,
  viewFromDialog,
  onScopeChange,
  onStorageChange,
});
