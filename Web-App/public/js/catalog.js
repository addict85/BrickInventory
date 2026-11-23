// The catalog: search sets, show details and add them to the collection.
import { emit } from './events.js';
import { detailRow, tileName, loadDisplay, listLoadError } from './components.js';
import { registerActions } from './registry.js';
import { loadGuard } from './load-guard.js';
import { locale, t, tRaw } from '../i18n.js';
import { errorMessage, api } from './api.js';
import { imageTag, placeholderContent, fullUrl, imgUrl, thumbUrl, setDialogImage, PLACEHOLDER_SET } from './images.js';
import { emptyState, reportHits, ico, G, resetButton, queryAll, queryOne, setHtml, insertHtml } from './dom.js';
import { amountFromField, quantityFromField } from './form.js';
import { toast } from './messages.js';
import { setScrollLabel } from './scrollbar.js';
import { setLastImportAt, loggedInAccount, settingsSnapshot } from './state.js';
import { esc, html, joinHtml } from './escaping.js';
import { handleSseEvent, hideProgress, showProgress, streamDone, streamRequest } from './progress.js';
import { emptyLocationField, selectedOwner, selectedStorage } from './account-locations.js';

// The data source is /api/v2/catalog/* (local rb_* tables from the daily CSV sync) — paginated
// on the server side, since the catalog comprises ~25k sets.

const _catState = { page: 1, q: '', theme: '', yearFrom: '', yearTo: '', sort: 'year_desc' };
// _catItems holds the loaded sets for in-place updates (owned badge after adding to the gallery).
const loadCatalog = loadGuard();
// Windowed loading instead of infinite scroll: the year bar jumps into the middle of the list, and an appended list
// would have nothing above and below. One block per page; what comes into view is loaded, placeholders keep
// the height free.
const CAT_LIMIT = 60;
let _catTotal = 0;
let _catPageCount = 0;
let _catLoadedPages = new Set();
let _catLoadingPages = new Set();
let _catScrollBound = false;
/** @type {import('../../frontend-types/contract').CatalogSetItem[]} */
let _catItems = [];
/** Data range from /catalog/meta. @type {number | null} */
let _catYearMin = null;
/** @type {number | null} */
let _catYearMax = null;
let _catMetaLoaded = false;
/** The set in the detail dialog. @type {import('../../frontend-types/contract').CatalogSetDetail | null} */
let _catCurSet = null;
/** Year → number of sets (label on the year slider). @type {Record<number, number>} */
let _catYearCounts = {};

export function initCatalog() {
  if (!_catMetaLoaded) {
    _catMetaLoaded = true;
    _bindCatalogControls();
    loadCatalogMeta();
    loadCatalogSets();
  } else {
    // Tab opened again: reload the current page, so that owned badges are correct after gallery changes.
    loadCatalogSets();
  }
}

function _bindCatalogControls() {
  const s = G('cat-search');
  s.addEventListener('input', () => {
    clearTimeout(s._t);
    s._t = setTimeout(() => {
      _catState.q = s.value.trim();
      _catState.page = 1;
      loadCatalogSets();
    }, 350);
  });
  G('cat-theme').addEventListener('change', () => {
    _catState.theme = G('cat-theme').value;
    _catState.page = 1;
    loadCatalogSets();
  });
  G('cat-sort').addEventListener('change', () => {
    _catState.sort = G('cat-sort').value;
    _catState.page = 1;
    loadCatalogSets();
  });
  // Year dropdowns (precise choice) -> go through the central setter. The changed field wins: the
  // other bound is pulled along if needed (same behavior as clamping the slider handles).
  G('cat-year-from').addEventListener('change', () => {
    const from = G('cat-year-from').value;
    let to = _catState.yearTo;
    if (from && to && parseInt(from, 10) > parseInt(to, 10)) to = from;
    setCatalogYearRange(from, to);
  });
  G('cat-year-to').addEventListener('change', () => {
    const to = G('cat-year-to').value;
    let from = _catState.yearFrom;
    if (to && from && parseInt(to, 10) < parseInt(from, 10)) from = to;
    setCatalogYearRange(from, to);
  });
  // The from-to slider is gone — filtering happens via the two select fields at the top, jumping via
  // the bar on the right edge. The infinite scroll's sentinel is gone too: the page that just comes into view
  // is loaded (see _observePages).
  G('cat-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCatModal();
  });
  G('cat-m-add').onclick = addCatalogSetToGallery;
}

