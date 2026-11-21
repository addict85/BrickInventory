// The parts tab: parts from sets (page by page) and the manually captured parts including capture, color choice and
// CSV import — both lists share filter and empty state.
import { subscribe, emit } from './events.js';
import {
  loadDisplay,
  skeletonTiles,
  listLoadError,
  partsBreakdown,
  condBadges,
  ownerBadges,
  rowsButton,
  kachelName,
} from './components.js';
import { registerActions, echt } from './registry.js';
import { colorName, locale, t, tRaw } from '../i18n.js';
import { escHex, esc, html, rawHtml } from './escaping.js';
import { api } from './api.js';
import { loadGuard } from './load-guard.js';
import { bildTag, fullUrl, imgUrl, observeLazyImages, placeholderContent, thumbUrl } from './images.js';
import {
  G,
  emptyState,
  reportHits,
  resetButton,
  TRASH_ICON_SVG,
  activeTab,
  setzeHtml,
  fuegeHtmlEin,
  atPhoneSwitch,
} from './dom.js';
import { fmtBig, fmtN } from './format.js';
import { toast } from './messages.js';
import { addScopeParam, addLagerParam, scopeQuery } from './account-filter.js';
import { gallerySets, accountCurrency } from './state.js';
import { confirmDelete } from './confirm-prompt.js';
import { manualQuery, manualTable, tablesView } from './minifigs.js';
import { deletedWithUndo } from './trash.js';
/** @typedef {import('../../frontend-types/contract').GET_api_v1_parts['parts'][number]} PartRow */

// ── PARTS ─────────────────────────────────────────────
/** @type {import('../../frontend-types/contract').PartsFilterColor[]} */
let partsColors = [];
/** @type {import('../../frontend-types/contract').PartsCategory[]} */
let partsCats = [];
/** @type {string | null} */
let activeColor = null;
/** @type {string | null} */
let activeCat = null;
// Category ID (part_cat_id) -> plain name via the loaded partsCats mapping. Without a name a bare ID is
// unknown; an entered name stays, as in the part detail.
const katName = (/** @type {unknown} */ cn, /** @type {string | null | undefined} */ label) =>
  label || (cn == null || cn === '' || /^\d+$/.test(String(cn)) ? tRaw('common.unknown') : String(cn));
/** @param {unknown} cn */
function catLabel(cn) {
  const c = partsCats.find(x => String(x.category_name) === String(cn));
  return katName(cn, c?.label);
}

export async function loadParts() {
  // Run stats + filters in parallel, then load data (needs filters first for UI)
  await Promise.all([loadPartsStats(), loadPartsFilters()]);
  await loadPartsData();
}
/** Placeholder of a metric while it loads — "—" would mean "no value". */
const VALUE_SKELETON = '<span class="skelett-zeile skelett-wert" aria-hidden="true"></span>';

async function loadPartsStats() {
  const felder = ['ps-total', 'ps-unique', 'ps-colors'];
  const box = G('parts-stats-bar');
  if (!G('ps-total').dataset.geladen) {
    for (const id of felder) setzeHtml(G(id), rawHtml(VALUE_SKELETON));
    box?.setAttribute('aria-busy', 'true');
  }
  const d = await api('GET', `/v1/parts/stats${scopeQuery('parts')}`);
  box?.removeAttribute('aria-busy');
  if (!d.success) {
    if (!G('ps-total').dataset.geladen) for (const id of felder) G(id).textContent = '—';
    return;
  }
  G('ps-total').dataset.geladen = '1';
  const s = d.stats;
  if (!s) return;
  // Like the collection's tile: parts from sets and individually captured ones together.
  const einzeln = s.manual_parts || 0;
  G('ps-total').textContent = fmtBig((s.total_parts || 0) + einzeln);
  G('ps-total-sub').textContent = partsBreakdown(s.total_parts || 0, einzeln);
  G('ps-unique').textContent = fmtBig(s.unique_parts || 0);
  G('ps-colors').textContent = String(s.unique_colors || 0);
}

