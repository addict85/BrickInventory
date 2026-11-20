// The minifigures tab: figures from sets and manually captured figures, plus the shared helpers for
// manual tables and CSV status.
import { loadGuard } from './load-guard.js';
import { subscribe, emit } from './events.js';
import { echt, registerActions } from './registry.js';
import {
  listLoadError,
  condBadges,
  ownerBadges,
  schliesseErfassen,
  uploadCsv,
  rowsButton,
  skeletonTiles,
  kachelName,
} from './components.js';
import { colorName, t, tRaw } from '../i18n.js';
import { escHex, esc, html, rawHtml, joinHtml } from './escaping.js';
import { api } from './api.js';
import { bildTag, placeholderContent, fullUrl, imgUrl, thumbUrl } from './images.js';
import {
  emptyState,
  reportHits,
  G,
  TRASH_ICON_SVG,
  resetButton,
  activeTab,
  ico,
  setzeHtml,
  telefonBreite,
} from './dom.js';
import { fmtDatum, fmtN } from './format.js';
import { amountFromField, quantityFromField, purchaseDateValid } from './form.js';
import { toast } from './messages.js';
import { addLagerParam, addScopeParam, scopeQuery } from './account-filter.js';
import { deletedWithUndo } from './trash.js';
import { accountCurrency } from './state.js';
import { emptyLocationField, selectedOwner, selectedStorage } from './account-locations.js';
import { confirmDelete } from './confirm-prompt.js';

// ── MINIFIGUREN ──────────────────────────────────────────────────────────────
/**
 * @typedef {import('../../frontend-types/contract').GET_api_v1_minifigs['figs'][number]} Figur
 */
/** @type {Figur[]} */
let allFigsCache = [];
/** The most recently loaded figures from sets (read only). */
export function allMinifigs() {
  return allFigsCache;
}

// ── Infinite scroll of the minifigures ──────────────────────────────────────
// As in gallery, catalog and parts view. Search and source filter go to the server: filtering on the client over
// allFigsCache would only search the loaded page with page-wise loading.
const FIG_PAGE_SIZE = 60;
const figurenLaden = loadGuard();
let _figPage = 1,
  _figDone = false,
  _figLoadingMore = false,
  _figTotal = 0;

/** @param {number} page */
function figParams(page) {
  const p = new URLSearchParams();
  p.set('page', String(page));
  p.set('page_size', String(FIG_PAGE_SIZE));
  // Fixed 'set': manually captured figures have a section of their own at the top. The exclusion belongs on the server
  // — filtered on the client a whole page could drop out and the list would seem empty.
  p.set('source', 'set');
  const q = G('fig-search')?.value?.trim();
  if (q) p.set('search', q);
  addScopeParam(p, 'minifigs');
  return p.toString();
}

async function loadMinifigsMore() {
  if (_figLoadingMore || _figDone) return;
  _figLoadingMore = true;
  const gen = figurenLaden.current();
  try {
    const d = await api('GET', `/v1/minifigs?${figParams(_figPage + 1)}`);
    if (!figurenLaden.isCurrent(gen)) return;
    const batch = d.figs || [];
    if (!batch.length) {
      _figDone = true;
      return;
    }
    _figPage++;
    allFigsCache = allFigsCache.concat(batch);
    if (allFigsCache.length >= (_figTotal || 0)) _figDone = true;
    appendFigs(batch);
  } catch (_) {
    /* silent — the sentinel tries again on the next scroll */
  } finally {
    if (figurenLaden.isCurrent(gen)) _figLoadingMore = false;
  }
}

function maybeLoadMoreFigs() {
  if (!G('tab-minifigs')?.classList.contains('active')) return;
  loadMinifigsMore();
}

function bindFigsSentinel() {
  const sent = G('figs-sentinel');
  if (!sent || sent._bound) return;
  sent._bound = true;
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(
      es => {
        if (es.some(e => e.isIntersecting)) maybeLoadMoreFigs();
      },
      { rootMargin: '600px' },
    ).observe(sent);
  } else {
    window.addEventListener(
      'scroll',
      () => {
        if (sent.getBoundingClientRect().top < window.innerHeight + 600) maybeLoadMoreFigs();
      },
      { passive: true },
    );
  }
}