async function loadCatalogMeta() {
  const d = await api('GET', '/v2/catalog/meta');
  if (!d.success) return;
  // Theme dropdown: path names ("Star Wars › UCS") with set count
  const themeEl = G('cat-theme');
  const cur = themeEl.value;
  setHtml(
    themeEl,
    html`${html`<option value="">${tRaw('catalog.filter.all_themes')}</option>`}${(d.themes || []).map(th => html`<option value="${th.id}"${String(th.id) === cur ? ' selected' : ''}>${th.name} (${th.set_count})</option>`)}`,
  );
  // Year dropdowns (from/to): descending from max to min
  const { year_min: of, year_max: bis } = d;
  if (of && bis) {
    const mk = (
      /** @type {HTMLElement | null} */ el,
      /** @type {string} */ placeholderKey,
      /** @type {string} */ yearKey,
      /** @type {string} */ cur,
    ) => {
      // "from 2015" instead of just "2015": otherwise the field shows a number when chosen that does not say which bound it is.
      let opts = html`<option value="">${tRaw(placeholderKey)}</option>`;
      for (let y = bis; y >= of; y--) {
        opts = html`${opts}${html`<option value="${y}"${String(y) === cur ? ' selected' : ''}>${tRaw(yearKey, { year: y })}</option>`}`;
      }
      if (el) setHtml(el, opts);
    };
    mk(G('cat-year-from'), 'catalog.filter.year_from', 'catalog.filter.ab_year', _catState.yearFrom);
    mk(G('cat-year-to'), 'catalog.filter.year_to', 'catalog.filter.bis_year', _catState.yearTo);
  }
  // Initialize the from-to slider
  _catYearCounts = {};
  for (const yc of d.year_counts || []) _catYearCounts[yc.year] = yc.n;
  _catYearMin = d.year_min || null;
  _catYearMax = d.year_max || null;
  _initYearRail();
}

/** Clear search, theme and years; the sorting stays. */
export function resetCatalog() {
  G('cat-search').value = '';
  G('cat-theme').value = '';
  _catState.q = '';
  _catState.theme = '';
  setCatalogYearRange('', '');
}

/**
 * Central place for year range changes — keeps dropdowns, slider and badge in sync.
 * @param {string} from
 * @param {string} to
 */
function setCatalogYearRange(from, to) {
  from = from ? String(from) : '';
  to = to ? String(to) : '';
  // From > to (possible via the dropdowns) -> swap
  if (from && to && parseInt(from, 10) > parseInt(to, 10)) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  _catState.yearFrom = from;
  _catState.yearTo = to;
  _catState.page = 1;
  _syncYearUI();
  loadCatalogSets();
}

/** Pull the two select fields to the state. */
function _syncYearUI() {
  G('cat-year-from').value = _catState.yearFrom || '';
  G('cat-year-to').value = _catState.yearTo || '';
}

/**
 * @param {number} page
 */
function _catQuery(page) {
  const p = new URLSearchParams();
  if (_catState.q) p.set('q', _catState.q);
  if (_catState.theme) p.set('theme_id', _catState.theme);
  if (_catState.yearFrom) p.set('year_from', _catState.yearFrom);
  if (_catState.yearTo) p.set('year_to', _catState.yearTo);
  p.set('sort', _catState.sort);
  p.set('page', String(page));
  p.set('page_size', '60');
  return p.toString();
}

