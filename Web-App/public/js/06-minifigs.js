// Der Reiter Minifiguren: Figuren aus Sets und manuell erfasste Figuren, dazu die gemeinsamen Hilfen für
// manuelle Tabellen und CSV-Status.
import { abonniere } from './00-ereignisse.js';
import { echt, registerActions } from './00-registry.js';
import { listeLadefehler, condBadges, ownerBadges, schliesseErfassen, csvHochladen, zeilenKnopf } from './01-bausteine.js';
import { colorName, t, tRaw } from '../i18n.js';
import { escHex, esc, html, ungeprueft } from './00-escapen.js';
import { api } from './01-api.js';
import { bildTag, platzhalterInhalt, fullUrl, imgUrl, thumbUrl } from './01-bilder.js';
import { leerZustand, meldeTreffer, G, TRASH_ICON_SVG, zuruecksetzenKnopf, aktiverReiter, ico, setzeHtml } from './01-dom.js';
import { fmtDatum, fmtN } from './01-format.js';
import { betragAusFeld, mengeAusFeld, kaufdatumGueltig } from './01-formular.js';
import { toast } from './01-meldungen.js';
import { addLagerParam, addScopeParam, scopeQuery } from './14-scope.js';
import { loadFinance } from './04-finance.js';
import { geloeschtMitRueckgaengig } from './20-papierkorb.js';
import { CURRENCY } from './00-zustand.js';
import { leereLagerortFeld, selectedOwner, selectedStorage } from './02-konten-orte.js';
import { confirmDelete } from './01-rueckfrage.js';

// ── MINIFIGUREN ──────────────────────────────────────────────────────────────
/**
 * @typedef {import('../../frontend-typen/vertrag').GET_api_v1_minifigs['figs'][number]} Figur
 * @typedef {import('../../frontend-typen/vertrag').ManualFigsResponse['figs'][number]} ManuelleFigur
 */
/** @type {Figur[]} */
let allFigsCache = [];
/** Die zuletzt geladenen Figuren aus Sets (nur lesen). */
export function alleFiguren() { return allFigsCache; }

// ── Endlos-Scroll der Minifiguren ──────────────────────────────────────────
// Wie in Galerie, Katalog und Teileansicht. Suche und Quellenfilter gehen an den Server: Clientseitig über
// allFigsCache zu filtern würde mit seitenweisem Laden nur die geladene Seite durchsuchen.
const FIG_PAGE_SIZE = 60;
let _figGen = 0, _figPage = 1, _figDone = false, _figLoadingMore = false, _figTotal = 0;