async function loadPartsFilters() {
  const [cd, catd] = await Promise.all([
    api('GET', `/v1/parts/colors${scopeQuery('parts')}`),
    api('GET', `/v1/parts/categories${scopeQuery('parts')}`),
  ]);
  partsColors = cd.colors || [];
  partsCats = catd.categories || [];
  drawPartsFilter();
}

/**
 * Color and category as select fields in the filter bar. Like search and account they apply to BOTH lists;
 * the manual parts therefore contribute their colors and categories too. Without a choice a field stays
 * hidden.
 */
export function drawPartsFilter() {
  const farben = new Map(
    partsColors.map(c => [
      c.color_name ?? '',
      `${colorName(c.color_name)} (${c.unique_parts} ${t('parts.stat.types')})`,
    ]),
  );
  const kategorien = new Map(partsCats.map(c => [String(c.category_name), katName(c.category_name, c.label)]));
  for (const p of manualPartsCache) {
    if (p.color_name && !farben.has(p.color_name)) farben.set(p.color_name, colorName(p.color_name));
    if (p.category_name != null && p.category_name !== '' && !kategorien.has(String(p.category_name)))
      kategorien.set(String(p.category_name), catLabel(p.category_name));
  }
  fillFilter('parts-color', tRaw('parts.filter.all_colors'), farben, activeColor);
  fillFilter('parts-cat', tRaw('parts.filter.all_categories'), kategorien, activeCat);
}

/**
 * @param {string} id
 * @param {string} alle
 * @param {Map<string, string>} eintraege
 * @param {string | null} gewaehlt
 */
function fillFilter(id, alle, eintraege, gewaehlt) {
  const el = G(id);
  if (!el) return;
  // A chosen color stays selectable, even if another filter currently hides it.
  if (gewaehlt && !eintraege.has(gewaehlt)) eintraege.set(gewaehlt, gewaehlt);
  setzeHtml(
    el,
    html`${html`<option value="">${alle}</option>`}${[...eintraege].map(([wert, text]) => html`<option value="${wert}">${text}</option>`)}`,
  );
  el.value = gewaehlt || '';
  el.style.display = eintraege.size ? '' : 'none';
}

function setColorFilter() {
  activeColor = G('parts-color').value || null;
  loadPartsData();
  renderManualParts();
}
function setCatFilter() {
  activeCat = G('parts-cat').value || null;
  loadPartsData();
  renderManualParts();
}

/**
 * Does a manually captured part match color and category of the filter bar?
 * @param {{ color_name?: string | null, category_name?: unknown }} p
 */
export function partFitsToFilter(p) {
  if (activeColor && p.color_name !== activeColor) return false;
  if (activeCat && String(p.category_name ?? '') !== String(activeCat)) return false;
  return true;
}

/** @type {boolean | null} */
let _setPartsEmpty = null; // null: not loaded yet
/**
 * @type {boolean | null}
 */
let _manualEmpty = null;

/**
 * One empty state for the whole tab: it only stands there if neither manually captured parts nor parts from
 * sets are visible. An empty parts list disappears silently as long as the other one shows something.
 * @param {boolean} [manualEmpty]
 */