/**
 * Rebuild the list: load the first page, the rest as placeholder blocks.
 *
 * One block per page over the WHOLE result — only that way can the year bar jump somewhere instead of
 * filtering.
 */
/** Without a filter "empty" means: the catalog has not been reconciled yet. What to do then depends on
 * the role and on whether the Rebrickable key is set. */
function catalogEmptyState() {
  const filtered = !!(_catState.q || _catState.theme || _catState.yearFrom || _catState.yearTo);
  if (filtered)
    return emptyState({
      ico: 'search',
      title: tRaw('catalog.no_results'),
      text: tRaw('catalog.no_results_hint'),
      button: resetButton('catalog'),
    });
  const title = tRaw('catalog.empty_title');
  if (!loggedInAccount?.isAdmin)
    return emptyState({ ico: 'catalog', title, text: tRaw('catalog.empty_hint_account'), button: undefined });
  if (!String(settingsSnapshot?.rebrickable_api_key || '').trim())
    return emptyState({
      ico: 'catalog',
      title,
      text: tRaw('catalog.empty_without_key'),
      button: { text: tRaw('rb_key.banner_link'), click: 'openRbHint', ico: 'key' },
    });
  return emptyState({
    ico: 'catalog',
    title,
    text: tRaw('catalog.empty_hint'),
    button: { text: tRaw('catalog.to_sync'), click: 'openTab', arg: 'monitor', ico: 'refresh' },
  });
}

/** One block per page. The first one is filled, the others only hold space: ONE empty block instead of 60
 * placeholder tiles, with 25,000 sets that would be 25,000 elements. The height comes from the measured
 * first page, because the number of columns depends on the window. */
function catalogPages() {
  const blocks = [];
  for (let page = 1; page <= _catPageCount; page++) {
    const count = page === _catPageCount ? _catTotal - (page - 1) * CAT_LIMIT : CAT_LIMIT;
    blocks.push(
      page === 1
        ? html`<div class="sgrid cat-page" data-page="1">${joinHtml(_catItems.map(catCard))}</div>`
        : html`<div class="cat-page cat-page-ph" data-page="${page}" data-count="${count}"></div>`,
    );
  }
  return joinHtml(blocks);
}

async function loadCatalogSets() {
  loadCatalog.start();
  _catLoadedPages = new Set();
  _catLoadingPages = new Set();
  const grid = G('catalog-grid');
  setHtml(grid, loadDisplay(tRaw('catalog.loading')));
  _catState.page = 1;
  const d = await loadCatalog.whenCurrent(api('GET', `/v2/catalog/sets?${_catQuery(1)}`));
  if (d === undefined) return;
  if (listLoadError(grid, d, { again: 'loadCatalogSets' })) return;

  _catTotal = d.total || 0;
  _catPageCount = Math.max(1, Math.ceil(_catTotal / CAT_LIMIT));
  _catItems = d.sets || [];
  G('cat-count').textContent = tRaw(_catTotal === 1 ? 'catalog.result_count_one' : 'catalog.result_count', {
    count: _catTotal.toLocaleString(locale()),
  });
  reportHits(
    _catTotal ? G('cat-count').textContent : tRaw('common.no_hits', { query: G('cat-search')?.value.trim() || '' }),
  );

  if (!_catItems.length) {
    setHtml(grid, catalogEmptyState());
    setScrollLabel(null);
    return;
  }
  setHtml(grid, catalogPages());
  _catLoadedPages.add(1);
  _loadYearDistribution();
  _setPlaceholderHeight();
  _observePages();
  _initYearRail();
}

/**
 * Derive the height of the empty blocks from the FIRST, real page.
 *
 * Measured instead of computed: how many tiles fit side by side is decided by the window width; every
 * estimate would be off for another window. And a wrong height is expensive here — the list jumps
 * when loading more, and one loses the spot one was just at.
 */