/** @param {number} page */
function figParams(page) {
  const p = new URLSearchParams();
  p.set('page', String(page));
  p.set('page_size', String(FIG_PAGE_SIZE));
  // Fest 'set': Manuell erfasste Figuren haben oben eine eigene Sektion. Der Ausschluss gehört auf den Server
  // — clientseitig gefiltert könnte eine ganze Seite wegfallen und die Liste bliebe scheinbar leer.
  // Ausführlich: docs/begruendungen/public/js/06-minifigs.js.md#manuell-erfasste-figuren-haben-oben-eine
  p.set('source', 'set');
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
  if (typeof IntersectionObserver === 'function') {
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
  if (gen !== _figGen) return;
  if (listeLadefehler(G('figs-list'), d, { erneut: 'loadMinifigs', behalten: allFigsCache.length > 0 })) return;
  allFigsCache = d.figs || [];
  _figTotal = d.total ?? allFigsCache.length;
  if (allFigsCache.length >= _figTotal) _figDone = true;
  bindFigsSentinel();
  requestAnimationFrame(maybeLoadMoreFigs);
  renderFigs(allFigsCache);
  loadManualFigsTable();

  // Kennzahlen mit dem Filter des Reiters: Sonst zeigte die Kachel im Haushalt die eigenen Zahlen, während
  // die Liste darunter alle Konten zeigte.
  // Ausführlich: docs/begruendungen/public/js/06-minifigs.js.md#kennzahlen-mit-dem-filter-des
  const s = await api('GET', `/v1/minifigs/stats${scopeQuery('minifigs')}`);
  if (s.success) {
    G('mf-unique').textContent = String(s.stats.types);
    G('mf-total').textContent  = String(s.stats.total_quantity);
  }
  // Manual valuation — mit dem Filter des Minifiguren-Reiters, damit die Wertangabe zur Liste darüber passt.
  const v = await api('GET', `/v1/finance/minifigs-valuation${scopeQuery('minifigs')}`);
  if (v.success && parseFloat(v.total_value) > 0) {
    G('mf-val').textContent = fmtN(v.total_value, v.currency || CURRENCY);
  } else if (G('mf-val')) {
    G('mf-val').textContent = '—';
  }
}

/**
 * Suche und Quelle filtert der Server; hier wird neu geladen, sonst durchsuchte der Filter nur die geladene
 * Seite. Beide Listen, weil die manuellen Figuren unter derselben Filterleiste stehen.
 * Ausführlich: docs/begruendungen/public/js/06-minifigs.js.md#filterfigs
 */
function filterFigs() { loadMinifigs(); loadManualFigsTable(); }

/**
 * Hängt eine nachgeladene Seite an, statt die Liste neu zu bauen: Ein Ersetzen per innerHTML brach die
 * laufenden Bildanfragen ab, und Kacheln, deren Bild nie über eine Runde hinauskam, blieben leer.
 * Ausführlich: docs/begruendungen/public/js/06-minifigs.js.md#appendfigs
 */
/** @param {Figur[]} batch */
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
 * @param {(Figur | ManuelleFigur)[]} list
 * @param {HTMLElement} [target] Zielcontainer. Vorgabe ist #figs-list.
 *        Wird ein anderer übergeben, kann eine Seite losgelöst gerendert und
 *        anschliessend angehängt werden — siehe appendFigs().
 */
export function renderFigs(list, target) {
  const el = target || G('figs-list');
  if (!target) _setFigurenLeer = !list.length;
  if (!target && list.length && G('fig-search')?.value.trim()) meldeTreffer(tRaw('treffer.eintraege', { n: list.length }));
  if (!list.length) {
    if (target) el.replaceChildren();
    else figurenLeerAbgleichen();
    return;
  }
  if (!target) figurenLeerAbgleichen();

  const viewMode = G('figs-view')?.value || 'grid';

  if (viewMode === 'table') {
    // Ohne „Quelle“ und Papierkorb: Diese Liste lädt nur source=set, beide Spalten wären in jeder Zeile
    // gleich bzw. leer. Manuelle Figuren haben ihren eigenen Bereich mit editierbaren Karten.
    // Ausführlich: docs/begruendungen/public/js/06-minifigs.js.md#ohne-die-spalten-quelle-und-papierkorb
    setzeHtml(el, html`<div class="tw"><table class="dt" aria-label="${tRaw('nav.minifigs')}">
      <thead><tr>
        <th>${tRaw('col.image')}</th><th>${tRaw('col.number')}</th><th>${tRaw('col.name')}</th><th>${tRaw('detail.qty')}</th><th>${tRaw('detail.created')}</th>
      </tr></thead>
      <tbody>${list.map(f => {
        const imgSrc = imgUrl(thumbUrl(f.image_local || f.image_url) || f.image_local || f.image_url || '', true);
        const dateVal = /** @type {string | null} */ (f.set_added_at || null);
        const erfasst = dateVal ? fmtDatum(dateVal) : '—';
        // Anklickbar wie die Kachel darunter — dieselbe Handlung in beiden Ansichten (Marcos Detail-Dialog
        // fuer automatisch erfasste Figuren).
        return html`<tr data-stil="cursor:pointer" data-click="${f.source==='manual' ? 'openManDetail' : 'openSetItemDetail'}" data-arg="fig" data-arg2="${f.fig_number}" data-arg3="0">
          <td>${imgSrc ? bildTag({ src: imgSrc, alt: '', klasse: 'bild-klein', ph: 'figur' }) : html`<span class="bild-ph bild-klein" aria-hidden="true">${platzhalterInhalt('figur')}</span>`}</td>
          <td>${zeilenKnopf({ click: f.source==='manual' ? 'openManDetail' : 'openSetItemDetail', arg: 'fig', arg2: f.fig_number, arg3: 0 },
            html`<span data-stil="font-family:var(--mono);font-size:var(--fs-1);color:var(--b600)">${f.fig_number}</span>`,
            tRaw('zeile.oeffnen', { name: f.fig_name || f.fig_number, nr: f.fig_number }))}</td>
          <td data-stil="max-width:200px">${f.fig_name || '—'}</td>
          <td><span data-stil="font-family:var(--mono);font-weight:600;color:var(--b700)">${f.total_quantity || f.quantity}</span></td>
          <td data-stil="font-size:var(--fs-1);color:var(--mut)">${ungeprueft(erfasst)}</td>
        </tr>`;
      })}</tbody></table></div>`);
    return;
  }

  // Grid view: group by source (Set / Manuell)
  /** @type {Record<string, (Figur | ManuelleFigur)[]>} */
  const groups = {};
  for (const f of list) {
    const key = f.source === 'manual' ? tRaw('figs.group_manual') : tRaw('figs.group_sets');
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }
  setzeHtml(el, Object.entries(groups).map(([label, figs]) => html`
    <div class="parts-group">
      <div class="group-hd">
        ${ico('set')}<span class="group-title">${ungeprueft(label)}</span>
        <span class="group-sub">${tRaw('parts.group_types', { n: figs.length })}</span>
      </div>
      <div class="parts-grid">
        ${figs.map(f => {
          const imgSrc = imgUrl(thumbUrl(f.image_local || f.image_url) || f.image_local || f.image_url || '', true);
          const dateVal = /** @type {string | null} */ (f.set_added_at || null);
          const erfasst = dateVal ? fmtDatum(dateVal) : '';
          // Papierkorb oben rechts, wie auf der Set-Kachel: .ca setzt top:6px;right:6px und blendet ihn beim
          // Ueberfahren ein (styles.css). Marcos Vorgabe vom 24.09., zweiter Teil: „analog den Kacheln bei
          // den Sets. Dies aber nur in der webapp."
          const delBtn = f.source==='manual' ? `<div class="ca"><span class="delbtn" data-click="deleteManualFigStop"${echt()} aria-hidden="true" data-arg="${esc(f.fig_number)}" data-arg2="${f.user_id||''}" title="${esc(tRaw('figs.delete'))}">${TRASH_ICON_SVG}</span></div>` : '';
          // Zustand nur bei manuell erfassten Figuren — aus Sets haben sie keinen eigenen. Die
          // Besitzer-Plakette dagegen immer: „Wem gehört das?“ stellt sich bei der Figur aus dem Set eines
          // Kindes genauso.
          // Ausführlich: docs/begruendungen/public/js/06-minifigs.js.md#condbadge
          const condBadge = f.source==='manual'
            ? `<div data-stil="display:flex;gap:3px;justify-content:center;flex-wrap:wrap;margin-top:3px">${condBadges(f)}</div>`
            : '';
          const besitzer = ownerBadges(f)
            ? `<div data-stil="display:flex;gap:3px;justify-content:center;flex-wrap:wrap;margin-top:3px">${ownerBadges(f)}</div>`
            : '';
          // Manuell erfasste Figuren haben ihren eigenen Dialog (Kaufpreise, Menge aenderbar); die aus Sets
          // den neuen ohne Preis und ohne Mengenaenderung. Die Kachel entscheidet nach der Quelle, damit
          // BEIDE Faelle richtig sind — auch wenn diese Liste heute nur
          // `source=set` laedt.
          return html`<div class="part-card" tabindex="0" role="button"${f.source==='manual' ? html` aria-keyshortcuts="Delete"` : ''} data-stil="position:relative;cursor:pointer" data-click="${f.source==='manual' ? 'openManDetail' : 'openSetItemDetail'}" data-arg="fig" data-arg2="${f.fig_number}" data-arg3="0">
            ${ungeprueft(delBtn)}
            ${imgSrc ? bildTag({ src: imgSrc, alt: '', klasse: 'part-img', fade: true, orig: fullUrl(imgSrc), ph: 'figur' }) : html`<span class="bild-ph part-img" aria-hidden="true">${platzhalterInhalt('figur')}</span>`}
            <div class="part-num">${f.fig_number}</div>
            <div class="part-name">${f.fig_name || '—'}</div>
            <div class="part-qty">×${f.total_quantity || f.quantity}</div>
            ${ungeprueft(condBadge)}
            ${ungeprueft(besitzer)}
            ${erfasst ? html`<div data-stil="font-size:var(--fs-0);color:var(--mut)">${tRaw('gallery.card.bought')} ${erfasst}</div>` : ''}
          </div>`;
        })}
      </div>
    </div>`));
}

/** @param {string} figNumber @param {number|string} [owner] siehe deleteManualPart */
export async function deleteManualFig(figNumber, owner) {
  if (!await confirmDelete(tRaw('figs.delete.title'), tRaw('gallery.delete.text',{name:figNumber}), 'figur')) return false;
  const d = await api('DELETE', `/v1/minifigs/${encodeURIComponent(figNumber)}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`);
  if (d.success) { geloeschtMitRueckgaengig(tRaw('figs.deleted'), d); loadMinifigs(); loadManualFigsTable(); return true; }
  else { toast(d.error || t('settings.error'), 'error'); return false; }
}

/** @type {ManuelleFigur[]} */
let manualFigsCache = [];
/** Die zuletzt geladenen manuell erfassten Figuren (nur lesen). */
export function manuelleFiguren() { return manualFigsCache; }
export async function loadManualFigsTable() {
  const d = await api('GET', `/v1/minifigs/manual${manuellQuery('minifigs', 'fig-search')}`);
  if (!d.success) return;
  manualFigsCache = d.figs || [];
  renderManualFigsTable();
}

/** @type {boolean | null} */
let _setFigurenLeer = null;   // null: noch nicht geladen
/** @type {boolean | null} */
let _manuelleFigurenLeer = null;

/**
 * Wie bei den Teilen (teileLeerAbgleichen in 03-parts.js): ein Leerzustand für den Reiter, und nur wenn beide
 * Listen leer sind.
 */
function figurenLeerAbgleichen() {
  const box = G('manual-figs-box');
  G('tab-minifigs')?.classList.remove('sammlung-leer');
  if (box) box.style.display = _manuelleFigurenLeer === false ? '' : 'none';
  const n = manualFigsCache.length;
  if (G('manual-figs-n')) G('manual-figs-n').textContent = n ? tRaw('parts.group_types', { n }) : '';
  if (_setFigurenLeer !== true) return;
  const el = G('figs-list');
  if (_manuelleFigurenLeer === false) { el.replaceChildren(); return; }
  const q = G('fig-search')?.value.trim() || '';
  G('tab-minifigs')?.classList.toggle('sammlung-leer', !q);
  if (q) meldeTreffer(tRaw('common.no_hits', { query: q }));
  setzeHtml(el, q ? leerZustand({ ico: 'suche', titel: tRaw('common.no_hits', { query: q }), knopf: zuruecksetzenKnopf('minifigs') }) : leerZustand({ ico: 'figur', titel: tRaw('figs.empty'), text: tRaw('figs.auto_hint'),
                    knopf: { text: tRaw('figs.add_title'), click: 'oeffneErfassen', arg: 'fig' } }));
}

/** Die Suche leeren (Knopf im Leerzustand). */
export function figurenFilterZuruecksetzen() {
  const el = G('fig-search'); if (el) el.value = '';
  filterFigs();
}

export function renderManualFigsTable() {
  const el = G('manual-figs-list');
  if (!el) return;
  _manuelleFigurenLeer = !manualFigsCache.length;
  figurenLeerAbgleichen();
  if (!manualFigsCache.length) { el.replaceChildren(); return; }
  if (tabellenAnsicht('figs-view')) {
    setzeHtml(el, manuelleTabelle(manualFigsCache, 'fig'));
    if (typeof window.__bimLabelTables === 'function')
      window.__bimLabelTables(el.querySelector('table'));
    return;
  }
  setzeHtml(el, html`<div class="man-grid">
    ${manualFigsCache.map(f => {
      const imgSrc = imgUrl(thumbUrl(f.image_local || f.image_url) || f.image_local || f.image_url || '', true);
      const img = imgSrc
        ? bildTag({ src: imgSrc, alt: '', klasse: 'man-tile-img', ph: 'figur' })
        : `<span class="bild-ph man-tile-img" aria-hidden="true">${platzhalterInhalt('figur')}</span>`;
      // Mengengewichteter Kaufpreis über die Erfassungen (Server rechnet ihn). unit_price ist der zuletzt
      // geschriebene Einzelwert der Stammzeile — bei zwei Erfassungen zu verschiedenen Preisen stimmte er
      // nicht.
      const figPrice = f.avg_purchase_price ?? f.unit_price ?? f.purchase_price;
      const priceStr = figPrice!=null ? fmtN(figPrice, CURRENCY) : '—';
      const condBadge = condBadges(f);
      return html`<div class="man-tile" tabindex="0" role="button" aria-keyshortcuts="Delete" data-click="openManDetail" data-arg="fig" data-arg2="${f.fig_number}" data-arg3="0" data-stil="cursor:pointer">
        <div class="ca"><span class="delbtn" data-click="deleteManualFigStop"${echt()} aria-hidden="true" data-arg="${f.fig_number}" data-arg2="${f.user_id || ''}" title="${t('figs.delete')}">${TRASH_ICON_SVG}</span></div>
        ${ungeprueft(img)}
        <div class="man-tile-num">${f.fig_number}</div>
        <div class="man-tile-name">${f.fig_name || '—'}</div>
        <div data-stil="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:2px">
          <span class="qbadge">×${f.quantity}</span>${ungeprueft(condBadge)}${ownerBadges(f)}
        </div>
        <div class="preis man-preis">${ungeprueft(priceStr)}</div>
      </div>`;
    })}
  </div>`);
}

/** @param {string} figNumber @param {object} body @param {number | string} [owner] Besitzer der Karte — siehe deleteManualPart. */
export async function updateManualFig(figNumber, body, owner) {
  const d = await api('PUT', `/v1/minifigs/${encodeURIComponent(figNumber)}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`, body);
  if (d.success) { toast(tRaw('settings.saved'),'success'); loadManualFigsTable(); loadMinifigs(); if(aktiverReiter()==='finance') loadFinance(); }
  else toast(d.error||t('settings.error'),'error');
}

/**
 * Hinweis, wenn der Kaufpreis aus dem anderen Zustand stammt: BrickLink führt oft nur einen. Übernehmen und
 * kennzeichnen, damit der Rückfall weder unsichtbar ist noch das Feld leer bleibt. Ein Helfer für Teile und
 * Figuren.
 * Ausführlich: docs/begruendungen/public/js/06-minifigs.js.md#preisherkunfthinweis
 * @param {string | null | undefined} zustand 'N' | 'U' | null — null heisst „nichts zu sagen".
 */
export function preisHerkunftHinweis(zustand) {
  if (zustand !== 'N' && zustand !== 'U') return '';
  return t(zustand === 'N' ? 'price.from_other_condition_new' : 'price.from_other_condition_used');
}

G('btn-add-fig')?.addEventListener('click', async () => {
  const num = G('af-num-inline')?.value.trim();
  const res = G('af-inline-result');
  if(!num){ res.style.color='var(--r500)'; res.textContent=tRaw('figs.number_required'); return; }
  const preis = betragAusFeld('af-price-inline');
  const datumOk = kaufdatumGueltig('af-date');
  const menge = mengeAusFeld('af-qty-inline');
  if (!preis.ok || !menge.ok || !datumOk) return;
  const btn = G('btn-add-fig'); btn.disabled=true; btn.textContent='…';
  res.style.color='var(--mut)'; res.textContent=tRaw('adding.progress');
  const d = await api('POST','/v1/minifigs',{
    fig_number: num,
    bl_fig_number: G('af-blnum-inline')?.value.trim()||null,
    quantity:   menge.wert,
    unit_price: preis.wert,
    condition: G('af-condition')?.value || 'N',
    acquired_at: G('af-date')?.value || null,
    owner_user_id: selectedOwner('af-owner'),
    storage: selectedStorage('af-storage'),
  });
  btn.disabled=false; btn.textContent=tRaw('gallery.add.submit');
  if(d.success){
    const hinweisF = preisHerkunftHinweis(d.price_from_condition);
    res.style.color='var(--g700)';
    res.textContent=`${d.fig_number} ${d.action==='added'?t('common.added'):t('common.updated')}`
      + (hinweisF ? ` — ${hinweisF}` : '');
    // Der Dialog schliesst; das Ergebnis samt Preishinweis kommt als Meldung.
    schliesseErfassen('fig'); toast(res.textContent.replace(/^\u2705\s*/, ''), 'success');
    G('af-num-inline').value=''; G('af-blnum-inline').value=''; G('af-qty-inline').value='1'; G('af-price-inline').value=''; G('af-date').value='';
    leereLagerortFeld('af-storage');
    loadMinifigs();
    // Mit Hinweis laenger stehen lassen: Drei Sekunden reichen fuer ein Haekchen, nicht fuer einen Satz, den
    // man lesen soll.
    setTimeout(()=>{ res.textContent=''; }, hinweisF ? 9000 : 3000);
  } else { res.style.color='var(--r500)'; res.textContent=d.error||tRaw('settings.error'); }
});

// Persistente Status-/Hinweiszeile für den CSV-Import (Teile & Minifiguren)
/**
 * @param {string} elId
 * @param {string} state
 * @param {string} msg
 */
export function csvImportStatus(elId, state, msg) {
  const el = G(elId);
  if (!el) return;
  if (state === 'hide') { el.style.display = 'none'; el.textContent = ''; return; }
  /** @type {Record<string, string>} */
  const styles = {
    running: 'background:var(--b100);color:var(--b700)',
    success: 'background:var(--g100);color:var(--g700)',
    warn:    'background:var(--s100);color:var(--s600)',
    error:   'background:var(--r100);color:var(--r700)',
  };
  el.style.cssText = `display:block;font-size:var(--fs-3);margin-bottom:1rem;padding:.55rem .8rem;border-radius:8px;font-weight:600;${styles[state] || styles.running}`;
  el.textContent = msg;
}

async function importFigsCsv() {
  const d = await csvHochladen({ feld: 'fig-csv-file', pfad: '/v1/minifigs/import/csv',
    zeige: (l) => csvImportStatus('fig-csv-status', l ? 'running' : 'hide', tRaw('import.running')) });
  if (d) loadMinifigs();
}

G('btn-fig-csv-template').onclick = (e) => {
  e.preventDefault();
  const csv = 'fig_number,bl_fig_number,quantity,unit_price,condition,acquired_at\nfig-007357,sw0001,1,12.50,N,2024-01-15\nfig-009314,,2,,U,\n';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'minifigs-template.csv';
  a.click();
};


/**
 * Abfrageteil der manuellen Listen: Kontofilter UND Suchtext. scopeQuery() allein liess die Suche an den
 * manuellen Kacheln vorbeilaufen, obwohl die Filterleiste über beiden Listen steht. Gefiltert wird am Server.
 * Ausführlich: docs/begruendungen/public/js/06-minifigs.js.md#manuellquery
 * @param {string} view     Name des Blickfelds ('parts' | 'minifigs')
 * @param {string} sucheId  ID des Suchfelds der Filterleiste
 */
export function manuellQuery(view, sucheId) {
  const p = new URLSearchParams();
  addScopeParam(p, view);
  // Der Lagerortfilter steht in derselben Leiste und gehoert damit zum gleichen Versprechen. Es gibt ihn nur
  // fuer Galerie und Teile (LAGER_VIEWS in 14-scope.js); fuer 'minifigs' haengt addLagerParam nichts an, und
  // deshalb kennt getManualMinifigs ihn auch nicht.
  addLagerParam(p, view);
  const q = G(sucheId)?.value?.trim();
  if (q) p.set('search', q);
  const s = p.toString();
  return s ? '?' + s : '';
}

/**
 * Die manuell erfassten Posten als Tabelle: Der Ansichtsumschalter steht über beiden Listen und muss für
 * beide gelten. Eine Funktion für Teile und Figuren, damit die zwei Tabellen nicht auseinanderlaufen.
 * Ausführlich: docs/begruendungen/public/js/06-minifigs.js.md#manuelletabelle
 * @param {(import('./03-parts.js').ManuellesTeil | ManuelleFigur)[]} posten  Die Einträge aus dem jeweiligen Cache.
 * @param {'part'|'fig'} art
 */
export function manuelleTabelle(posten, art) {
  const istTeil = art === 'part';
  const kopf = [
    t('col.image_th'),
    istTeil ? t('col.part_nr') : t('col.number'),
    t('col.name'),
    ...(istTeil ? [t('col.color')] : []),
    t('detail.qty'),
    t('common.condition'),
    t('detail.purchase_price'),
    t('detail.storage'),
    '',
  ];
  const zeile = (/** @type {import('./03-parts.js').ManuellesTeil | ManuelleFigur} */ p) => {
    const nummer = istTeil ? p.part_number : p.fig_number;
    const blNummer = (istTeil ? p.bl_part_number : p.bl_fig_number) || nummer;
    const name = istTeil ? p.part_name : p.fig_name;
    const imgSrc = imgUrl(thumbUrl(p.image_local || p.image_url) || p.image_local || p.image_url || '', true);
    const preis = p.avg_purchase_price ?? p.unit_price ?? p.purchase_price;
    const loeschKlick = istTeil ? 'deleteManualPartStop' : 'deleteManualFigStop';
    const loeschTitel = tRaw(istTeil ? 'parts.delete.title' : 'figs.delete');
    // Beim Teil traegt der Papierkorb (Nummer, Farbe, Besitzer), bei der Figur (Nummer, Besitzer) — dieselbe
    // Reihenfolge wie auf den Kacheln.
    const loeschArgs = istTeil
      ? `data-arg="${esc(nummer)}" data-arg2="${p.color_id || 0}" data-arg3="${p.user_id || ''}"`
      : `data-arg="${esc(nummer)}" data-arg2="${p.user_id || ''}"`;
    return html`<tr data-stil="cursor:pointer" data-click="openManDetail" data-arg="${art}" data-arg2="${nummer}" data-arg3="${istTeil ? p.color_id || 0 : 0}">
      <td>${imgSrc ? bildTag({ src: imgSrc, alt: '', klasse: 'bild-klein', ph: istTeil ? 'teil' : 'figur' }) : html`<span class="bild-ph bild-klein" aria-hidden="true">${platzhalterInhalt(istTeil ? 'teil' : 'figur')}</span>`}</td>
      <td>${zeilenKnopf({ click: 'openManDetail', arg: art, arg2: String(nummer), arg3: istTeil ? Number(p.color_id) || 0 : 0 },
        html`<span data-stil="font-family:var(--mono);font-size:var(--fs-1);color:var(--b600)" title="${nummer}">${blNummer}</span>`,
        tRaw('zeile.oeffnen', { name: name || nummer, nr: blNummer }))}</td>
      <td data-stil="max-width:200px">${name || '—'}</td>
      ${istTeil ? html`<td><div data-stil="display:flex;align-items:center;gap:5px">${p.color_hex ? html`<div class="color-dot" data-farbe="${escHex(p.color_hex, 'var(--s300)')}"></div>` : ''}${colorName(/** @type {string | null | undefined} */ (p.color_name))}</div></td>` : ''}
      <td><span data-stil="font-family:var(--mono);font-weight:600;color:var(--b700)">${p.quantity || 0}</span></td>
      <td>${condBadges(p)}</td>
      <td class="preis">${preis != null ? fmtN(preis, CURRENCY) : '—'}</td>
      <td data-stil="font-size:var(--fs-1);color:var(--mut)">${p.storage || ''}</td>
      <td><button class="delbtn" data-click="${loeschKlick}"${echt()} ${ungeprueft(loeschArgs)} title="${loeschTitel}" aria-label="${loeschTitel}">${TRASH_ICON_SVG}</button>${ownerBadges(p)}</td>
    </tr>`;
  };
  return html`<div class="tw"><table class="dt" aria-label="${tRaw(istTeil ? 'parts.manual_section' : 'finance.figs_section')}" data-stil="font-size:var(--fs-2)"><thead><tr>${kopf.map(h => html`<th>${ungeprueft(h)}</th>`)}</tr></thead><tbody>${ungeprueft(posten.map(zeile).join(''))}</tbody></table></div>`;
}

/**
 * Steht der Umschalter des Reiters auf „Tabelle"?
 * @param {string} id
 */
export function tabellenAnsicht(id) {
  return G(id)?.value === 'table';
}

abonniere('bestandGeaendert', () => { loadMinifigs(); loadManualFigsTable(); });

// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  loadMinifigs,
  deleteManualFig,
  filterFigs,
  importFigsCsv,
});
