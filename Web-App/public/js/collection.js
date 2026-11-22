// The collection: metrics, gallery (tiles and list), set CSV import and deletion. It also
// reloads when a lower-level module emits 'setsChanged' or 'stockChanged'.
import { subscribe, emit } from './events.js';
import {
  skeletonTiles,
  listLoadError,
  condBadges,
  ownerBadges,
  pnlBadge,
  estimatedPurchase,
  tileName,
  accountDisplay,
} from './components.js';
import { genuine, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { html, rawHtml } from './escaping.js';
import { api } from './api.js';
import { loadGuard } from './load-guard.js';
import { imageTag, fullUrl, placeholderContent, imgUrl, observeLazyImages, thumbUrl } from './images.js';
import {
  emptyState,
  reportHits,
  ico,
  G,
  TRASH_ICON_SVG,
  resetButton,
  queryAll,
  insertHtml,
  setHtml,
  phoneWidth,
  atPhoneSwitch,
} from './dom.js';
import { fmtDate, fmtMoney, fmtN, isGift } from './format.js';
import { toast } from './messages.js';
import { addScopeParam, scopeQuery, addLocationParam, locationMode } from './account-filter.js';
import { deleteRestorable } from './deletion.js';
import {
  accountCurrency,
  loggedInAccount,
  setGallerySets,
  gallerySets,
  openSet,
  pnlBySet,
  setPnlBySet,
} from './state.js';
import { deleteWithChoice } from './confirm-prompt.js';
import { COLUMNS_SORT, setsTable, tableRow, valueCell } from './sets-table.js';
import { loadStats } from './metrics.js';
/** @typedef {import('./state.js').Tile} Tile */

/**
 * The theme hue for the colour-fan theme (farbfaecher) — in the collection too: without it that theme was grey on
 * grey here. With no theme id, the theme name decides, so a theme always carries the same hue.
 * @param {{ theme_id?: number | null, theme?: string | null }} s
 */
function themeFanTone(s) {
  if (typeof s.theme_id === 'number' && Number.isInteger(s.theme_id))
    return html` data-fan="${((s.theme_id % 12) + 12) % 12}"`;
  const name = String(s.theme || '').split(' / ')[0];
  if (!name) return '';
  let h = 0;
  for (const c of name) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return html` data-fan="${h % 12}"`;
}

// ── GALLERY ───────────────────────────────────────────
let curView = 'grid';
const asTiles = () => curView === 'grid' || phoneWidth();

/**
 * Takes over the condition aggregate from the server: recomputing it locally used the most recently
 * recorded entry and showed "new" for [U, N] instead of "used".
 * @param {Partial<Tile> | null | undefined} agg
 */
export function applySetAggregate(agg) {
  if (!agg?.set_number) return;
  const before = gallerySets;
  setGallerySets(gallerySets.map(s => (s.set_number === agg.set_number ? { ...s, ...agg } : s)));
  if (gallerySets !== before) renderGallery();
}
// ── Infinite scroll of the gallery ───────────────────────────────────────────────
// Filtering and sorting is done by the server: searching via gallerySets only searched the pages already loaded.
const GAL_PAGE_SIZE = 60;
const galleryGuard = loadGuard();
let _galPage = 1,
  _galDone = false,
  _galLoadingMore = false,
  _galTotal = 0;

/**
 * Current filter and sort values as query parameters.
 * @param {number} page
 */
function galleryParams(page, pageSize = GAL_PAGE_SIZE) {
  const p = new URLSearchParams();
  p.set('page', String(page));
  p.set('page_size', String(pageSize));
  const q = G('gs')?.value?.trim();
  if (q) p.set('search', q);
  const th = G('gtheme')?.value;
  if (th) p.set('theme', th);
  const so = G('gsort')?.value;
  if (so) p.set('sort', so);
  addScopeParam(p, 'gallery');
  addLocationParam(p, 'gallery');
  return p.toString();
}

async function loadGalleryMore() {
  if (_galLoadingMore || _galDone) return;
  _galLoadingMore = true;
  const gen = galleryGuard.current();
  try {
    const d = await galleryGuard.whenCurrent(api('GET', `/v2/sets?${galleryParams(_galPage + 1)}`));
    if (d === undefined) return;
    const batch = d.sets || [];
    if (!batch.length) {
      _galDone = true;
      return;
    }
    _galPage++;
    setGallerySets(gallerySets.concat(batch));
    if (gallerySets.length >= (_galTotal || 0)) _galDone = true;
    appendGallery(batch);
    updateGalleryPrices();
    kickGallerySentinel(); // see explanation there
  } catch (_) {
    /* silent: the sentinel tries again on the next scroll */
  } finally {
    if (galleryGuard.isCurrent(gen)) _galLoadingMore = false;
  }
}

/**
 * Appends a following page without rebuilding the tiles already drawn.
 * @param {Tile[]} batch
 */
function appendGallery(batch) {
  const c = G('gallery');
  const grid = c.querySelector('.sgrid');
  const tbody = c.querySelector('.dt tbody');
  if (asTiles() && grid) {
    insertHtml(grid, 'beforeend', batch.map(gridCard));
    observeLazyImages(grid);
  } else if (tbody) {
    insertHtml(tbody, 'beforeend', batch.map(tableRow));
  } else {
    renderGallery(); // structure is missing (empty state)
  }
}

function maybeLoadMoreGallery() {
  if (!G('tab-gallery')?.classList.contains('active')) return;
  loadGalleryMore();
}

/**
 * Check for ourselves whether the sentinel is visible: IntersectionObserver only reports transitions, and
 * if the content beneath it is replaced, nothing loads any more until the page is scrolled up and down again.
 */
function kickGallerySentinel() {
  const sent = G('gallery-sentinel');
  if (!sent) return;
  if (sent.getBoundingClientRect().top < window.innerHeight + 600) {
    requestAnimationFrame(maybeLoadMoreGallery);
  }
}

function bindGallerySentinel() {
  const sent = G('gallery-sentinel');
  if (!sent || sent._bound) return;
  sent._bound = true;
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(
      es => {
        if (es.some(e => e.isIntersecting)) maybeLoadMoreGallery();
      },
      { rootMargin: '600px' },
    ).observe(sent);
  } else {
    window.addEventListener(
      'scroll',
      () => {
        if (sent.getBoundingClientRect().top < window.innerHeight + 600) maybeLoadMoreGallery();
      },
      { passive: true },
    );
  }
}