export function reconcilePartsEmpty(manualEmpty) {
  if (manualEmpty !== undefined) _manualEmpty = manualEmpty;
  G('tab-parts')?.classList.remove('sammlung-leer');
  const box = G('manual-parts-box');
  // Only visible once the list is loaded and shows something: before, the empty box "manually captured
  // parts" stood above the skeleton.
  if (box) box.style.display = _manualEmpty === false ? '' : 'none';
  if (_setPartsEmpty !== true) return;
  const main = G('parts-main');
  if (_manualEmpty === false) {
    main.replaceChildren();
    return;
  }
  const q = G('parts-search')?.value.trim() || '';
  const gefiltert = !!(activeColor || activeCat || q || G('parts-spare')?.value);
  G('tab-parts')?.classList.toggle('sammlung-leer', !gefiltert);
  // As in all lists: "no … yet" without a filter, otherwise "no hits".
  if (gefiltert) reportHits(q ? tRaw('common.no_hits', { query: q }) : tRaw('parts.no_filter_match'));
  setzeHtml(
    main,
    gefiltert
      ? emptyState({
          ico: 'suche',
          titel: q ? tRaw('common.no_hits', { query: q }) : tRaw('parts.no_filter_match'),
          knopf: resetButton('parts'),
        })
      : emptyState({
          ico: 'teil',
          titel: tRaw('parts.empty'),
          text: tRaw(gallerySets.length ? 'parts.hint_import' : 'parts.none_manual_hint'),
          knopf: { text: tRaw('parts.add_title'), click: 'oeffneErfassen', arg: 'part' },
        }),
  );
}

/** Clear search, spare part, color and category filters (button in the empty state). */
export function resetPartsFilter() {
  activeColor = null;
  activeCat = null;
  for (const id of ['parts-search', 'parts-spare', 'parts-color', 'parts-cat']) {
    const el = G(id);
    if (el) el.value = '';
  }
  partsFilterChanged();
}

// Page by page with infinite scroll instead of the whole wall at once: all part/color combinations were 20 MB
// and tens of thousands of nodes per tab switch. A color can run across the page boundary; _partsLastColor therefore appends
// the new page to the last group instead of a second heading.

const PARTS_PAGE_SIZE = 100;
let _partsPage = 0; // most recently loaded page
let _partsTotal = 0; // total number of groups according to the server
let _partsShown = 0; // groups already rendered
const teileLaden = loadGuard();
let _partsLoading = false;
let _partsDone = false;
/** @type {string | null} */
let _partsLastColor = null; // color of the most recently rendered group

/**
 * Filter and mode parameters for a page query.
 * @param {number} page
 */
function partsParams(page) {
  const p = new URLSearchParams();
  if (activeColor) p.set('color', activeColor);
  if (activeCat) p.set('category', activeCat);
  const search = G('parts-search').value.trim();
  if (search) p.set('search', search);
  const spare = G('parts-spare').value;
  if (spare !== '') p.set('spare', spare);
  const ordnung = G('parts-ordnung').value;
  if (ordnung !== 'farbe') p.set('ordnung', ordnung);
  // Manually captured parts have their own area at the top — here only set parts.
  p.set('exclude_manual', '1');
  // in_sets is opt-in on the server (costs about 155 ms and 2 MB at 380 sets). Only the table view has
  // a column for it, the tile does not.
  if (tablesView('parts-view')) p.set('with_sets', '1');
  p.set('page', String(page));
  p.set('page_size', String(PARTS_PAGE_SIZE));
  addScopeParam(p, 'parts');
  addLagerParam(p, 'parts');
  return p;
}

/** Complete rebuild — on every filter, search or mode change. */
async function loadPartsData() {
  teileLaden.start();
  _partsPage = 0;
  _partsShown = 0;
  _partsTotal = 0;
  _partsDone = false;
  _partsLoading = false;
  _partsLastColor = null;
  _setPartsEmpty = null;

  const main = G('parts-main');
  setzeHtml(main, skeletonTiles(12, tRaw('parts.loading'), 'teil'));
  await loadPartsPage(true);
}

/**
 * Fetch and append the next page.
 * @param {boolean} isFirst
 */