function _setPlaceholderHeight() {
  const first = queryOne('#catalog-grid .cat-page[data-page="1"]');
  if (!first) return;
  const height = first.offsetHeight;
  if (height < 10) return; // not drawn yet
  const proTile = height / Math.max(1, _catItems.length);
  for (const el of queryAll('#catalog-grid .cat-page-ph')) {
    const count = parseInt(el.dataset.count ?? '', 10) || CAT_LIMIT;
    el.style.height = Math.round(count * proTile) + 'px';
  }
}

/**
 * Measure the position of the page blocks once, then from memory: getBoundingClientRect per block and image
 * forced over 400 layouts, and dragging the bar pushed the CPU to 100 %.
 */
/** @type {{ page: number, top: number, bottom: number }[]} */
let _catBlockStates = [];
// Years with their count, in the order of the list — the basis for the label on the scroll bar (see
// _yearOnPosition).
/** @type {import('../../frontend-types/contract').YearCount[]} */
let _catYearDistribution = [];

function _measureBlocks() {
  _catBlockStates = [];
  for (const el of queryAll('#catalog-grid .cat-page')) {
    const r = el.getBoundingClientRect();
    _catBlockStates.push({
      page: parseInt(el.dataset.page ?? '', 10),
      top: r.top + window.scrollY,
      bottom: r.bottom + window.scrollY,
    });
  }
}

/**
 * Only load once scrolling rests (150 ms): one drag across the whole bar would otherwise request hundreds of pages,
 * of which only the last one is looked at. During normal scrolling one does not notice the pause.
 */
/** @type {number | null} */
let _catLoadTimer = null;
/**
 * @param {boolean} [immediately]
 */
function _loadVisiblePages(immediately) {
  clearTimeout(_catLoadTimer);
  const tun = () => {
    const top = window.scrollY - 600;
    const bottom = window.scrollY + window.innerHeight + 600;
    for (const b of _catBlockStates) {
      if (b.bottom >= top && b.top <= bottom) loadPage(b.page);
    }
  };
  if (immediately) tun();
  else _catLoadTimer = setTimeout(tun, 150);
}

/**
 * Listen to scrolling and window size.
 *
 * The former IntersectionObserver is gone: it was a second path to the same goal, only reported
 * CHANGES of visibility (which is why nothing came for large blocks) and fired in addition to this
 * calculation. One path that always applies is better than two that are supposed to complement each other.
 */
function _observePages() {
  _measureBlocks();
  if (!_catScrollBound) {
    _catScrollBound = true;
    let requested = false;
    const atMovement = () => {
      if (requested) return;
      requested = true;
      // Throttled via requestAnimationFrame: a scroll event fires dozens of times per second.
      requestAnimationFrame(() => {
        requested = false;
        _loadVisiblePages();
      });
    };
    window.addEventListener('scroll', atMovement, { passive: true });
    window.addEventListener(
      'resize',
      () => {
        _measureBlocks();
        atMovement();
      },
      { passive: true },
    );
  }
  // What is already in view, immediately — that is what the user is waiting for.
  _loadVisiblePages(true);
}

/**
 * Load a page and fill its block.
 *
 * Pages already loaded or currently loading are skipped — without this check every
 * scroll step triggered the same fetch several times.
 * @param {number} page
 */
export async function loadPage(page) {
  if (page < 1 || page > _catPageCount) return;
  if (_catLoadedPages.has(page) || _catLoadingPages.has(page)) return;
  _catLoadingPages.add(page);
  try {
    const d = await loadCatalog.whenCurrent(api('GET', `/v2/catalog/sets?${_catQuery(page)}`));
    if (d === undefined) return;
    if (!d.success || !d.sets?.length) return;
    const block = queryOne(`#catalog-grid .cat-page[data-page="${page}"]`);
    if (!block) return;
    block.classList.remove('cat-page-ph');
    block.classList.add('sgrid');
    block.style.height = '';
    block.removeAttribute('data-count');
    setHtml(block, joinHtml(d.sets.map(catCard)));
    _catLoadedPages.add(page);
    _catItems = _catItems.concat(d.sets);
    // The block heights have changed — measure again, then check what is now additionally in view.
    _measureBlocks();
    _loadVisiblePages();
  } finally {
    _catLoadingPages.delete(page);
  }
}