export async function loadMinifigs() {
  figurenLaden.start();
  _figPage = 1;
  _figDone = false;
  _figLoadingMore = false;
  // An old error state gives way to the skeleton while reloading (as in the wishlist).
  const liste = G('figs-list');
  if (liste?.querySelector('.fehler-zustand')) setzeHtml(liste, skeletonTiles(8, tRaw('common.loading')));
  const d = await figurenLaden.whenCurrent(api('GET', `/v1/minifigs?${figParams(1)}`));
  if (d === undefined) return;
  if (listLoadError(G('figs-list'), d, { erneut: 'loadMinifigs', behalten: allFigsCache.length > 0 })) return;
  allFigsCache = d.figs || [];
  _figTotal = d.total ?? allFigsCache.length;
  if (allFigsCache.length >= _figTotal) _figDone = true;
  bindFigsSentinel();
  requestAnimationFrame(maybeLoadMoreFigs);
  renderFigs(allFigsCache);
  loadManualFigsTable();

  // Metrics with the tab's filter: otherwise the tile in the household would show the own numbers while
  // the list below showed all accounts.
  const s = await api('GET', `/v1/minifigs/stats${scopeQuery('minifigs')}`);
  if (s.success) {
    G('mf-unique').textContent = String(s.stats.types);
    G('mf-total').textContent = String(s.stats.total_quantity);
  }
  // Manual valuation — with the minifigures tab's filter, so that the value matches the list above.
  const v = await api('GET', `/v1/finance/minifigs-valuation${scopeQuery('minifigs')}`);
  if (v.success && parseFloat(v.total_value) > 0) {
    G('mf-val').textContent = fmtN(v.total_value, v.currency || accountCurrency);
  } else if (G('mf-val')) {
    G('mf-val').textContent = '—';
  }
}

/**
 * The server filters search and source; here a reload happens, otherwise the filter would only search the loaded
 * page. Both lists, because the manual figures stand under the same filter bar.
 */
function filterFigs() {
  loadMinifigs();
  loadManualFigsTable();
}

/**
 * Appends a page loaded later instead of rebuilding the list: replacing via innerHTML aborted the
 * running image requests, and tiles whose image never got past one round stayed empty.
 */
/** @param {Figur[]} batch */
function appendFigs(batch) {
  const el = G('figs-list');
  // Render the page detached, so that the existing list stays untouched.
  const tmp = document.createElement('div');
  renderFigs(batch, tmp);

  const tbody = el.querySelector('.dt tbody');
  const newRows = tmp.querySelectorAll('.dt tbody tr');
  if (tbody && newRows.length) {
    tbody.append(...newRows);
    return;
  }

  // Tile view: append to the last grid, otherwise adopt new groups.
  const lastGrid = [...el.querySelectorAll('.parts-grid, .man-grid, .figs-grid, .sgrid')].pop();
  const newTiles = tmp.querySelectorAll('.parts-grid > *, .man-grid > *, .figs-grid > *, .sgrid > *');
  if (lastGrid && newTiles.length) {
    lastGrid.append(...newTiles);
    return;
  }

  // The structure does not fit (e.g. empty state before) → rebuild once.
  renderFigs(allFigsCache);
}

/**
 * @param {(Figur | ManuelleFigur)[]} list
 * @param {HTMLElement} [target] target container. Default is #figs-list.
 *        If another one is passed, a page can be rendered detached and
 *        appended afterwards — see appendFigs().
 */