async function loadPartsPage(isFirst) {
  if (_partsLoading || _partsDone) return;
  _partsLoading = true;
  const page = _partsPage + 1;

  const d = await teileLaden.whenCurrent(api('GET', `/v1/parts?${partsParams(page)}`));
  if (d === undefined) {
    _partsLoading = false;
    return;
  }
  if (listLoadError(G('parts-main'), d, { erneut: 'loadParts', behalten: !isFirst })) {
    _partsLoading = false;
    return;
  }

  const parts = d.parts || [];
  _partsTotal = d.total ?? _partsTotal;
  _partsPage = page;

  if (isFirst && !parts.length) {
    _setPartsEmpty = true;
    reconcilePartsEmpty();
    _partsDone = true;
    _partsLoading = false;
    updatePartsSentinel();
    return;
  }

  if (isFirst) {
    _setPartsEmpty = false;
    reconcilePartsEmpty();
    preparePartsShell();
  }
  // As in the collection: a search tells screen readers how many entries it found.
  if (isFirst && (activeColor || activeCat || G('parts-search')?.value.trim() || G('parts-spare')?.value))
    reportHits(tRaw('treffer.eintraege', { n: _partsTotal || parts.length }));
  appendParts(parts);

  _partsShown += parts.length;
  // Done when everything is there or the server delivers less than a full page.
  if (parts.length < PARTS_PAGE_SIZE || (_partsTotal && _partsShown >= _partsTotal)) _partsDone = true;
  updatePartsSentinel();
  _partsLoading = false;

  // If the first page does not fill the screen, there would be no scroll event and the sentinel would stay
  // visible forever. Then load more directly.
  if (!_partsDone && isFirst) requestAnimationFrame(maybeLoadMoreParts);
}

/** Create the basic skeleton depending on the view mode (once per rebuild). */
function preparePartsShell() {
  const main = G('parts-main');
  if (tablesView('parts-view')) {
    setzeHtml(
      main,
      html`${html`<div class="tw"><table class="dt" aria-label="${tRaw('nav.parts')}"><thead><tr>`}${html`<th>${tRaw('col.image_th')}</th><th>${tRaw('col.part_nr')}</th><th>${tRaw('col.name')}</th>`}${html`<th>${tRaw('col.color')}</th><th>${tRaw('col.category')}</th><th>${tRaw('detail.qty')}</th>`}${html`<th>${tRaw('col.sets')}</th>`}${html`</tr></thead><tbody class="parts-body"></tbody></table></div>`}`,
    );
  } else {
    setzeHtml(main, html`<div class="parts-list"></div>`);
  }
  // parts-list and parts-body are children of #parts-main and are replaced on every rebuild — hence
  // classes instead of IDs. The sentinel on the other hand stands statically in index.html (like cat-sentinel) and survives the
  // Moduswechsel.
  bindPartsSentinel();
}

/**
 * Append a page to the existing display.
 * @param {PartRow[]} parts
 */
function appendParts(parts) {
  if (tablesView('parts-view')) {
    const tb = G('parts-main').querySelector('tbody.parts-body');
    if (!tb) return;
    fuegeHtmlEin(tb, 'beforeend', parts.map(partsTableRow));
    if (typeof observeLazyImages === 'function') observeLazyImages(tb);
    if (typeof window.__bimLabelTables === 'function') window.__bimLabelTables(tb.closest('table'));
    return;
  }

  const list = G('parts-main').querySelector('.parts-list');
  if (!list) return;
  // Ungrouped: the same grid without color tiles, the order comes from the server.
  if (G('parts-ordnung').value !== 'farbe') {
    fuegeHtmlEin(list, 'beforeend', parts.map(partsCard));
    if (typeof observeLazyImages === 'function') observeLazyImages(list);
    return;
  }

  // Group by color — the server already delivers sorted by color.
  /** @type {{ color: string, hex: string | null | undefined, parts: PartRow[] }[]} */
  const groups = [];
  for (const p of parts) {
    // Grouping happens via the ENGLISH name — it is the stable key from the database. Only the heading
    // is translated when drawing.
    const key = p.color_name || '';
    const last = groups[groups.length - 1];
    if (last && last.color === key) last.parts.push(p);
    else groups.push({ color: key, hex: p.color_hex, parts: [p] });
  }

  let markup = html``;
  for (const g of groups) {
    // Does the group continue the last one of the previous page? Then hook into its grid instead of creating a second
    // heading of the same color.
    if (g.color === _partsLastColor) {
      const lastGrid = list.querySelector('.parts-group:last-child .parts-grid');
      if (lastGrid) {
        fuegeHtmlEin(lastGrid, 'beforeend', g.parts.map(partsCard));
        bumpGroupCount(lastGrid.closest('.parts-group'), g.parts.length);
        if (typeof observeLazyImages === 'function') observeLazyImages(lastGrid);
        continue;
      }
    }
    markup = html`${markup}${html`<div class="parts-group" data-count="${g.parts.length}">
      <div class="group-hd">
        <div class="color-dot gross" data-farbe="${escHex(g.hex, 'var(--s300)')}"></div>
        <span class="group-title">${g.color ? colorName(g.color) : tRaw('parts.farbe_unbekannt')}</span>
        <span class="group-sub">${tRaw('parts.group_types', { n: g.parts.length })}</span>
      </div>
      <div class="parts-grid">${g.parts.map(partsCard)}</div>
    </div>`}`;
    _partsLastColor = g.color;
  }
  if (markup) {
    fuegeHtmlEin(list, 'beforeend', markup);
    if (typeof observeLazyImages === 'function') observeLazyImages(list);
  }
  if (groups.length) _partsLastColor = groups[groups.length - 1].color;
}