/**
 * @param {{restore?: boolean}} [opts] restore=true keeps the DEPTH already
 *   scrolled to and the scroll position.
 *
 * ── Why restore exists (Marco's report) ─────────────────────
 * After an owner change in the purchase-price dialog, the caller simply called
 * loadGallery(). That resets _galPage to 1: whoever had scrolled down to row 50
 * suddenly faced 60 tiles instead of 300. The document shrinks, the browser
 * clamps the scrollbar to the new end — the felt "jump to the top". And
 * because the sentinel STAYS visible through this, IntersectionObserver
 * reports no transition: it only loaded again after scrolling up and back
 * down. Both exactly as reported.
 *
 * restore fetches the full depth back in ONE request (the server caps
 * page_size at MAX_PAGE_SIZE=500; above that the sentinel takes over as
 * usual) and restores the scroll position after drawing.
 */
export async function loadGallery(opts = {}) {
  showFilterNumber();
  // Remember depth and position BEFORE anything is reset.
  const depth = opts.restore ? Math.max(1, _galPage) : 1;
  const scrollY = opts.restore ? window.scrollY : null;
  // A multiple of GAL_PAGE_SIZE under the server cap — otherwise the page math for the next load-more
  // no longer lines up.
  const fetchSize = Math.min(depth * GAL_PAGE_SIZE, 480);

  // Placeholder only without tiles: an existing list stays until the response arrives, otherwise an
  // empty wall flashed up.
  const gal = G('gallery');
  if (!gallerySets.length || !gal.querySelector('.sgrid, .tw, .empty')) {
    setHtml(gal, skeletonTiles(8, tRaw('gallery.loading')));
  }
  galleryGuard.start();
  _galPage = 1;
  // Until the first page is there, the sentinel loads nothing more: otherwise it would request page 2 of
  // a stale list.
  _galDone = true;
  _galLoadingMore = false;
  const hadList = gallerySets.length > 0;
  const d = await galleryGuard.whenCurrent(api('GET', `/v2/sets?${galleryParams(1, fetchSize)}`));
  if (d === undefined) return;
  if (listLoadError(gal, d, { again: 'loadGallery', keep: hadList })) {
    if (hadList) renderGallery();
    return;
  }
  setGallerySets(d.sets || []);
  _galTotal = d.total ?? gallerySets.length;
  // Align the page counter with the amount actually fetched, so the next page starts at the right offset.
  _galPage = Math.max(1, Math.ceil(gallerySets.length / GAL_PAGE_SIZE));
  _galDone = gallerySets.length >= _galTotal;
  bindGallerySentinel();
  // If the first page doesn't fill the screen, there would never be a scroll event.
  requestAnimationFrame(maybeLoadMoreGallery);

  // The server names the themes: gallerySets only holds the pages loaded so far.
  const themeEl = G('gtheme');
  if (themeEl && Array.isArray(d.themes)) {
    const current = themeEl.value;
    setHtml(
      themeEl,
      html`${html`<option value="">${tRaw('gallery.filter.all')}</option>`}${d.themes.map(th => html`<option value="${th}"${th === current ? ' selected' : ''}>${th}</option>`)}`,
    );
    themeEl.value = current;
  }
  if (themeEl && !themeEl._bound) {
    themeEl._bound = true;
    themeEl.addEventListener('change', () => loadGallery());
  }
  renderGallery();
  loadStats();
  // Only jump back AFTER drawing — before that the document is still short and the browser would clip
  // the position again.
  if (scrollY != null) requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
  enrichGalleryWithPrices();
}