export function renderFigs(list, target) {
  const el = target || G('figs-list');
  if (!target) _setMinifigsEmpty = !list.length;
  if (!target && list.length && G('fig-search')?.value.trim())
    reportHits(tRaw('treffer.eintraege', { n: list.length }));
  if (!list.length) {
    if (target) el.replaceChildren();
    else reconcileMinifigsEmpty();
    return;
  }
  if (!target) reconcileMinifigsEmpty();

  if (tablesView('figs-view')) {
    // Without "source" and trash: this list only loads source=set, both columns would be the same or empty
    // in every row. Manual figures have their own area with editable cards.
    setzeHtml(
      el,
      html`<div class="tw"><table class="dt" aria-label="${tRaw('nav.minifigs')}">
      <thead><tr>
        <th>${tRaw('col.image')}</th><th>${tRaw('col.number')}</th><th>${tRaw('col.name')}</th><th>${tRaw('detail.qty')}</th><th>${tRaw('detail.created')}</th>
      </tr></thead>
      <tbody>${list.map(f => {
        const imgSrc = imgUrl(thumbUrl(f.image_local || f.image_url) || f.image_local || f.image_url || '', true);
        const dateVal = /** @type {string | null} */ (f.set_added_at || null);
        const erfasst = dateVal ? fmtDatum(dateVal) : '—';
        // Clickable like the tile below — the same action in both views (Marco's detail dialog
        // for automatically captured figures).
        return html`<tr data-stil="cursor:pointer" data-click="${f.source === 'manual' ? 'openManDetail' : 'openSetItemDetail'}" data-arg="fig" data-arg2="${f.fig_number}" data-arg3="0">
          <td>${imgSrc ? bildTag({ src: imgSrc, alt: '', klasse: 'bild-klein', ph: 'figur' }) : html`<span class="bild-ph bild-klein" aria-hidden="true">${placeholderContent('figur')}</span>`}</td>
          <td>${rowsButton(
            {
              click: f.source === 'manual' ? 'openManDetail' : 'openSetItemDetail',
              arg: 'fig',
              arg2: f.fig_number,
              arg3: 0,
            },
            html`<span data-stil="font-family:var(--mono);font-size:var(--fs-1);color:var(--b600)">${f.fig_number}</span>`,
            tRaw('zeile.oeffnen', { name: f.fig_name || f.fig_number, nr: f.fig_number }),
          )}</td>
          <td data-stil="max-width:200px">${f.fig_name || '—'}</td>
          <td><span data-stil="font-family:var(--mono);font-weight:600;color:var(--b700)">${f.total_quantity || f.quantity}</span></td>
          <td data-stil="font-size:var(--fs-1);color:var(--mut)">${rawHtml(erfasst)}</td>
        </tr>`;
      })}</tbody></table></div>`,
    );
    return;
  }

  // Grid view: group by source (Set / Manual)
  /** @type {Record<string, (Figur | ManuelleFigur)[]>} */
  const groups = {};
  for (const f of list) {
    const key = f.source === 'manual' ? tRaw('figs.group_manual') : tRaw('figs.group_sets');
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }
  setzeHtml(
    el,
    Object.entries(groups).map(
      ([label, figs]) => html`
    <div class="parts-group">
      <div class="group-hd">
        ${ico('set')}<span class="group-title">${rawHtml(label)}</span>
        <span class="group-sub">${tRaw('parts.group_types', { n: figs.length })}</span>
      </div>
      <div class="parts-grid">
        ${figs.map(f => {
          const imgSrc = imgUrl(thumbUrl(f.image_local || f.image_url) || f.image_local || f.image_url || '', true);
          const dateVal = /** @type {string | null} */ (f.set_added_at || null);
          const erfasst = dateVal ? fmtDatum(dateVal) : '';
          // Trash at the top right, as on the set tile: .ca sets top:6px;right:6px and fades it in on
          // hover (styles.css). Marco's requirement from 24.09., second part: "like the tiles for
          // the sets. But only in the web app."
          const delBtn =
            f.source === 'manual'
              ? `<div class="ca"><span class="delbtn" data-click="deleteManualFigStop"${echt()} aria-hidden="true" data-arg="${esc(f.fig_number)}" data-arg2="${f.user_id || ''}" data-taste="${esc(tRaw('kachel.entf'))}" title="${esc(tRaw('figs.delete'))}">${TRASH_ICON_SVG}</span></div>`
              : '';
          // Condition only for manually captured figures — those from sets have none of their own. The
          // owner badge on the other hand always: "whom does this belong to?" arises just the same for the figure from a
          // child's set.
          const condBadge =
            f.source === 'manual'
              ? `<div data-stil="display:flex;gap:3px;justify-content:center;flex-wrap:wrap;margin-top:3px">${condBadges(f)}</div>`
              : '';
          const besitzer = ownerBadges(f)
            ? `<div data-stil="display:flex;gap:3px;justify-content:center;flex-wrap:wrap;margin-top:3px">${ownerBadges(f)}</div>`
            : '';
          // Manually captured figures have their own dialog (purchase prices, quantity editable); those from sets
          // the new one without price and without quantity change. The tile decides by the source, so that
          // BOTH cases are right — even if this list today only
          // loads `source=set`.
          const k = kachelName();
          return html`<div class="part-card" tabindex="0" role="button"${k.attr}${f.source === 'manual' ? html` aria-keyshortcuts="Delete"` : ''} data-stil="position:relative;cursor:pointer" data-click="${f.source === 'manual' ? 'openManDetail' : 'openSetItemDetail'}" data-arg="fig" data-arg2="${f.fig_number}" data-arg3="0">
            ${rawHtml(delBtn)}
            ${imgSrc ? bildTag({ src: imgSrc, alt: '', klasse: 'part-img', fade: true, orig: fullUrl(imgSrc), ph: 'figur' }) : html`<span class="bild-ph part-img" aria-hidden="true">${placeholderContent('figur')}</span>`}
            <div class="part-num">${f.fig_number}</div>
            <div class="part-name">${f.fig_name || '—'}</div>
            <div class="kachel-mehr"${k.teil(0)}>
            <div class="part-qty">×${f.total_quantity || f.quantity}</div>
            ${rawHtml(condBadge)}
            ${rawHtml(besitzer)}
            ${erfasst ? html`<div data-stil="font-size:var(--fs-0);color:var(--mut)">${tRaw('gallery.card.bought')} ${erfasst}</div>` : ''}
            </div>
          </div>`;
        })}
      </div>
    </div>`,
    ),
  );
}

