import { registerActions } from './00-registry.js';
import { colorName, locale, t, tRaw} from '../i18n.js';
import { CURRENCY, G, TRASH_ICON_SVG, api, esc, escUrl, fmtN, fullUrl, imgUrl, thumbUrl, toast } from './01-core.js';
import { addScopeParam, scopeQuery } from './14-scope.js';
import { condBadges, ownerBadges, selectedOwner, PARTS_ICON_SVG } from './02-gallery.js';
import { loadFinance } from './04-finance.js';
import { confirmDelete } from './07-admin.js';
import { openManDetail } from './13-acquisition-modals.js';
import { deleteManualFigStop, deleteManualPartStop } from './11-actions.js';

// ═══ Minifiguren + manuelle Teile (Erfassung, Bewertung) ═══
// Teil von app.js — die Dateien in public/js/ werden in nummerierter
// Reihenfolge geladen und teilen sich den globalen Scope (kein Modul-
// System noetig, Inline-onclick-Handler in index.html funktionieren
// unveraendert). Der Split ist rein sequenziell und verhaelt sich
// identisch zur frueheren Einzeldatei.

// ── MINIFIGUREN ──────────────────────────────────────────────────────────────
export let allFigsCache = [];

// ── Endlos-Scroll der Minifiguren ──────────────────────────────────────────
// Wie in Galerie, Katalog und Teileansicht. Suche und Quellenfilter gehen an
// den Server: Clientseitig über allFigsCache zu filtern würde mit seitenweisem
// Laden nur die geladene Seite durchsuchen.
const FIG_PAGE_SIZE = 60;
let _figGen = 0, _figPage = 1, _figDone = false, _figLoadingMore = false, _figTotal = 0;

function figParams(page) {
  const p = new URLSearchParams();
  p.set('page', page);
  p.set('page_size', FIG_PAGE_SIZE);
  // Manuell erfasste Figuren haben oben eine eigene Sektion. Der Ausschluss
  // gehört auf den Server — clientseitig gefiltert könnte eine ganze Seite
  // wegfallen und die Liste bliebe scheinbar leer.
  p.set('source', G('fig-source')?.value || 'set');
  const q = G('fig-search')?.value?.trim();
  if (q) p.set('search', q);
  addScopeParam(p, 'minifigs');
  return p.toString();
}

async function loadMinifigsMore() {
  if (_figLoadingMore || _figDone) return;
  _figLoadingMore = true;
  const gen = _figGen;
  try {
    const d = await api('GET', `/v1/minifigs?${figParams(_figPage + 1)}`);
    if (gen !== _figGen) return;
    const batch = d.figs || [];
    if (!batch.length) { _figDone = true; return; }
    _figPage++;
    allFigsCache = allFigsCache.concat(batch);
    if (allFigsCache.length >= (_figTotal || 0)) _figDone = true;
    appendFigs(batch);
  } catch (_) { /* stumm — der Sentinel versucht es beim nächsten Scrollen */ }
  finally { if (gen === _figGen) _figLoadingMore = false; }
}

function maybeLoadMoreFigs() {
  if (!G('tab-minifigs')?.classList.contains('active')) return;
  loadMinifigsMore();
}

function bindFigsSentinel() {
  const sent = G('figs-sentinel');
  if (!sent || sent._bound) return;
  sent._bound = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) maybeLoadMoreFigs(); },
      { rootMargin: '600px' }).observe(sent);
  } else {
    window.addEventListener('scroll', () => {
      if (sent.getBoundingClientRect().top < window.innerHeight + 600) maybeLoadMoreFigs();
    }, { passive: true });
  }
}