const galleryNoHits = (/** @type {string} */ q) =>
  q ? tRaw('common.no_hits', { query: q }) : tRaw('gallery.no_results_filter');

/** @param {boolean} filtered @param {string} q */
function galleryEmpty(filtered, q) {
  if (filtered) return emptyState({ ico: 'search', title: galleryNoHits(q), button: resetButton('gallery') });
  return emptyState({
    ico: 'set',
    title: tRaw('gallery.empty'),
    text: tRaw(phoneWidth() ? 'gallery.empty_hint_phone' : 'gallery.empty_hint'),
    button: { text: tRaw('gallery.add.title'), click: 'openCapture', arg: 'set' },
  });
}

export function renderGallery() {
  // Filtering and sorting is done by the server (src/sets/read.ts) — this only draws what
  // is already loaded. Otherwise a filter would merely search the currently loaded page.
  const q = G('gs')?.value?.toLowerCase() || '';
  const list = gallerySets;
  const c = G('gallery');
  // A filter with no search text (theme, storage location) is a filter too: otherwise "No sets yet"
  // would show over a collection that is merely hidden.
  const filtered = !!(q || G('gtheme')?.value || locationMode('gallery'));
  // Without a single set, the fields filter and sort nothing (N5).
  G('tab-gallery')?.classList.toggle('collection-empty', !list.length && !filtered);
  if (filtered) reportHits(list.length ? tRaw('match.sets', { n: _galTotal || list.length }) : galleryNoHits(q));
  if (!list.length) {
    setHtml(c, galleryEmpty(filtered, q));
    return;
  }
  if (asTiles()) {
    setHtml(c, html`<div class="sgrid">${list.map(gridCard)}</div>`);
    observeLazyImages(c);
  } else {
    setHtml(c, setsTable(list));
    observeLazyImages(c); // was completely missing for the list view
  }
}
/**
 * Backfill prices into the existing tiles instead of rebuilding the whole wall: freshly built <img>
 * elements faded in again and made the gallery flicker.
 */
export function updateGalleryPrices() {
  const bySet = new Map(gallerySets.map(x => [x.set_number, x]));
  queryAll('[data-price-for]').forEach(el => {
    const s = bySet.get(el.dataset.priceFor ?? '');
    if (!s) return;
    const content = priceLine(s);
    setHtml(el, content);
    el.hidden = !content;
  });
  queryAll('[data-tab-value-for]').forEach(el => {
    const s = bySet.get(el.dataset.tabValueFor ?? '');
    if (s) setHtml(el, valueCell(s));
  });
}

/**
 * Price and percentage of the tile with a label: without it there was no telling whether the amount was
 * the market or purchase price, or what the percentage was computed against. Without a loaded market
 * price, the quantity-weighted purchase price shows instead.
 * @param {Tile} s
 */