/** @param {string} figNumber @param {number|string} [owner] see deleteManualPart */
export async function deleteManualFig(figNumber, owner) {
  if (!(await confirmDelete(tRaw('figs.delete.title'), tRaw('gallery.delete.text', { name: figNumber }), 'figur')))
    return false;
  const d = await api(
    'DELETE',
    `/v1/minifigs/${encodeURIComponent(figNumber)}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`,
  );
  if (d.success) {
    deletedWithUndo(
      tRaw('figs.deleted'),
      d,
      undefined,
      `.man-tile[data-arg="fig"][data-arg2="${CSS.escape(figNumber)}"]`,
    );
    loadMinifigs();
    loadManualFigsTable();
    return true;
  } else {
    toast(d.error || t('settings.error'), 'error');
    return false;
  }
}

/** @type {ManuelleFigur[]} */
let manualFigsCache = [];
/** The most recently loaded manually captured figures (read only). */
export function manualMinifigs() {
  return manualFigsCache;
}
export async function loadManualFigsTable() {
  const d = await api('GET', `/v1/minifigs/manual${manualQuery('minifigs', 'fig-search')}`);
  if (!d.success) return;
  manualFigsCache = d.figs || [];
  renderManualFigsTable();
}

/** @type {boolean | null} */
let _setMinifigsEmpty = null; // null: not loaded yet
/** @type {boolean | null} */
let _manualMinifigsEmpty = null;

/**
 * As for the parts (reconcilePartsEmpty in parts.js): one empty state for the tab, and only if both
 * lists are empty.
 */
function reconcileMinifigsEmpty() {
  const box = G('manual-figs-box');
  G('tab-minifigs')?.classList.remove('sammlung-leer');
  if (box) box.style.display = _manualMinifigsEmpty === false ? '' : 'none';
  const n = manualFigsCache.length;
  if (G('manual-figs-n')) G('manual-figs-n').textContent = n ? tRaw('parts.group_types', { n }) : '';
  if (_setMinifigsEmpty !== true) return;
  const el = G('figs-list');
  if (_manualMinifigsEmpty === false) {
    el.replaceChildren();
    return;
  }
  const q = G('fig-search')?.value.trim() || '';
  G('tab-minifigs')?.classList.toggle('sammlung-leer', !q);
  if (q) reportHits(tRaw('common.no_hits', { query: q }));
  setzeHtml(
    el,
    q
      ? emptyState({
          ico: 'suche',
          titel: tRaw('common.no_hits', { query: q }),
          knopf: resetButton('minifigs'),
        })
      : emptyState({
          ico: 'figur',
          titel: tRaw('figs.empty'),
          text: tRaw('figs.auto_hint'),
          knopf: { text: tRaw('figs.add_title'), click: 'oeffneErfassen', arg: 'fig' },
        }),
  );
}

/** Clear the search (button in the empty state). */
export function resetMinifigsFilter() {
  const el = G('fig-search');
  if (el) el.value = '';
  filterFigs();
}