/**
 * Increase the counter in the group heading. Without that it would show the number of cards from the FIRST
 * page, although the group has grown further in the meantime.
 * @param {HTMLElement | null | undefined} groupEl
 * @param {number} add
 */
function bumpGroupCount(groupEl, add) {
  if (!groupEl) return;
  const n = (parseInt(groupEl.dataset.count ?? '', 10) || 0) + add;
  groupEl.dataset.count = String(n);
  const sub = groupEl.querySelector('.group-sub');
  if (sub) sub.textContent = tRaw('parts.group_types', { n });
}

/**
 * Spare part badge. `p.is_spare` is enough, because the server turns the four spellings into a real boolean in
 * istErsatzteil() — the string "0" would be truthy in JavaScript.
 * @param {{ is_spare?: boolean | null }} p
 */
function sparePartBadge(p) {
  return p.is_spare ? html`<span class="spare-tag">${t('parts.spare_tag')}</span>` : '';
}

/** Alternative text of a part image: name and color, as they stand on the tile. */

/** @param {PartRow} p */
function partsCard(p) {
  const k = kachelName();
  // data-orig feeds the zoom (actions.js, openImageLightboxFromEl): VIA the server proxy in full
  // resolution (imgUrl(fullUrl(...), false)), no longer the raw CDN address directly in the browser. Unlike
  // for sets deliberately so — at the user's request the parts' detail image should also go through the backend, not
  // bypass the server directly to the CDN.
  const rawSrc = p.image_local || p.image_url || '';
  // The tile opens the detail dialog (Marco's wish). Until now it was dead: unlike manually
  // captured parts, there was nothing to see for a part from a set — no image in full size, no
  // information about which set it comes from.
  return html`<div class="part-card" data-stil="cursor:pointer" tabindex="0" role="button"${k.attr} data-click="openSetItemDetail" data-arg="part" data-arg2="${p.part_number}" data-arg3="${p.color_id || 0}">
    ${rawSrc ? bildTag({ src: imgUrl(thumbUrl(rawSrc) || rawSrc, true), alt: '', klasse: 'part-img', fade: true, orig: imgUrl(fullUrl(rawSrc), false), ph: 'teil' }) : html`<span class="bild-ph part-img" aria-hidden="true">${placeholderContent('teil')}</span>`}
    <div class="part-num" title="${p.part_number}">${p.bl_part_number || p.part_number}</div>
    <div class="part-name">${p.part_name || '—'}</div>
    <div class="part-color"><div class="color-dot" data-farbe="${escHex(p.color_hex, 'var(--s300)')}"></div>${colorName(p.color_name)}</div>
    <div class="kachel-mehr"${k.teil(0)}>
    <div class="part-qty">×${(p.total_quantity || 0).toLocaleString(locale())}</div>
    ${sparePartBadge(p)}
    </div>
  </div>`;
}