function priceLine(s) {
  const buy = s.avg_purchase_price ?? s.max_purchase_price;
  // The server says where tile_price comes from: without a market price it is the purchase price.
  const market = !!s._price && (s._source ? s._source === 'market' : true);
  const buyAmount = buy != null ? fmtMoney(buy, accountCurrency) : s._price ? fmtMoney(s._price, accountCurrency) : '';
  const amount = market
    ? fmtN(s._price, accountCurrency)
    : s.purchase_price_estimated && buyAmount
      ? String(estimatedPurchase(buyAmount))
      : buyAmount;
  // A gift shows as a badge next to the condition: in the price box it read as a property of the market price.
  const pnl = isGift(buy) ? '' : pnlBadge(s._pnl_pct, buy);
  if (!amount && !pnl) return '';
  const kind = amount
    ? html`<span class="price-kind">${tRaw(market ? 'gallery.card.market' : 'gallery.card.paid')}</span>`
    : '';
  const pct = pnl
    ? html`<span title="${tRaw('gallery.card.pnl_hint')}"><span class="vh">${tRaw('gallery.card.pnl_hint')}: </span>${pnl}</span>`
    : '';
  return html`${kind}<span class="price">${rawHtml(amount)}</span>${pct ? html`<span class="price-pnl">${pct}</span>` : ''}`;
}

/** thumbUrl() only applies to locally stored images (the _thumb variant). Sets with no local copy go
 * through the proxy — there imgUrl(…, true) produces the scaled-down version, otherwise full resolution
 * would load for a tile. No alt text: the tile is a button, its text already names the set. @param {Tile} s */
function gridImage(s) {
  const src = s.image_local || s.image_url || '';
  if (!src) return html`<span class="image-ph" aria-hidden="true">${placeholderContent('set')}</span>`;
  const thumb = imgUrl(thumbUrl(src) || src, true);
  return imageTag({ src: thumb || src, alt: '', orig: imgUrl(fullUrl(src)), fade: true, ph: 'set' });
}

/** The date of the last purchase: when importing, the date added to the account was the same day for every
 * set and said nothing. With several purchases (often within a household), the tile shows it is the most
 * recent one. @param {Tile} s @param {string} buyFmt */
function gridBuyText(s, buyFmt) {
  const buys = Number(s.acq_count) || 0;
  return buys > 1
    ? html`<span>${tRaw('gallery.card.purchases', { n: buys })}</span> ${buyFmt}`
    : html`<span>${tRaw('detail.added')}</span> ${buyFmt}`;
}

/** @param {Tile} s @param {unknown} condBadge @param {boolean} unknown */
function gridBadges(s, condBadge, unknown) {
  return html`
          ${s.instructions?.length ? html`<span class="ibadge">${ico('list')}${s.instructions.length}</span>` : ''}
          ${s.quantity > 1 ? html`<span class="qbadge">×${s.quantity}</span>` : ''}
          ${condBadge}
          ${isGift(s.avg_purchase_price ?? s.max_purchase_price) ? html`<span class="gift-badge">${tRaw('finance.gift')}</span>` : ''}
          ${unknown ? html`<span class="unknown-badge" title="${tRaw('gallery.card.unknown_hint')}">${tRaw('gallery.card.unknown')}</span>` : ''}
          ${ownerBadges(s)}
        `;
}