export function renderManualFigsTable() {
  const el = G('manual-figs-list');
  if (!el) return;
  _manualMinifigsEmpty = !manualFigsCache.length;
  reconcileMinifigsEmpty();
  if (!manualFigsCache.length) {
    el.replaceChildren();
    return;
  }
  if (tablesView('figs-view')) {
    setzeHtml(el, manualTable(manualFigsCache, 'fig'));
    if (typeof window.__bimLabelTables === 'function') window.__bimLabelTables(el.querySelector('table'));
    return;
  }
  setzeHtml(
    el,
    html`<div class="man-grid">
    ${manualFigsCache.map(f => {
      const imgSrc = imgUrl(thumbUrl(f.image_local || f.image_url) || f.image_local || f.image_url || '', true);
      const img = imgSrc
        ? bildTag({ src: imgSrc, alt: '', klasse: 'man-tile-img', ph: 'figur' })
        : `<span class="bild-ph man-tile-img" aria-hidden="true">${placeholderContent('figur')}</span>`;
      // Quantity-weighted purchase price over the acquisitions (the server computes it). unit_price is the most recently
      // written single value of the master row — with two acquisitions at different prices it was
      // wrong.
      const figPrice = f.avg_purchase_price ?? f.unit_price ?? f.purchase_price;
      const priceStr = figPrice != null ? esc(tRaw('finance.je', { preis: fmtN(figPrice, accountCurrency) })) : '—';
      const condBadge = condBadges(f);
      const k = kachelName();
      return html`<div class="man-tile" tabindex="0" role="button"${k.attr} aria-keyshortcuts="Delete" data-click="openManDetail" data-arg="fig" data-arg2="${f.fig_number}" data-arg3="0" data-stil="cursor:pointer">
        <div class="ca"><span class="delbtn" data-click="deleteManualFigStop"${echt()} aria-hidden="true" data-arg="${f.fig_number}" data-arg2="${f.user_id || ''}" data-taste="${tRaw('kachel.entf')}" title="${t('figs.delete')}">${TRASH_ICON_SVG}</span></div>
        ${rawHtml(img)}
        <div class="man-tile-num">${f.fig_number}</div>
        <div class="man-tile-name">${f.fig_name || '—'}</div>
        <div class="kachel-mehr"${k.teil(0)}>
        <div data-stil="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:2px">
          <span class="qbadge">×${f.quantity}</span>${rawHtml(condBadge)}${ownerBadges(f)}
        </div>
        <div class="preis man-preis">${rawHtml(priceStr)}</div>
        </div>
      </div>`;
    })}
  </div>`,
  );
}

/** @param {string} figNumber @param {object} body @param {number | string} [owner] owner of the card — see deleteManualPart. */
export async function updateManualFig(figNumber, body, owner) {
  const d = await api(
    'PUT',
    `/v1/minifigs/${encodeURIComponent(figNumber)}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`,
    body,
  );
  if (d.success) {
    toast(tRaw('settings.saved'), 'success');
    loadManualFigsTable();
    loadMinifigs();
    if (activeTab() === 'finance') emit('finanzenLaden');
  } else toast(d.error || t('settings.error'), 'error');
}

/**
 * Hint when the purchase price comes from the other condition: BrickLink often lists only one. Adopt and
 * mark it, so that the fallback is neither invisible nor leaves the field empty. One helper for parts and
 * figures.
 * @param {string | null | undefined} zustand 'N' | 'U' | null — null means "nothing to say".
 */
export function priceOriginHint(zustand) {
  if (zustand !== 'N' && zustand !== 'U') return '';
  return t(zustand === 'N' ? 'price.from_other_condition_new' : 'price.from_other_condition_used');
}