/** @param {import('../../frontend-types/contract').CatalogSetItem} s */
function catCard(s) {
  // Preview via the server as for sets, parts and figures: smaller than the full CDN resolution, and already
  // downloaded images (image_local) save the way to the CDN entirely.
  const src = s.image_local || s.image_url;
  const img = src
    ? imageTag({ src: imgUrl(thumbUrl(src), 'only'), alt: '', fade: true, ph: 'set' })
    : html`<span class="image-ph" aria-hidden="true">${placeholderContent('set')}</span>`;
  const themeShort = s.theme_name ? s.theme_name.split(' › ').pop() : '';
  const ownedBadge = s.owned
    ? html`<span class="ibadge owned-badge">${ico('ok')}${tRaw('catalog.owned_badge')}${s.owned_quantity > 1 ? html`${' ×'}${s.owned_quantity}` : ''}</span>`
    : '';
  // The theme tone for the design "farbfaecher" (themes/farbfaecher.css reads it as --fan-hue). Always
  // set, not only with the design active: the variable costs nothing, and a query of the active design
  // here would be a second place that has to know it. Without a theme number it stays away — then the
  // stripe shows nothing instead of something wrong.
  const thema = s.theme_id;
  const hue = thema != null && Number.isInteger(thema) ? html` data-fan="${((thema % 12) + 12) % 12}"` : '';
  const k = tileName();
  return html`<div class="sc"${hue} tabindex="0" role="button"${k.attr} data-sn="${s.set_number}" data-year="${s.year || ''}" data-click="openCatModal" data-arg="${s.set_number}">
    <div class="sci">${img}</div>
    <div class="scb">
      <div class="snum">${s.set_number}</div>
      <div class="sname">${s.name || '—'}</div>
      <div class="smeta"${k.teil(0)}>
        <span class="smeta-text"${themeShort ? html` title="${themeShort}"` : ''}>${s.year || '—'}${themeShort ? html`${' · '}${themeShort}` : ''}</span>
        <div class="sbadges">
          ${s.num_parts ? html`<span class="parts-number">${tRaw('catalog.pieces_n', { n: s.num_parts.toLocaleString(locale()) })}</span>` : ''}
          ${ownedBadge}
        </div>
      </div>
    </div>
  </div>`;
}