/** @param {PartRow} p */
function partsTableRow(p) {
  // The same action as on the tile — one view must not be able to do what the other cannot. Exactly
  // there things have already drifted apart several times in this project.
  return html`<tr data-stil="cursor:pointer" data-click="openSetItemDetail" data-arg="part" data-arg2="${p.part_number}" data-arg3="${p.color_id || 0}">
    <td>${p.image_local || p.image_url ? bildTag({ src: imgUrl(thumbUrl(p.image_local || p.image_url) || p.image_local || p.image_url, true), alt: '', klasse: 'bild-klein', ph: 'teil' }) : html`<span class="bild-ph bild-klein" aria-hidden="true">${placeholderContent('teil')}</span>`}</td>
    <td>${rowsButton(
      { click: 'openSetItemDetail', arg: 'part', arg2: p.part_number, arg3: p.color_id || 0 },
      html`<span data-stil="font-family:var(--mono);font-size:var(--fs-1);color:var(--b600)" title="${p.part_number}">${p.bl_part_number || p.part_number}</span>`,
      tRaw('zeile.oeffnen', { name: p.part_name || p.part_number, nr: p.bl_part_number || p.part_number }),
    )}</td>
    <td data-stil="max-width:200px">${p.part_name || '—'} ${sparePartBadge(p)}</td>
    <td><div data-stil="display:flex;align-items:center;gap:5px"><div class="color-dot" data-farbe="${escHex(p.color_hex, 'var(--s300)')}"></div>${colorName(p.color_name)}</div></td>
    <td>${catLabel(p.category_name)}</td>
    <td><span data-stil="font-family:var(--mono);font-weight:600;color:var(--b700)">${(p.total_quantity || 0).toLocaleString(locale())}</span></td>
    <td data-stil="font-size:var(--fs-1);color:var(--mut)">${(p.in_sets || '').replace(/,/g, ', ')}</td>
  </tr>`;
}

/** Loading hint or final row below the list. */
function updatePartsSentinel() {
  const s = G('parts-sentinel');
  if (!s) return;
  if (_partsDone) {
    setzeHtml(
      s,
      _partsTotal
        ? html`<div data-stil="text-align:center;color:var(--mut);font-size:var(--fs-2);padding:1rem">${tRaw('parts.eintraege', { n: _partsTotal })}</div>`
        : '',
    );
  } else {
    setzeHtml(s, loadDisplay('', { stil: 'padding:1rem' }));
  }
}

/** Without IntersectionObserver the listener hangs on the window, once per page. */
let scrollBound = false;
/** @type {IntersectionObserver | null} */
let _partsIO = null;
function bindPartsSentinel() {
  const s = G('parts-sentinel');
  if (!s) return;
  if (typeof IntersectionObserver !== 'undefined') {
    if (_partsIO) _partsIO.disconnect();
    _partsIO = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) maybeLoadMoreParts();
      },
      { rootMargin: '600px' }, // Lead time, so that loading happens before becoming visible
    );
    _partsIO.observe(s);
  } else if (!scrollBound) {
    // Fallback for browsers without IntersectionObserver
    scrollBound = true;
    window.addEventListener(
      'scroll',
      () => {
        const el = G('parts-sentinel');
        if (el && el.getBoundingClientRect().top < window.innerHeight + 600) maybeLoadMoreParts();
      },
      { passive: true },
    );
  }
}

function maybeLoadMoreParts() {
  if (_partsDone || _partsLoading) return;
  // Only load if the parts tab is actually visible.
  const tab = G('tab-parts');
  if (tab && !tab.classList.contains('active')) return;
  loadPartsPage(false);
}