G('btn-add-fig')?.addEventListener('click', async () => {
  const num = G('af-num-inline')?.value.trim();
  const res = G('af-inline-result');
  if (!num) {
    res.style.color = 'var(--r500)';
    res.textContent = tRaw('figs.number_required');
    return;
  }
  const preis = amountFromField('af-price-inline');
  const datumOk = purchaseDateValid('af-date');
  const menge = quantityFromField('af-qty-inline');
  if (!preis.ok || !menge.ok || !datumOk) return;
  const btn = G('btn-add-fig');
  btn.disabled = true;
  btn.textContent = '…';
  res.style.color = 'var(--mut)';
  res.textContent = tRaw('adding.progress');
  const d = await api('POST', '/v1/minifigs', {
    fig_number: num,
    bl_fig_number: G('af-blnum-inline')?.value.trim() || null,
    quantity: menge.wert,
    unit_price: preis.wert,
    condition: G('af-condition')?.value || 'N',
    acquired_at: G('af-date')?.value || null,
    owner_user_id: selectedOwner('af-owner'),
    storage: selectedStorage('af-storage'),
  });
  btn.disabled = false;
  btn.textContent = tRaw('gallery.add.submit');
  if (d.success) {
    const hintF = priceOriginHint(d.price_from_condition);
    res.style.color = 'var(--g700)';
    res.textContent =
      `${d.fig_number} ${d.action === 'added' ? t('common.added') : t('common.updated')}` +
      (hintF ? ` — ${hintF}` : '');
    // The dialog closes; the result including the price hint comes as a message.
    schliesseErfassen('fig');
    toast(res.textContent.replace(/^\u2705\s*/, ''), 'success');
    G('af-num-inline').value = '';
    G('af-blnum-inline').value = '';
    G('af-qty-inline').value = '1';
    G('af-price-inline').value = '';
    G('af-date').value = '';
    emptyLocationField('af-storage');
    loadMinifigs();
    // With a hint leave it standing longer: three seconds are enough for a check mark, not for a sentence one
    // is supposed to read.
    setTimeout(
      () => {
        res.textContent = '';
      },
      hintF ? 9000 : 3000,
    );
  } else {
    res.style.color = 'var(--r500)';
    res.textContent = d.error || tRaw('settings.error');
  }
});

// Persistent status/hint line for the CSV import (parts & minifigures)
/**
 * @param {string} elId
 * @param {string} state
 * @param {string} msg
 */