// ── Detail-Modal ──────────────────────────────────────────────────────────────
/** @param {string} setNumber */
async function openCatModal(setNumber) {
  const d = await api('GET', `/v2/catalog/sets/${encodeURIComponent(setNumber)}`);
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  const s = d.set;
  if (!s) return;
  _catCurSet = s;
  G('cat-m-tit').textContent = s.name || s.set_number;
  G('cat-m-sub').textContent = s.set_number;
  emptyLocationField('cat-m-storage');
  // The full resolution in the detail directly from the CDN, not via the proxy: for a one-off large image
  // that is faster and relieves the server; the proxy only pays off for the many small previews.
  const detailSrc = s.image_local || s.image_url;
  setDialogImage(G('cat-m-img'), detailSrc ? fullUrl(detailSrc) : PLACEHOLDER_SET, PLACEHOLDER_SET);
  /** @type {[string, string | number][]} */
  const rows = [
    [tRaw('detail.year'), s.year || '—'],
    [tRaw('detail.theme'), s.theme_name || '—'],
    [tRaw('detail.pieces'), s.num_parts ? s.num_parts.toLocaleString(locale()) : '—'],
    [tRaw('detail.minifigs'), s.minifigs || '—'],
  ];
  if (s.owned) rows.push([tRaw('catalog.owned'), '×' + s.owned_quantity]);
  setHtml(
    G('cat-m-det'),
    rows.map(([k, v]) => detailRow(k, esc(String(v)))),
  );
  // The purchase link comes ready-made from the server (bricklinkLink.ts): built from the Rebrickable number, it was
  // wrong for gear, books and collectible figures. If the item is not unambiguous, it points to the search — never
  // hide it.
  const bl = s.bricklink;
  const blBtn = G('cat-m-bricklink');
  blBtn.style.display = '';
  blBtn.href = bl?.url || `https://www.bricklink.com/v2/search.page?q=${encodeURIComponent(s.set_number)}`;
  blBtn.textContent = bl && bl.exact === false ? tRaw('catalog.search_bricklink') : tRaw('catalog.buy_bricklink');
  blBtn.title =
    bl && bl.exact === false
      ? tRaw('catalog.search_bricklink_hint')
      : bl && bl.type !== 'SET'
        ? `BrickLink: ${bl.type} ${bl.number}`
        : '';
  // Button state: already owned → label "add again"
  G('cat-m-add').textContent = s.owned ? tRaw('catalog.add_again') : tRaw('catalog.add_to_gallery');
  G('cat-m-qty').value = '1';
  G('cat-m-price').value = '';
  // The set number is attached to the modal: the wishlist button lives in another module, and the modal knows
  // what it shows anyway. An export of _catCurSet would be a second path to the same state.
  G('cat-modal').dataset.setNumber = s.set_number;
  G('cat-modal').classList.add('open');
}

function closeCatModal() {
  G('cat-modal').classList.remove('open');
  _catCurSet = null;
}

// ── Add to gallery — uses the existing add-stream SSE flow ───────────────────
async function addCatalogSetToGallery() {
  if (!_catCurSet) return;
  const num = _catCurSet.set_number;
  const price = amountFromField('cat-m-price');
  const quantity = quantityFromField('cat-m-qty');
  if (!price.ok || !quantity.ok) return;
  const qty = quantity.value;
  const purchase_price = price.value;
  const condition = G('cat-m-cond').value || 'N';
  // Send the account along (Marco's find): the catalog dialog was the FOURTH capture path — gallery form,
  // manual part and manual minifigure have long asked for the account, here it was missing. Consequence: a set
  // added from the catalog always ended up in the own account without anyone noticing. Exactly the pattern
  // that runs through this project.
  const owner_user_id = selectedOwner('cat-m-owner');
  // Read BEFORE closing: closeCatModal() clears the dialog, afterwards the field is empty. Marco's
  // finding from 24.09. ("from the catalog into the gallery — storage location cannot be set") would otherwise only be half
  // fixed.
  const storage = selectedStorage('cat-m-storage');
  closeCatModal();
  showProgress(tRaw('gallery.adding_set', { num }), false);
  try {
    await streamRequest(
      '/v2/sets/add-stream',
      { set_number: num, quantity: qty, purchase_price, condition, owner_user_id, storage },
      ev => {
        handleSseEvent(ev, num);
        if (ev.step === 'done') {
          streamDone();
          setTimeout(() => {
            hideProgress();
            toast(
              tRaw(ev.action === 'added' ? 'gallery.set_added' : 'gallery.set_updated', {
                num: ev.set_number,
              }),
              'success',
            );
            setLastImportAt(Date.now());
            _patchCatalogOwned(num, qty); // owned badge in place (no reload: the scroll position stays)
            emit('collectionLoad');
          }, 800);
        } else if (ev.step === 'error') {
          streamDone();
          setTimeout(() => {
            hideProgress();
            toast(ev.error, 'error');
          }, 1500);
        }
      },
    );
  } catch (e) {
    if (/** @type {Error} */ (e).name !== 'AbortError') {
      hideProgress();
      toast(errorMessage(e), 'error');
    }
  }
}