export async function loadMinifigs() {
  _figGen++; _figPage = 1; _figDone = false; _figLoadingMore = false;
  const gen = _figGen;
  const d = await api('GET', `/v1/minifigs?${figParams(1)}`);
  if (!d.success || gen !== _figGen) return;
  allFigsCache = d.figs || [];
  _figTotal = d.total ?? allFigsCache.length;
  if (allFigsCache.length >= _figTotal) _figDone = true;
  bindFigsSentinel();
  requestAnimationFrame(maybeLoadMoreFigs);
  renderFigs(allFigsCache);
  loadManualFigsTable();

  // Stats
  // Kennzahlen MIT dem Filter des Reiters — vorher lief die Abfrage ohne ihn
  // und ohne Blickfeld: Im Haushalt zeigte die Kachel die eigenen Zahlen,
  // während die Liste darunter alle Konten zeigte, und Umschalten änderte oben
  // nichts. Gezählt wird jetzt serverseitig über dieselbe Gruppierung wie die
  // Liste (utils/handlers.ts, getMinifigStats).
  const s = await api('GET', '/v1/minifigs/stats'+scopeQuery('minifigs'));
  if (s.success) {
    G('mf-unique').textContent = s.stats.types;
    G('mf-total').textContent  = s.stats.total_quantity;
  }
  // Manual valuation — mit dem Filter des Minifiguren-Reiters, damit die
  // Wertangabe zur Liste darüber passt.
  const v = await api('GET', '/v1/finance/minifigs-valuation'+scopeQuery('minifigs'));
  if (v.success && parseFloat(v.total_value) > 0) {
    G('mf-val').textContent = fmtN(v.total_value, v.currency || CURRENCY);
  } else if (G('mf-val')) {
    G('mf-val').textContent = '—';
  }
}

/**
 * Suche und Quellenfilter liegen auf dem Server (getMinifigs kannte beide
 * schon). Hier wird deshalb neu GELADEN statt clientseitig gefiltert — sonst
 * durchsuchte der Filter nur die bereits geladene Seite.
 */
function filterFigs() { loadMinifigs(); }

/**
 * Hängt eine nachgeladene Seite an, statt die Liste neu zu bauen.
 *
 * Vorher rief jede Folgeseite renderFigs(allFigsCache) auf — die komplette
 * Liste wurde per innerHTML ersetzt. Damit verschwinden ALLE <img>-Elemente aus
 * dem DOM, und der Browser bricht ihre laufenden Anfragen ab. Im Server-Log
 * schlug das als Dutzende „Client hat abgebrochen" auf, und Kacheln, deren Bild
 * es nie über eine Nachladerunde hinaus schaffte, blieben leer.
 *
 * Die Galerie macht es seit ihrer Umstellung richtig (appendGallery); bei den
 * Minifiguren war es liegen geblieben.
 */
function appendFigs(batch) {
  const el = G('figs-list');
  // Die Seite losgelöst rendern, damit die bestehende Liste unangetastet bleibt.
  const tmp = document.createElement('div');
  renderFigs(batch, tmp);

  const tbody = el.querySelector('.dt tbody');
  const newRows = tmp.querySelectorAll('.dt tbody tr');
  if (tbody && newRows.length) {
    tbody.append(...newRows);
    return;
  }

  // Kachelansicht: an das letzte Raster anhängen, sonst neue Gruppen übernehmen.
  const lastGrid = [...el.querySelectorAll('.parts-grid, .man-grid, .figs-grid, .sgrid')].pop();
  const newTiles = tmp.querySelectorAll('.parts-grid > *, .man-grid > *, .figs-grid > *, .sgrid > *');
  if (lastGrid && newTiles.length) {
    lastGrid.append(...newTiles);
    return;
  }

  // Struktur passt nicht (z. B. vorher leerer Zustand) → einmalig neu bauen.
  renderFigs(allFigsCache);
}

/**
 * @param {Array} list
 * @param {HTMLElement} [target] Zielcontainer. Vorgabe ist #figs-list.
 *        Wird ein anderer übergeben, kann eine Seite losgelöst gerendert und
 *        anschliessend angehängt werden — siehe appendFigs().
 */