/**
 * The search text applies to BOTH lists of the tab: the filter bar stands above the manual parts, so
 * they must filter along. One debounce for both, so that no list can be forgotten.
 */
function partsFilterChanged() {
  loadPartsData();
  loadManualParts();
}
G('parts-search').addEventListener('input', () => {
  clearTimeout(G('parts-search')._t);
  G('parts-search')._t = setTimeout(partsFilterChanged, 350);
});
G('parts-spare').addEventListener('change', loadPartsData);
// The order is a preference, not a filter: it stays in the browser.
const PARTS_ORDER_KEY = 'bim_teile_ordnung';
try {
  const gemerkt = localStorage.getItem(PARTS_ORDER_KEY);
  if (gemerkt && [...G('parts-ordnung').querySelectorAll('option')].some(o => o.value === gemerkt))
    G('parts-ordnung').value = gemerkt;
} catch (_) {
  /* without storage the default applies */
}
G('parts-ordnung').addEventListener('change', () => {
  try {
    localStorage.setItem(PARTS_ORDER_KEY, G('parts-ordnung').value);
  } catch (_) {
    /* convenience only */
  }
  loadPartsData();
});
/**
 * The view switch applies to both lists. The set parts reload (the table needs with_sets=1), the
 * manual ones are only redrawn: they already have the data, a second fetch would only be waiting time.
 */
function partsViewChanged() {
  loadPartsData();
  renderManualParts();
}
G('parts-view').addEventListener('change', partsViewChanged);
atPhoneSwitch(() => {
  if (G('parts-view').value === 'table') partsViewChanged();
});

// ── MANUAL PARTS ─────────────────────────────────────────────────────────────
/** @type {ManuellesTeil[]} */
let manualPartsCache = [];
/** The most recently loaded manually captured parts (read only). */
export function manualParts() {
  return manualPartsCache;
}

export async function loadManualParts() {
  const [d, v] = await Promise.all([
    api('GET', `/v1/parts/manual${manualQuery('parts', 'parts-search')}`),
    // The same filter as the list above: otherwise counter and quantity from one scope would stand next to
    // a sum from another.
    api('GET', `/v1/finance/parts-valuation${scopeQuery('parts')}`),
  ]);
  if (!d.success) return;
  manualPartsCache = d.parts || [];
  renderManualParts();
  if (v.success) {
    if (G('mp-count')) G('mp-count').textContent = String(d.parts.length);
    if (G('mp-qty')) G('mp-qty').textContent = String(d.parts.reduce((s, p) => s + (p.quantity || 0), 0));
    if (G('mp-val')) G('mp-val').textContent = fmtN(v.total_value, v.currency || accountCurrency);
  }
}