/**
 * Update a set's owned badge in the loaded list without reloading the list (infinite scroll:
 * the scroll position is kept).
 * @param {string} setNumber
 * @param {number} qty
 */
function _patchCatalogOwned(setNumber, qty) {
  const it = _catItems.find(x => x.set_number === setNumber);
  if (!it) return;
  it.owned = true;
  it.owned_quantity = (parseInt(String(it.owned_quantity), 10) || 0) + (qty || 1);
  const el = document.querySelector(
    `#catalog-grid .sc[data-sn="${window.CSS && CSS.escape ? CSS.escape(setNumber) : setNumber}"]`,
  );
  if (el) {
    insertHtml(el, 'afterend', catCard(it));
    el.remove();
  }
}

// ── Register handlers with the dispatcher (see js/registry.js) ─────────────
registerActions({
  loadCatalogSets,
  closeCatModal,
  openCatModal,
});

// The application draws the bar (#app-scrollbar); the catalog only supplies the year next to it. Read from
// the topmost visible tile — estimated only where nothing is loaded yet.
function _yearOnPosition() {
  const grid = G('catalog-grid');
  if (!grid) return null;
  // First choice: the topmost VISIBLE tile. As soon as the page is loaded, that is the truth and not a
  // calculation.
  for (const card of queryAll('.sc:not(.cat-page-ph)', grid)) {
    const r = card.getBoundingClientRect();
    if (r.bottom >= 0) {
      const year = card.dataset.year;
      if (year) return parseInt(year, 10);
      break;
    }
  }
  // Second choice: compute via the actual distribution of the years. Converted linearly to 1949–2027 it showed
  // "1965" at nine tenths, because the catalog stems almost entirely from the last decades.
  if (!_catYearDistribution.length || !_catTotal) return null;
  const doc = document.documentElement;
  const rollbar = Math.max(1, doc.scrollHeight - window.innerHeight);
  const share = Math.min(1, Math.max(0, window.scrollY / rollbar));
  let number = Math.round(share * (_catTotal - 1));
  for (const entry of _catYearDistribution) {
    if (number < entry.n) return entry.year;
    number -= entry.n;
  }
  return _catYearDistribution[_catYearDistribution.length - 1]?.year ?? null;
}

/**
 * Fetch the year distribution for the current filters.
 *
 * From the SERVER, because only it knows the filters: a distribution over the whole catalog would be just as wrong
 * with a theme or search text set as the former linear estimate. Once per list build, not while scrolling.
 */
async function _loadYearDistribution() {
  const p = new URLSearchParams();
  if (_catState.q) p.set('q', _catState.q);
  if (_catState.theme) p.set('theme_id', _catState.theme);
  p.set('sort', _catState.sort);
  if (p.toString() === _yearDistributionFor && _catYearDistribution.length) return;
  _yearDistributionFor = p.toString();
  _catYearDistribution = [];
  const d = await loadCatalog.whenCurrent(api('GET', `/v2/catalog/year-distribution?${p.toString()}`));
  if (d === undefined) return;
  if (d?.success) _catYearDistribution = (d.years || []).filter(y => y.year);
  else _yearDistributionFor = '';
}
/** Filter of the loaded year distribution: it does not change when re-entering the tab. */
let _yearDistributionFor = '';

/** Register the label when entering the tab, unregister it when leaving. */
function _initYearRail() {
  const sensible =
    _catYearMin &&
    _catYearMax &&
    _catYearMax > _catYearMin &&
    (_catState.sort === 'year_desc' || _catState.sort === 'year_asc');
  // With "name A–Z" the years are scattered — a year in the label would say nothing there.
  setScrollLabel(
    sensible
      ? () => {
          const j = _yearOnPosition();
          return j ? String(j) : null;
        }
      : null,
  );
}