export function renderFigs(list, target) {
  const el = target || G('figs-list');
  if (!list.length) {
    el.innerHTML = `<div class="empty" style="padding:3rem;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:.5rem">👷</div>
      <div style="font-weight:600">${t('figs.none')}</div>
      <div style="color:var(--mut);font-size:.85rem">${t('figs.auto_hint')}</div>
    </div>`;
    return;
  }

  const viewMode = G('figs-view')?.value || 'grid';

  if (viewMode === 'table') {
    el.innerHTML = `<div class="tw"><table class="dt">
      <thead><tr>
        <th>${t('col.image')}</th><th>${t('col.number')}</th><th>Name</th><th>${t('detail.qty')}</th><th>${t('col.source')}</th><th>${t('detail.added')}</th><th></th>
      </tr></thead>
      <tbody>${list.map(f => {
        const imgSrc = imgUrl(thumbUrl(f.image_local || f.image_url) || f.image_local || f.image_url || '', true);
        const dateVal = f.set_added_at || null;
        const erfasst = dateVal ? new Date(dateVal).toLocaleDateString(locale()) : '—';
        const src = f.source==='manual'
          ? `<span style="background:var(--b50);color:var(--b600);border-radius:4px;padding:2px 6px;font-size:.72rem;font-weight:600">${t('figs.badge_manual')}</span>`
          : `<span style="background:var(--s100);color:var(--mut);border-radius:4px;padding:2px 6px;font-size:.72rem">${t('figs.badge_set')}</span>`;
        const delBtn = f.source==='manual' ? `<button class="btn bd btn-sm" data-click="deleteManualFig" data-arg="${esc(f.fig_number)}" title="${esc(t('figs.delete'))}" aria-label="${esc(t('figs.delete'))}">${TRASH_ICON_SVG}</button>` : '';
        return `<tr>
          <td>${imgSrc?`<img src="${escUrl(imgSrc)}" loading="lazy" decoding="async" data-onerror="hide" style="width:36px;height:36px;object-fit:contain;background:var(--s50);border-radius:5px" />`:'—'}</td>
          <td><span style="font-family:var(--mono);font-size:.77rem;color:var(--b600)">${esc(f.fig_number)}</span></td>
          <td style="max-width:200px">${esc(f.fig_name)||'—'}</td>
          <td><span style="font-family:var(--mono);font-weight:600;color:var(--b700)">${f.total_quantity||f.quantity}</span></td>
          <td>${src}</td>
          <td style="font-size:.75rem;color:var(--mut)">${erfasst}</td>
          <td>${delBtn}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
    return;
  }

  // Grid view: group by source (Set / Manuell)
  const groups = {};
  for (const f of list) {
    const key = f.source === 'manual' ? t('figs.group_manual') : t('figs.group_sets');
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }
  el.innerHTML = Object.entries(groups).map(([label, figs]) => `
    <div class="parts-group">
      <div class="group-hd">
        <span class="group-title">${label}</span>
        <span class="group-sub">${figs.length} ${t('parts.stat.types')}</span>
      </div>
      <div class="parts-grid">
        ${figs.map(f => {
          const imgSrc = imgUrl(thumbUrl(f.image_local || f.image_url) || f.image_local || f.image_url || '', true);
          const dateVal = f.set_added_at || null;
          const erfasst = dateVal ? new Date(dateVal).toLocaleDateString(locale()) : '';
          // Gleiches Muster wie Set- und Teile-Kacheln: .ca + .delbtn, sichtbar
          // beim Überfahren. Vorher ein dauerhaft sichtbarer roter Knopf (btn bd)
          // in abweichender Grösse — dieselbe Aktion sah in jeder Tabelle anders aus.
          const delBtn = f.source==='manual' ? `<div class="ca"><button class="delbtn" data-click="deleteManualFigStop" data-arg="${esc(f.fig_number)}" title="${esc(t('figs.delete'))}" aria-label="${esc(t('figs.delete'))}">${TRASH_ICON_SVG}</button></div>` : '';
          // Zustand nur bei manuell erfassten Minifiguren anzeigen (automatisch
          // hinzugefügte aus Sets haben keinen eigenen Zustand).
          // Eine Plakette je erfasstem Zustand — gemeinsame Fassung in
          // 02-gallery.js. Die frühere Inline-Fassung hier trug dieselben
          // Farben noch einmal von Hand ein.
          const condBadge = f.source==='manual'
            ? `<div style="display:flex;gap:3px;justify-content:center;flex-wrap:wrap;margin-top:3px">${condBadges(f)}${ownerBadges(f)}</div>`
            : '';
          return `<div class="part-card" style="position:relative">
            ${delBtn}
            ${imgSrc ? `<img src="${escUrl(imgSrc)}" class="part-img" loading="lazy" decoding="async" data-fade="1" data-orig="${escUrl(fullUrl(imgSrc))}" />` : ''}
            <div class="part-img-ph" style="display:${imgSrc?'none':'flex'}">👷</div>
            <div class="part-num">${esc(f.fig_number)}</div>
            <div class="part-name">${esc(f.fig_name)||'—'}</div>
            <div class="part-qty">${f.total_quantity||f.quantity}×</div>
            ${condBadge}
            ${erfasst ? `<div style="font-size:.65rem;color:var(--mut)">${erfasst}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

export async function deleteManualFig(figNumber) {
  if (!await confirmDelete(tRaw('figs.delete.title'), t('gallery.delete.text',{name:figNumber}), '👷')) return false;
  const d = await api('DELETE', `/v1/minifigs/${encodeURIComponent(figNumber)}`);
  if (d.success) { toast(tRaw('figs.deleted'), 'success'); loadMinifigs(); loadManualFigsTable(); return true; }
  else { toast(d.error || t('settings.error'), 'error'); return false; }
}

export let manualFigsCache = [];
export async function loadManualFigsTable() {
  const d = await api('GET', '/v1/minifigs/manual'+scopeQuery('minifigs'));
  if (!d.success) return;
  manualFigsCache = d.figs || [];
  renderManualFigsTable();
}

function renderManualFigsTable() {
  const el = G('manual-figs-list');
  if (!el) return;
  if (!manualFigsCache.length) {
    el.innerHTML = `<div class="empty" style="padding:2rem;text-align:center">
      <div style="font-size:2rem;margin-bottom:.4rem">👷</div>
      <div style="font-weight:600">${t('figs.none_manual')}</div>
      <div style="color:var(--mut);font-size:.85rem">${t('figs.from_csv_hint')}</div>
    </div>`;
    return;
  }
  el.innerHTML = `<div class="man-grid">
    ${manualFigsCache.map(f => {
      const imgSrc = imgUrl(thumbUrl(f.image_local || f.image_url) || f.image_local || f.image_url || '', true);
      const img = imgSrc
        ? `<img class="man-tile-img" src="${escUrl(imgSrc)}" loading="lazy" decoding="async" data-onerror="hide" />`
        : `<div class="man-tile-img-ph">👷</div>`;
      // Mengengewichteter Kaufpreis über die Erfassungen (Server rechnet ihn).
      // unit_price ist der zuletzt geschriebene Einzelwert der Stammzeile —
      // bei zwei Erfassungen zu verschiedenen Preisen stimmte er nicht.
      const figPrice = f.avg_purchase_price ?? f.unit_price ?? f.purchase_price;
      const priceStr = figPrice!=null ? fmtN(figPrice, CURRENCY) : '—';
      const condBadge = condBadges(f);
      return `<div class="man-tile" data-click="openManDetail" data-arg="fig" data-arg2="${esc(f.fig_number)}" data-arg3="0" style="cursor:pointer">
        <div class="ca"><button class="delbtn" data-click="deleteManualFigStop" data-arg="${esc(f.fig_number)}" title="${esc(t('figs.delete'))}" aria-label="${esc(t('figs.delete'))}">${TRASH_ICON_SVG}</button></div>
        ${img}
        <div class="man-tile-num">${esc(f.fig_number)}</div>
        <div class="man-tile-name">${esc(f.fig_name) || '—'}</div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:2px">
          <span class="qbadge">×${f.quantity}</span>${condBadge}${ownerBadges(f)}
        </div>
        <div style="font-weight:700;font-size:.82rem;color:var(--b600);margin-top:3px">${priceStr}</div>
        ${f.note ? `<div class="man-tile-note">${esc(f.note)}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

export async function updateManualFig(figNumber, body) {
  const d = await api('PUT', `/v1/minifigs/${encodeURIComponent(figNumber)}`, body);
  if (d.success) { toast(tRaw('settings.saved'),'success'); loadManualFigsTable(); loadMinifigs(); if(document.querySelector('.ntab.active')?.dataset?.tab==='finance') loadFinance(); }
  else toast(d.error||t('settings.error'),'error');
}

G('btn-add-fig')?.addEventListener('click', async () => {
  const num = G('af-num-inline')?.value.trim();
  const res = G('af-inline-result');
  if(!num){ res.style.color='var(--r500)'; res.textContent=tRaw('figs.number_required'); return; }
  const btn = G('btn-add-fig'); btn.disabled=true; btn.textContent='…';
  res.style.color='var(--mut)'; res.textContent=tRaw('adding.progress');
  const d = await api('POST','/v1/minifigs',{
    fig_number: num,
    bl_fig_number: G('af-blnum-inline')?.value.trim()||null,
    quantity:   parseInt(G('af-qty-inline')?.value)||1,
    unit_price: (v => { const n = parseFloat(v); return String(v).trim() !== '' && !isNaN(n) ? n : null; })(G('af-price-inline')?.value ?? ''),
    condition: G('af-condition')?.value || 'N',
    owner_user_id: selectedOwner('af-owner'),
  });
  btn.disabled=false; btn.textContent=tRaw('adding.button');
  if(d.success){
    res.style.color='var(--g700)'; res.textContent=`✅ ${esc(d.fig_number)} ${d.action==='added'?t('common.added'):t('common.updated')}`;
    G('af-num-inline').value=''; G('af-blnum-inline').value=''; G('af-qty-inline').value='1'; G('af-price-inline').value='';
    loadMinifigs();
    setTimeout(()=>{ res.textContent=''; },3000);
  } else { res.style.color='var(--r500)'; res.textContent=d.error||t('settings.error'); }
});

// Persistente Status-/Hinweiszeile für den CSV-Import (Teile & Minifiguren)
function csvImportStatus(elId, state, msg) {
  const el = G(elId);
  if (!el) return;
  if (state === 'hide') { el.style.display = 'none'; el.textContent = ''; return; }
  const styles = {
    running: 'background:var(--b100);color:var(--b600)',
    success: 'background:var(--g100);color:var(--g600)',
    warn:    'background:var(--s100);color:var(--s600)',
    error:   'background:var(--r100);color:var(--r500)',
  };
  el.style.cssText = `display:block;font-size:.85rem;margin-bottom:1rem;padding:.55rem .8rem;border-radius:8px;font-weight:600;${styles[state] || styles.running}`;
  el.textContent = msg;
}

async function importFigsCsv() {
  const fi = G('fig-csv-file');
  if (!fi.files[0]) return;
  const fd = new FormData(); fd.append('file', fi.files[0]);
  csvImportStatus('fig-csv-status', 'running', t('import.running'));
  try {
    const r = await fetch('/api/minifigs/import/csv', { method: 'POST', body: fd });
    const d = await r.json();
    fi.value = '';
    if (d.success) {
      const summary = t('import.summary', { added: d.added, updated: d.updated, errors: d.errors });
      // Übersprungene Zeilen anhängen — sonst sieht ein Import mit stillen
      // Lücken aus wie ein vollständiger.
      toast(summary + (d.skipped_hint ? ` — ${d.skipped_hint}` : ''),
        (d.errors || d.skipped) ? 'info' : 'success');
      loadMinifigs();
    } else {
      toast(d.error || t('settings.error'), 'error');
    }
    csvImportStatus('fig-csv-status', 'hide');
  } catch (e) {
    fi.value = '';
    csvImportStatus('fig-csv-status', 'hide');
    toast(tRaw('settings.error'), 'error');
  }
}

G('btn-fig-csv-template').onclick = (e) => {
  e.preventDefault();
  const csv = 'fig_number,bl_fig_number,quantity,unit_price,note,condition,acquired_at\nfig-007357,sw0001,1,12.50,Luke Skywalker,N,2024-01-15\nfig-009314,,2,,,U,\n';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'minifigs-template.csv';
  a.click();
};

async function loadMinifigsValuation() {
  // Dieser Banner steht im FINANZEN-Reiter — also dessen Filter.
  const v = await api('GET', '/v1/finance/minifigs-valuation'+scopeQuery('finance'));
  const banner = G('fin-figs-banner');
  const valEl  = G('fin-figs-val');
  if (!v.success || !v.figs?.length || parseFloat(v.total_value) === 0) {
    if (banner) banner.style.display = 'none';
    return;
  }
  if (banner && valEl) {
    banner.style.display = 'flex';
    valEl.textContent = fmtN(v.total_value, v.currency || CURRENCY);
  }
}

// ── MANUAL PARTS ─────────────────────────────────────────────────────────────
export let manualPartsCache = [];

export async function loadManualParts() {
  const [d, v] = await Promise.all([
    api('GET', '/v1/parts/manual'+scopeQuery('parts')),
    // Derselbe Filter wie die Liste darüber: Sonst stünden Zähler und Menge
    // aus dem einen Blickfeld neben einer Summe aus einem anderen.
    api('GET', '/v1/finance/parts-valuation'+scopeQuery('parts')),
  ]);
  if (!d.success) return;
  manualPartsCache = d.parts || [];
  renderManualParts();
  if (v.success) {
    if(G('mp-count')) G('mp-count').textContent = d.parts.length;
    if(G('mp-qty'))   G('mp-qty').textContent   = d.parts.reduce((s,p) => s + (p.quantity||0), 0);
    if(G('mp-val'))   G('mp-val').textContent   = fmtN(v.total_value, v.currency || CURRENCY);
  }
}

function renderManualParts() {
  const el = G('manual-parts-list');
  if (!manualPartsCache.length) {
    el.innerHTML = `<div class="empty" style="padding:3rem;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:.5rem;display:flex;justify-content:center">${PARTS_ICON_SVG.replace('style="width:1em;height:1em;vertical-align:middle"','style="width:1.2em;height:1.2em"')}</div>
      <div style="font-weight:600">${t('parts.none_manual')}</div>
      <div style="color:var(--mut);font-size:.85rem">${t('parts.none_manual_hint')}</div>
    </div>`;
    return;
  }
  el.innerHTML = `<div class="man-grid">
    ${manualPartsCache.map(p => {
      // War: p.image_local || p.image_url roh, ohne Vorschau und ohne Proxy —
      // einzige Stelle im ganzen Projekt, die das CDN-Bild direkt und in
      // voller Auflösung in eine Kachel geladen hat. Jetzt wie überall sonst:
      // Vorschau über den Server-Proxy.
      const imgSrc = imgUrl(thumbUrl(p.image_local || p.image_url) || p.image_local || p.image_url || '', true);
      const img = imgSrc
        ? `<img class="man-tile-img" src="${escUrl(imgSrc)}" loading="lazy" decoding="async" data-onerror="hide" />`
        : `<div class="man-tile-img-ph">${PARTS_ICON_SVG.replace('style="width:1em;height:1em;vertical-align:middle"','style="width:1.6em;height:1.6em"')}</div>`;
      const colorRow = p.color_name
        ? `<div class="man-tile-color">${p.color_hex ? `<span class="man-tile-swatch" style="background:#${p.color_hex}"></span>` : ''}${esc(colorName(p.color_name))}</div>`
        : '';
      // Wie bei den Minifiguren: mengengewichtet über die Erfassungen.
      const partPrice = p.avg_purchase_price ?? p.unit_price ?? p.purchase_price;
      const priceStr = partPrice!=null ? fmtN(partPrice, CURRENCY) : '—';
      const condBadge = condBadges(p);
      return `<div class="man-tile" data-click="openManDetail" data-arg="part" data-arg2="${esc(p.part_number)}" data-arg3="${p.color_id||0}" style="cursor:pointer">
        <div class="ca"><button class="delbtn" data-click="deleteManualPartStop" data-arg="${esc(p.part_number)}" data-arg2="${p.color_id||0}" title="${esc(t('parts.delete.title'))}" aria-label="${esc(t('parts.delete.title'))}">${TRASH_ICON_SVG}</button></div>
        ${img}
        <div class="man-tile-num" title="${esc(p.part_number)}">${esc(p.bl_part_number||p.part_number)}</div>
        <div class="man-tile-name">${esc(p.part_name) || '—'}</div>
        ${colorRow}
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:2px">
          <span class="qbadge">×${p.quantity}</span>${condBadge}${ownerBadges(p)}
        </div>
        <div style="font-weight:700;font-size:.82rem;color:var(--b600);margin-top:3px">${priceStr}</div>
        ${p.note ? `<div class="man-tile-note">${esc(p.note)}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

export async function updateManualPart(partNumber, colorId, body) {
  const d = await api('PUT', `/v1/parts/${encodeURIComponent(partNumber)}/${colorId}`, body);
  if (d.success) { toast(tRaw('settings.saved'),'success'); loadManualParts(); if(document.querySelector('.ntab.active')?.dataset?.tab==='finance') loadFinance(); }
  else toast(d.error||t('settings.error'),'error');
}

export async function deleteManualPart(partNumber, colorId) {
  if (!await confirmDelete(tRaw('parts.delete.title'), t('gallery.delete.text',{name:partNumber}), '🔩')) return false;
  const d = await api('DELETE', `/v1/parts/${encodeURIComponent(partNumber)}/${colorId}`);
  if (d.success) { toast(tRaw('parts.deleted'), 'success'); loadManualParts(); return true; }
  else { toast(d.error || t('settings.error'), 'error'); return false; }
}

// Inline add-part form (zuoberst im Teile-Tab)
let _brickColors = [];
export async function loadBrickColors(){
  if(_brickColors.length) return _brickColors;
  const d = await api('GET','/v1/parts/brick-colors');
  if(d.success){ _brickColors=d.colors; renderColorDropdown(); }
  return _brickColors;
}
function updateColorDot(){
  const sel = G('ap-color-select');
  const dot = G('ap-color-dot');
  if(!sel||!dot) return;
  const hex = sel.options[sel.selectedIndex]?.dataset.hex;
  dot.style.background = hex ? '#'+hex : 'var(--s200)';
}

function renderColorDropdown(){
  const sel = G('ap-color-select'); if(!sel) return;
  // data-name bleibt der englische Rebrickable-Name — er wird beim Speichern
  // als parts.color_name übernommen und für BrickLink-Abgleiche gebraucht.
  // Übersetzt wird nur der sichtbare Text, mit derselben Funktion wie die
  // Farbanzeige und der Filter im Teile-Reiter.
  sel.innerHTML = `<option value="">${t('parts.no_color_dash')}</option>`
    + _brickColors.map(c=>`<option value="${c.id}" data-name="${esc((c.name||'').replace(/"/g,'&quot;'))}" data-hex="${c.hex||''}">${esc(colorName(c.name))}</option>`).join('');
}

G('btn-add-part')?.addEventListener('click', async () => {
  const num = G('ap-num-inline')?.value.trim();
  const res = G('ap-inline-result');
  res.style.color = 'var(--r500)';
  if(!num){ res.textContent=tRaw('parts.number_required'); return; }
  const colorSel = G('ap-color-select');
  // "Keine Farbe" ist NICHT 0.
  //
  // Der Ausdruck lautete `parseInt(colorSel.value) || 0` — die leere Auswahl
  // ergab damit 0, und 0 ist bei Rebrickable die Farb-ID von SCHWARZ. Beide
  // Fälle kamen also als 0 am Server an, und der übersprang daraufhin die
  // Suche nach dem farbigen Teilebild (`if (colorId && colorId !== 0)`).
  // Ergebnis: Ein schwarz erfasstes Teil bekam das allgemeine, meist weisse
  // Bild — sichtbar beim Vergleich mit demselben Teil aus einem Set.
  //
  // null statt 0 für "keine Farbe": Der Server erkennt daran den Unterschied
  // und legt weiterhin 0 in der Datenbank ab (Spaltenvorgabe), sucht das
  // Farbbild aber nur, wenn wirklich eine Farbe gewählt wurde.
  const rawColor = colorSel?.value ?? '';
  const colorId  = String(rawColor).trim() === '' ? null : (parseInt(rawColor) || 0);
  const colorOpt  = colorSel?.options[colorSel.selectedIndex];
  const colorName = colorOpt?.dataset.name || null;
  const colorHex  = colorOpt?.dataset.hex  || null;
  const btn = G('btn-add-part'); btn.disabled=true; btn.textContent='…';
  res.style.color='var(--mut)'; res.textContent=tRaw('adding.progress');
  const d = await api('POST','/v1/parts',{
    part_number: num, color_id: colorId, color_name: colorName, color_hex: colorHex,
    quantity: parseInt(G('ap-qty-inline')?.value)||1,
    unit_price: (v => { const n = parseFloat(v); return String(v).trim() !== '' && !isNaN(n) ? n : null; })(G('ap-price-inline')?.value ?? ''),
    note: G('ap-note-inline')?.value||null,
    condition: G('ap-condition')?.value || 'N',
    owner_user_id: selectedOwner('ap-owner'),
  });
  btn.disabled=false; btn.textContent=tRaw('adding.button');
  if(d.success){
    res.style.color='var(--g700)'; res.textContent=`✅ ${esc(d.part_number)} ${d.action==='added'?t('common.added'):t('common.updated')}`;
    G('ap-num-inline').value=''; G('ap-qty-inline').value='1'; G('ap-price-inline').value=''; G('ap-note-inline').value='';
    if(colorSel) colorSel.selectedIndex=0;
    loadManualParts();
    setTimeout(()=>{ res.textContent=''; },3000);
  } else { res.style.color='var(--r500)'; res.textContent=d.error||t('settings.error'); }
});

// CSV import
async function importPartsCsv() {
  const fi = G('part-csv-file');
  if (!fi.files[0]) return;
  const fd = new FormData(); fd.append('file', fi.files[0]);
  csvImportStatus('part-csv-status', 'running', t('import.running'));
  try {
    const r = await fetch('/api/parts/import/csv', { method: 'POST', body: fd });
    const d = await r.json();
    fi.value = '';
    if (d.success) {
      const summary = t('import.summary', { added: d.added, updated: d.updated, errors: d.errors });
      // Übersprungene Zeilen anhängen — sonst sieht ein Import mit stillen
      // Lücken aus wie ein vollständiger.
      toast(summary + (d.skipped_hint ? ` — ${d.skipped_hint}` : ''),
        (d.errors || d.skipped) ? 'info' : 'success');
      loadManualParts();
    } else {
      toast(d.error || t('settings.error'), 'error');
    }
    csvImportStatus('part-csv-status', 'hide');
  } catch (e) {
    fi.value = '';
    csvImportStatus('part-csv-status', 'hide');
    toast(tRaw('settings.error'), 'error');
  }
}

// CSV template download
G('btn-set-csv-template').onclick = (e) => {
  e.preventDefault();
  const csv = 'set_number,quantity,purchase_price,condition,acquired_at\n60098-1,1,49.99,N,2024-01-15\n75192-1,2,,U,\n10497-1,1,,,\n';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'sets-template.csv';
  a.click();
};

G('btn-csv-template').onclick = (e) => {
  e.preventDefault();
  const csv = 'part_number,quantity,color_id,color_name,unit_price,note,condition,acquired_at\n3001,5,4,Red,,Spare parts,N,2024-01-15\n3003,2,0,White,0.15,,U,\n';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'parts-template.csv';
  a.click();
};

// Parts valuation for finance tab
async function loadPartsValuation() {
  // Steht im FINANZEN-Reiter — also dessen Filter, nicht der des Teile-Reiters.
  const v = await api('GET', '/v1/finance/parts-valuation'+scopeQuery('finance'));
  if (!v.success || !v.parts?.length) {
    const b = G('fin-parts-banner'); if(b) b.style.display='none';
    return;
  }
  const banner = G('fin-parts-banner');
  const valEl  = G('fin-parts-val');
  if (banner && valEl) {
    banner.style.display = 'flex';
    valEl.textContent = fmtN(v.total_value, v.currency || CURRENCY);
  }
}



// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  deleteManualFig,
  filterFigs,
  importFigsCsv,
  importPartsCsv,
  updateColorDot,
});