export function renderManualParts() {
  const el = G('manual-parts-list');
  drawPartsFilter();
  const teile = manualPartsCache.filter(partFitsToFilter);
  reconcilePartsEmpty(!teile.length);
  if (G('manual-parts-n'))
    G('manual-parts-n').textContent = teile.length ? tRaw('parts.group_types', { n: teile.length }) : '';
  if (!teile.length) {
    el.replaceChildren();
    return;
  }
  if (tablesView('parts-view')) {
    setzeHtml(el, manualTable(teile, 'part'));
    if (typeof window.__bimLabelTables === 'function') window.__bimLabelTables(el.querySelector('table'));
    return;
  }
  setzeHtml(
    el,
    html`<div class="man-grid">
    ${teile.map(p => {
      // Preview via the server proxy as everywhere: never the CDN image in full resolution in the tile.
      const imgSrc = imgUrl(thumbUrl(p.image_local || p.image_url) || p.image_local || p.image_url || '', true);
      const img = imgSrc
        ? bildTag({ src: imgSrc, alt: '', klasse: 'man-tile-img', ph: 'teil' })
        : `<span class="bild-ph man-tile-img" aria-hidden="true">${placeholderContent('teil')}</span>`;
      const colorRow = p.color_name
        ? `<div class="man-tile-color">${p.color_hex ? `<span class="man-tile-swatch" data-farbe="${escHex(p.color_hex, 'var(--s300)')}"></span>` : ''}${esc(colorName(p.color_name))}</div>`
        : '';
      // As for the minifigures: weighted by quantity over the acquisitions.
      const partPrice = p.avg_purchase_price ?? p.unit_price ?? p.purchase_price;
      // Unit price as in the finances with "each"; next to "×{n}" the bare amount would read as a sum.
      const priceStr = partPrice != null ? esc(tRaw('finance.je', { preis: fmtN(partPrice, accountCurrency) })) : '—';
      const condBadge = condBadges(p);
      const k = kachelName();
      return html`<div class="man-tile" tabindex="0" role="button"${k.attr} aria-keyshortcuts="Delete" data-click="openManDetail" data-arg="part" data-arg2="${p.part_number}" data-arg3="${p.color_id || 0}" data-stil="cursor:pointer">
        <div class="ca"><span class="delbtn" data-click="deleteManualPartStop"${echt()} aria-hidden="true" data-arg="${p.part_number}" data-arg2="${p.color_id || 0}" data-arg3="${p.user_id || ''}" data-taste="${tRaw('kachel.entf')}" title="${t('parts.delete.title')}">${TRASH_ICON_SVG}</span></div>
        ${rawHtml(img)}
        <div class="man-tile-num" title="${p.part_number}">${p.bl_part_number || p.part_number}</div>
        <div class="man-tile-name">${p.part_name || '—'}</div>
        ${rawHtml(colorRow)}
        <div class="kachel-mehr"${k.teil(0)}>
        <div data-stil="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:2px">
          <span class="qbadge">×${p.quantity}</span>${rawHtml(condBadge)}${ownerBadges(p)}
        </div>
        <div class="preis man-preis">${rawHtml(priceStr)}</div>
        </div>
      </div>`;
    })}
  </div>`,
  );
}

/**
 * @param {number | string} [owner] owner of the card — see deleteManualPart.
 * @param {string} partNumber
 * @param {number} colorId
 * @param {object} body
 */
export async function updateManualPart(partNumber, colorId, body, owner) {
  const d = await api(
    'PUT',
    `/v1/parts/${encodeURIComponent(partNumber)}/${colorId}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`,
    body,
  );
  if (d.success) {
    toast(tRaw('settings.saved'), 'success');
    loadManualParts();
    if (activeTab() === 'finance') emit('finanzenLaden');
  } else toast(d.error || t('settings.error'), 'error');
}

/**
 * @param {string} partNumber
 * @param {number} colorId
 * @param {number|string} [owner]  owner of the CARD. In the household the
 *   manual area shows the entries of all accounts with badge and trash;
 *   without this value the server always deleted the caller's row —
 *   the foreign card was clicked, the own one was gone, and the response said
 *   "success". Reasoning and measurement in src/household/household.ts.
 */
export async function deleteManualPart(partNumber, colorId, owner) {
  if (!(await confirmDelete(tRaw('parts.delete.title'), tRaw('gallery.delete.text', { name: partNumber }), 'teil')))
    return false;
  const d = await api(
    'DELETE',
    `/v1/parts/${encodeURIComponent(partNumber)}/${colorId}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`,
  );
  if (d.success) {
    deletedWithUndo(
      tRaw('parts.deleted'),
      d,
      undefined,
      `.man-tile[data-arg="part"][data-arg2="${CSS.escape(partNumber)}"][data-arg3="${colorId || 0}"]`,
    );
    loadManualParts();
    return true;
  } else {
    toast(d.error || t('settings.error'), 'error');
    return false;
  }
}

subscribe('bestandGeaendert', () => {
  loadParts();
  loadManualParts();
});
subscribe('teileLaden', () => loadParts());

// ── Register handlers with the dispatcher (see js/registry.js) ─────────────
registerActions({
  loadParts,
  setCatFilter,
  setColorFilter,
});