export function csvImportStatus(elId, state, msg) {
  const el = G(elId);
  if (!el) return;
  if (state === 'hide') {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  /** @type {Record<string, string>} */
  const styles = {
    running: 'background:var(--b100);color:var(--b700)',
    success: 'background:var(--g100);color:var(--g700)',
    warn: 'background:var(--s100);color:var(--s600)',
    error: 'background:var(--r100);color:var(--r700)',
  };
  el.style.cssText = `display:block;font-size:var(--fs-3);margin-bottom:1rem;padding:.55rem .8rem;border-radius:8px;font-weight:600;${styles[state] || styles.running}`;
  el.textContent = msg;
}

async function importFigsCsv() {
  const d = await uploadCsv({
    feld: 'fig-csv-file',
    pfad: '/v1/minifigs/import/csv',
    zeige: l => csvImportStatus('fig-csv-status', l ? 'running' : 'hide', tRaw('import.running')),
  });
  if (d) loadMinifigs();
}

G('btn-fig-csv-template').onclick = e => {
  e.preventDefault();
  const csv =
    'fig_number,bl_fig_number,quantity,unit_price,condition,acquired_at\nfig-007357,sw0001,1,12.50,N,2024-01-15\nfig-009314,,2,,U,\n';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'minifigs-template.csv';
  a.click();
};

/**
 * Query part of the manual lists: account filter AND search text. scopeQuery() alone let the search pass the
 * manual tiles by, although the filter bar stands above both lists. Filtering happens on the server.
 * @param {string} view     name of the scope ('parts' | 'minifigs')
 * @param {string} searchId  ID of the filter bar's search field
 */
export function manualQuery(view, searchId) {
  const p = new URLSearchParams();
  addScopeParam(p, view);
  // The storage location filter stands in the same bar and thus belongs to the same promise. It only exists
  // for gallery and parts (LAGER_VIEWS in account-filter.js); for 'minifigs' addLagerParam appends nothing, and
  // that is why getManualMinifigs does not know it either.
  addLagerParam(p, view);
  const q = G(searchId)?.value?.trim();
  if (q) p.set('search', q);
  const s = p.toString();
  return s ? '?' + s : '';
}

/**
 * The manually captured items as a table: the view switch stands above both lists and must apply to
 * both. One function for parts and figures, so that the two tables do not drift apart.
 * @param {(ManuellesTeil | ManuelleFigur)[]} posten  the entries from the respective cache.
 * @param {'part'|'fig'} art
 */
export function manualTable(posten, art) {
  const isPart = art === 'part';
  const kopf = [
    t('col.image_th'),
    isPart ? t('col.part_nr') : t('col.number'),
    t('col.name'),
    ...(isPart ? [t('col.color')] : []),
    t('detail.qty'),
    t('common.condition'),
    t('detail.purchase_price'),
    t('detail.storage'),
    '',
  ];
  const zeile = (/** @type {ManuellesTeil | ManuelleFigur} */ p) => {
    const nummer = isPart ? p.part_number : p.fig_number;
    const blNumber = (isPart ? p.bl_part_number : p.bl_fig_number) || nummer;
    const name = isPart ? p.part_name : p.fig_name;
    const imgSrc = imgUrl(thumbUrl(p.image_local || p.image_url) || p.image_local || p.image_url || '', true);
    const preis = p.avg_purchase_price ?? p.unit_price ?? p.purchase_price;
    const loeschKlick = isPart ? 'deleteManualPartStop' : 'deleteManualFigStop';
    const loeschTitle = tRaw(isPart ? 'parts.delete.title' : 'figs.delete');
    // For the part the trash carries (number, color, owner), for the figure (number, owner) — the same
    // order as on the tiles.
    const loeschArgs = isPart
      ? `data-arg="${esc(nummer)}" data-arg2="${p.color_id || 0}" data-arg3="${p.user_id || ''}"`
      : `data-arg="${esc(nummer)}" data-arg2="${p.user_id || ''}"`;
    return html`<tr data-stil="cursor:pointer" data-click="openManDetail" data-arg="${art}" data-arg2="${nummer}" data-arg3="${isPart ? p.color_id || 0 : 0}">
      <td>${imgSrc ? bildTag({ src: imgSrc, alt: '', klasse: 'bild-klein', ph: isPart ? 'teil' : 'figur' }) : html`<span class="bild-ph bild-klein" aria-hidden="true">${placeholderContent(isPart ? 'teil' : 'figur')}</span>`}</td>
      <td>${rowsButton(
        { click: 'openManDetail', arg: art, arg2: String(nummer), arg3: isPart ? Number(p.color_id) || 0 : 0 },
        html`<span data-stil="font-family:var(--mono);font-size:var(--fs-1);color:var(--b600)" title="${nummer}">${blNumber}</span>`,
        tRaw('zeile.oeffnen', { name: name || nummer, nr: blNumber }),
      )}</td>
      <td data-stil="max-width:200px">${name || '—'}</td>
      ${isPart ? html`<td><div data-stil="display:flex;align-items:center;gap:5px">${p.color_hex ? html`<div class="color-dot" data-farbe="${escHex(p.color_hex, 'var(--s300)')}"></div>` : ''}${colorName(/** @type {string | null | undefined} */ (p.color_name))}</div></td>` : ''}
      <td><span data-stil="font-family:var(--mono);font-weight:600;color:var(--b700)">${p.quantity || 0}</span></td>
      <td>${condBadges(p)}</td>
      <td class="preis">${preis != null ? fmtN(preis, accountCurrency) : '—'}</td>
      <td data-stil="font-size:var(--fs-1);color:var(--mut)">${p.storage || ''}</td>
      <td><button class="delbtn" data-click="${loeschKlick}"${echt()} ${rawHtml(loeschArgs)} title="${loeschTitle}" aria-label="${loeschTitle}">${TRASH_ICON_SVG}</button>${ownerBadges(p)}</td>
    </tr>`;
  };
  return html`<div class="tw"><table class="dt" aria-label="${tRaw(isPart ? 'parts.manual_section' : 'finance.figs_section')}" data-stil="font-size:var(--fs-2)"><thead><tr>${kopf.map(h => html`<th>${rawHtml(h)}</th>`)}</tr></thead><tbody>${joinHtml(posten.map(zeile))}</tbody></table></div>`;
}

/**
 * Is the tab's switch set to "table"?
 * @param {string} id
 */
export function tablesView(id) {
  return G(id)?.value === 'table' && !telefonBreite();
}

subscribe('bestandGeaendert', () => {
  loadMinifigs();
  loadManualFigsTable();
});

// ── Register handlers with the dispatcher (see js/registry.js) ─────────────
registerActions({
  loadMinifigs,
  deleteManualFig,
  filterFigs,
  importFigsCsv,
});