/** @param {Tile} s */
function gridCard(s) {
  const img = gridImage(s);
  // Without a loaded market price, the quantity-weighted purchase price, not the highest one.
  const price = priceLine(s);
  // The date of the last purchase: when importing, the date added to the account was the same day for
  // every set and said nothing. With several purchases (often within a household), the tile shows it is
  // the most recent one.
  const buyFmt = s.last_purchase ? fmtDate(s.last_purchase) : '';
  const buyText = gridBuyText(s, buyFmt);
  // Condition: the server delivers the conditions present as an aggregate — one badge per condition, see
  // condBadges().
  const condBadge = condBadges(s);
  // Without a year, theme or real name, the catalog does not (yet) know this number.
  const unknown = !s.year && !s.theme && (!s.name || s.name === 'Set ' + s.set_number);
  const k = tileName(3);
  return html`<div class="sc"${themeFanTone(s)} tabindex="0" role="button"${k.attr} aria-keyshortcuts="Delete" data-click="openModal" data-arg="${s.set_number}">
    <div class="ca"><span class="delbtn" data-click="delSetStop"${genuine()} aria-hidden="true" data-arg="${s.set_number}" data-key-hint="${tRaw('tile.delete_key')}" title="${t('detail.delete')}">${TRASH_ICON_SVG}</span></div>
    <div class="sci">${img}</div>
    <div class="scb">
      <div class="snum">${s.set_number}</div>
      <div class="sname">${s.name || tRaw('common.unknown')}</div>
      <div class="smeta"${k.teil(0)}>
        <span class="smeta-text"${s.theme ? html` title="${s.theme}"` : ''}>${s.year || '—'}${s.theme ? html`${' · '}${s.theme}` : ''}</span>
        <div class="sbadges">${gridBadges(s, condBadge, unknown)}</div>
      </div>
      <div class="price-badge"${k.teil(1)} data-price-for="${s.set_number}"${price ? '' : ' hidden'}>${price}</div>
      ${buyFmt ? html`<div class="tile-date"${k.teil(2)} title="${t('gallery.card.bought')}">${ico('calendar')} ${buyText}</div>` : html`<div class="tile-date" ${k.teil(2)}></div>`}
    </div>
  </div>`;
}
/** @param {string} field */
async function sortSets(field) {
  const sel = G('gsort');
  const [first, second] = COLUMNS_SORT[field];
  sel.value = sel.value === first ? second : first;
  await loadGallery();
  /** @type {HTMLElement | null} */ (
    document.querySelector(`#gallery [data-click="sortSets"][data-arg="${field}"]`)
  )?.focus();
}

// Add set via SSE stream
/** On a phone the filter sits behind an icon; the number says that a filter is currently active. */
export function showFilterNumber() {
  const num = G('gallery-filter-number');
  if (!num) return;
  const n = ['gtheme', 'storage-gallery'].filter(id => /** @type {HTMLInputElement | null} */ (G(id))?.value).length;
  num.textContent = n ? String(n) : '';
  num.hidden = !n;
}

atPhoneSwitch(() => {
  if (G('gallery')?.querySelector('.sgrid, .tw, .empty.empty-state:not(.error-state)')) renderGallery();
});
G('vg').onclick = () => {
  curView = 'grid';
  G('vg').classList.add('active');
  G('vl').classList.remove('active');
  G('vg').setAttribute('aria-pressed', 'true');
  G('vl').setAttribute('aria-pressed', 'false');
  renderGallery();
};
G('vl').onclick = () => {
  curView = 'list';
  G('vl').classList.add('active');
  G('vg').classList.remove('active');
  G('vl').setAttribute('aria-pressed', 'true');
  G('vg').setAttribute('aria-pressed', 'false');
  renderGallery();
};
// Search debounced by 250 ms: every keystroke reloads (search and sort are computed by the server) and
// rebuilds the whole grid plus the lazy-image observer — noticeably choppy for large collections.
G('gs').addEventListener('input', () => {
  clearTimeout(G('gs')._t);
  G('gs')._t = setTimeout(loadGallery, 250);
});
G('gsort').addEventListener('change', () => loadGallery());

/**
 * Which copies to delete. The own set goes without a question (the toast offers "undo"); if the set also
 * belongs to other accounts, it names accounts and quantities and lets you choose: otherwise the other
 * account's copy was silently deleted too.
 * @param {string} sn @param {string} name @param {Tile | null | undefined} set
 * @returns {Promise<string | null>} '' for all accounts, an account id, or null if cancelled
 */
async function deletionChoice(sn, name, set) {
  const title = tRaw('gallery.delete.title');
  const foreign = (set?.owners || []).some(o => o.id !== loggedInAccount?.id);
  if (!foreign) return '';
  const ad = await api('GET', `/v2/sets/${encodeURIComponent(sn)}/acquisitions`);
  const accounts = (set?.owners || []).map(o => ({
    ...o,
    n: (ad?.acquisitions || [])
      .filter(a => (a.owner_user_id ?? loggedInAccount?.id) === o.id)
      .reduce((s, a) => s + (a.quantity || 0), 0),
  }));
  const list = accounts.map(k => `${accountDisplay(k)} ×${k.n}`).join(', ');
  const total = accounts.reduce((s, k) => s + k.n, 0);
  // Pre-selected is the fewest, the own copy first: Enter would otherwise also have deleted the other one.
  const order = [...accounts].sort(
    (x, y) => Number(y.id === loggedInAccount?.id) - Number(x.id === loggedInAccount?.id),
  );
  return deleteWithChoice(title, tRaw('gallery.delete.accounts', { name, accounts: list }), [
    ...order.map(k => ({
      value: String(k.id),
      text: tRaw('gallery.delete.only', { account: accountDisplay(k), n: k.n }),
    })),
    { value: '', text: tRaw('gallery.delete.all', { n: total }) },
  ]);
}

/**
 * Delete a set: the one place that deletes one, restorable through the trash.
 * @returns {Promise<boolean>} true if it was really deleted
 * @param {string} sn
 */
export async function delSet(sn) {
  const known =
    (openSet && openSet.set_number === sn ? openSet : null) || (gallerySets || []).find(x => x.set_number === sn);
  const name = known?.name || sn;
  const account = await deletionChoice(sn, name, known);
  if (account === null) return false;
  const owner = (known?.owners || []).find(o => String(o.id) === account);
  const nr = CSS.escape(sn);
  const d = await deleteRestorable({
    request: () => api('DELETE', `/v2/sets/${sn}${account ? `?accounts=${account}` : ''}`),
    message: `${tRaw('users.deleted', { name })}${owner ? ` · ${accountDisplay(owner)}` : ''}`,
    focus: `.sc[data-arg="${nr}"], tr[data-arg="${nr}"] .row-open`,
  });
  if (!d) return false;
  loadGallery();
  emit('loadParts');
  return true;
}
/** @param {string} sn */
export async function reimportParts(sn) {
  toast(tRaw('detail.importing_parts', { sn }), 'info');
  const d = await api('POST', `/v2/sets/${sn}/parts`);
  if (d.success) {
    toast(tRaw('detail.parts_imported', { count: d.count }), 'success');
    emit('loadParts');
  } else toast(d.error, 'error');
}

export async function enrichGalleryWithPrices() {
  // With the account filter like loadStats(): loadGallery() calls this on every filter change.
  const pnl = await api('GET', `/v2/finance/pnl${scopeQuery('gallery')}`);
  if (!pnl.success) return;
  setPnlBySet({});
  // The server computes the tile's amount and P&L (tile_price, tile_pnl_pct in /finance/pnl,
  // src/finances/setValue.ts tileValues); in a household, every row of a set carries the same values.
  for (const s of pnl.sets) {
    if (!pnlBySet[s.set_number])
      pnlBySet[s.set_number] = { price: s.tile_price, pnl_pct: s.tile_pnl_pct, source: s.tile_source };
  }
  // Inject price data into cached sets
  setGallerySets(
    gallerySets.map(s => ({
      ...s,
      _price: pnlBySet[s.set_number]?.price || 0,
      _source: pnlBySet[s.set_number]?.source,
      _pnl_pct: pnlBySet[s.set_number]?.pnl_pct ?? undefined,
    })),
  );
  // Only backfill the price containers instead of rebuilding the whole gallery — a full renderGallery()
  // recreates every <img> and makes them fade in again (visible flicker after loading).
  updateGalleryPrices();
}

// CSV template download
G('btn-set-csv-template').onclick = e => {
  e.preventDefault();
  const csv =
    'set_number,quantity,purchase_price,condition,acquired_at\n60098-1,1,49.99,N,2024-01-15\n75192-1,2,,U,\n10497-1,1,,,\n';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'sets-template.csv';
  a.click();
};

// Other modules report that the inventory has changed; reloading happens here.
subscribe('setsChanged', () => {
  loadGallery();
  loadStats();
});
subscribe('stockChanged', () => {
  loadGallery();
  loadStats();
});
subscribe('collectionLoad', o => loadGallery(o));
subscribe('metricsLoad', () => loadStats());
subscribe('collectionDraw', () => renderGallery());
subscribe('setAggregate', agg => applySetAggregate(/** @type {Partial<Tile> | null | undefined} */ (agg)));

// No comment between the names: test/bundle-smoke.test.js splits the keys at commas, and a comment
// would wander into the first name.
/**
 * @param {string} sn
 * @param {Event | undefined} ev
 */
function delSetStop(sn, ev) {
  ev?.stopPropagation();
  delSet(sn);
}

registerActions({
  loadGallery,
  delSet,
  delSetStop,
  reimportParts,
  renderGallery,
  sortSets,
});
