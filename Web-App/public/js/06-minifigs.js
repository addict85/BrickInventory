// Der Reiter Minifiguren: Figuren aus Sets und manuell erfasste Figuren, dazu
// die gemeinsamen Hilfen für manuelle Tabellen und CSV-Status.
import { abonniere } from './00-ereignisse.js';
import { echt, registerActions } from './00-registry.js';
import { listeLadefehler, condBadges, ownerBadges, schliesseErfassen } from './01-bausteine.js';
import { colorName, t, tRaw } from '../i18n.js';
import { fmtDatum, bildTag, platzhalterInhalt, leerZustand, escHex, G, TRASH_ICON_SVG, api, escJs, fmtN, fullUrl, imgUrl, thumbUrl, toast, zuruecksetzenKnopf, betragAusFeld, aktiverReiter } from './01-core.js';
import { addLagerParam, addScopeParam, scopeQuery } from './14-scope.js';
import { loadFinance } from './04-finance.js';
import { geloeschtMitRueckgaengig } from './20-papierkorb.js';
import { CURRENCY } from './00-zustand.js';
import { esc } from './00-escapen.js';
import { leereLagerortFeld, selectedOwner, selectedStorage } from './02-konten-orte.js';
import { confirmDelete } from './01-rueckfrage.js';

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
  p.set('page_size', String(FIG_PAGE_SIZE));
  // Manuell erfasste Figuren haben oben eine eigene Sektion. Der Ausschluss
  // gehört auf den Server — clientseitig gefiltert könnte eine ganze Seite
  // wegfallen und die Liste bliebe scheinbar leer.
  // Fest 'set': Manuell erfasste Figuren haben ihren eigenen Bereich mit
  // editierbaren Karten (manual-figs-list) — in dieser Liste waeren sie
  // doppelt. Der Ausschluss gehoert auf den Server; clientseitig gefiltert
  // koennte eine ganze Seite wegfallen und die Liste bliebe scheinbar leer.
  //
  // Hier stand `G('fig-source')?.value || 'set'`. Das Auswahlfeld daneben trug
  // GENAU EINE Option mit dem Wert "" und wurde von nirgends gefuellt — der
  // Ausdruck ergab also immer 'set', und sein change-Ereignis konnte nie
  // eintreten. Ein Bedienelement, das eine Wahl verspricht und keine anbietet,
  // ist raus (die Android-App zeigt an dieser Stelle ebenfalls keines).
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
 *
 * BEIDE Listen des Reiters, nicht nur die aus Sets: Die manuell erfassten
 * Figuren stehen unter derselben Filterleiste (public/index.html begruendet
 * die Anordnung genau damit, test/tab-layout.test.js prueft sie). Vorher lief
 * nur loadMinifigs() — dieselbe Luecke, die Marco bei den Teilen gemeldet hat.
 */
function filterFigs() { loadMinifigs(); loadManualFigsTable(); }

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
  if (!target) _setFigurenLeer = !list.length;
  if (!list.length) {
    if (target) el.innerHTML = '';
    else figurenLeerAbgleichen();
    return;
  }
  if (!target) figurenLeerAbgleichen();

  const viewMode = G('figs-view')?.value || 'grid';

  if (viewMode === 'table') {
    // Ohne die Spalten „Quelle" und Papierkorb.
    //
    // Beide waren KONSTANT: renderFigs() bekommt ausschliesslich
    // `allFigsCache`, und der wird mit `source=set` geladen (figParams). Die
    // Quelle stand also in jeder Zeile auf „aus Set", und der Papierkorb —
    // `f.source==='manual' ? … : ''` — war in jeder Zeile leer. Zwei von
    // sieben Spalten, die etwas versprachen und nichts zeigten. Manuell
    // erfasste Figuren haben ihren eigenen Bereich mit editierbaren Karten.
    //
    // Aufgefallen beim Uebertragen der Tabelle in die App: Was dort nachgebaut
    // wird, muss vorher stimmen.
    el.innerHTML = `<div class="tw"><table class="dt">
      <thead><tr>
        <th>${t('col.image')}</th><th>${t('col.number')}</th><th>${t('col.name')}</th><th>${t('detail.qty')}</th><th>${t('detail.created')}</th>
      </tr></thead>
      <tbody>${list.map(f => {
        const imgSrc = imgUrl(thumbUrl(f.image_local || f.image_url) || f.image_local || f.image_url || '', true);
        const dateVal = f.set_added_at || null;
        const erfasst = dateVal ? fmtDatum(dateVal) : '—';
        // Anklickbar wie die Kachel darunter — dieselbe Handlung in beiden
        // Ansichten (Marcos Detail-Dialog fuer automatisch erfasste Figuren).
        return `<tr data-stil="cursor:pointer" data-click="${f.source==='manual'?'openManDetail':'openSetItemDetail'}" data-arg="fig" data-arg2="${escJs(f.fig_number)}" data-arg3="0">
          <td>${imgSrc?bildTag({ src: imgSrc, alt: '', klasse: 'bild-klein', ph: 'figur' }):`<span class="bild-ph bild-klein" aria-hidden="true">${platzhalterInhalt('figur')}</span>`}</td>
          <td><span data-stil="font-family:var(--mono);font-size:var(--fs-1);color:var(--b600)">${esc(f.fig_number)}</span></td>
          <td data-stil="max-width:200px">${esc(f.fig_name)||'—'}</td>
          <td><span data-stil="font-family:var(--mono);font-weight:600;color:var(--b700)">${f.total_quantity||f.quantity}</span></td>
          <td data-stil="font-size:var(--fs-1);color:var(--mut)">${erfasst}</td>
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
        <span class="group-sub">${t('parts.group_types', { n: figs.length })}</span>
      </div>
      <div class="parts-grid">
        ${figs.map(f => {
          const imgSrc = imgUrl(thumbUrl(f.image_local || f.image_url) || f.image_local || f.image_url || '', true);
          const dateVal = f.set_added_at || null;
          const erfasst = dateVal ? fmtDatum(dateVal) : '';
          // Papierkorb oben rechts, wie auf der Set-Kachel: .ca setzt
          // top:6px;right:6px und blendet ihn beim Ueberfahren ein
          // (styles.css). Marcos Vorgabe vom 24.09., zweiter Teil: „analog den
          // Kacheln bei den Sets. Dies aber nur in der webapp."
          const delBtn = f.source==='manual' ? `<div class="ca"><span class="delbtn" data-click="deleteManualFigStop"${echt()} aria-hidden="true" data-arg="${esc(f.fig_number)}" data-arg2="${f.user_id||''}" title="${esc(t('figs.delete'))}">${TRASH_ICON_SVG}</span></div>` : '';
          // Zustand nur bei manuell erfassten Minifiguren anzeigen (automatisch
          // hinzugefügte aus Sets haben keinen eigenen Zustand).
          // Eine Plakette je erfasstem Zustand — gemeinsame Fassung in
          // 02-gallery.js. Die frühere Inline-Fassung hier trug dieselben
          // Farben noch einmal von Hand ein.
          // Zustand nur bei manuell erfassten — die Begruendung darueber gilt.
          // Die BESITZER-Plakette dagegen unbedingt: Sie beantwortet „wem
          // gehoert das?", und diese Frage stellt sich bei einer Figur aus dem
          // Set eines Kindes genauso wie bei einer selbst erfassten. Die
          // Galerie-Kachel daneben zeigt sie seit jeher.
          //
          // Sie stand hier INNERHALB der manual-Bedingung — und diese Liste
          // laedt ausschliesslich `source=set` (figParams). Die Plakette war
          // also unerreichbar. Ohne Haushalt ist `owners` leer und
          // ownerBadges() liefert '' — im Einzelkonto aendert sich nichts.
          const condBadge = f.source==='manual'
            ? `<div data-stil="display:flex;gap:3px;justify-content:center;flex-wrap:wrap;margin-top:3px">${condBadges(f)}</div>`
            : '';
          const besitzer = ownerBadges(f)
            ? `<div data-stil="display:flex;gap:3px;justify-content:center;flex-wrap:wrap;margin-top:3px">${ownerBadges(f)}</div>`
            : '';
          // Manuell erfasste Figuren haben ihren eigenen Dialog (Kaufpreise,
          // Menge aenderbar); die aus Sets den neuen ohne Preis und ohne
          // Mengenaenderung. Die Kachel entscheidet nach der Quelle, damit
          // BEIDE Faelle richtig sind — auch wenn diese Liste heute nur
          // `source=set` laedt.
          return `<div class="part-card" data-stil="position:relative;cursor:pointer" data-click="${f.source==='manual'?'openManDetail':'openSetItemDetail'}" data-arg="fig" data-arg2="${escJs(f.fig_number)}" data-arg3="0">
            ${delBtn}
            ${imgSrc ? bildTag({ src: imgSrc, alt: f.fig_name || f.fig_number, klasse: 'part-img', fade: true, orig: fullUrl(imgSrc), ph: 'figur' })
                     : `<span class="bild-ph part-img" role="img" aria-label="${esc(f.fig_name || f.fig_number)}">${platzhalterInhalt('figur')}</span>`}
            <div class="part-num">${esc(f.fig_number)}</div>
            <div class="part-name">${esc(f.fig_name)||'—'}</div>
            <div class="part-qty">×${f.total_quantity||f.quantity}</div>
            ${condBadge}
            ${besitzer}
            ${erfasst ? `<div data-stil="font-size:var(--fs-0);color:var(--mut)">${erfasst}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

/** @param {string} figNumber @param {number|string} [owner] siehe deleteManualPart */
export async function deleteManualFig(figNumber, owner) {
  if (!await confirmDelete(tRaw('figs.delete.title'), t('gallery.delete.text',{name:figNumber}), 'figur')) return false;
  const d = await api('DELETE', `/v1/minifigs/${encodeURIComponent(figNumber)}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`);
  if (d.success) { geloeschtMitRueckgaengig(tRaw('figs.deleted'), d); loadMinifigs(); loadManualFigsTable(); return true; }
  else { toast(d.error || t('settings.error'), 'error'); return false; }
}

export let manualFigsCache = [];
export async function loadManualFigsTable() {
  const d = await api('GET', '/v1/minifigs/manual'+manuellQuery('minifigs', 'fig-search'));
  if (!d.success) return;
  manualFigsCache = d.figs || [];
  renderManualFigsTable();
}

/** @type {boolean | null} */
let _setFigurenLeer = null;   // null: noch nicht geladen
/** @type {boolean | null} */
let _manuelleFigurenLeer = null;

/**
 * Wie bei den Teilen (teileLeerAbgleichen in 03-parts.js): ein Leerzustand
 * für den Reiter, und nur wenn beide Listen leer sind.
 */
function figurenLeerAbgleichen() {
  const box = G('manual-figs-box');
  if (box) box.style.display = _manuelleFigurenLeer === false ? '' : 'none';
  if (_setFigurenLeer !== true) return;
  const el = G('figs-list');
  if (_manuelleFigurenLeer === false) { el.innerHTML = ''; return; }
  const q = G('fig-search')?.value.trim() || '';
  el.innerHTML = q
    ? leerZustand({ ico: 'suche', titel: tRaw('common.no_hits', { query: q }), knopf: zuruecksetzenKnopf('minifigs') })
    : leerZustand({ ico: 'figur', titel: tRaw('figs.empty'), text: tRaw('figs.auto_hint'),
                    knopf: { text: tRaw('figs.add_title'), click: 'oeffneErfassen', arg: 'fig' } });
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
  if (!manualFigsCache.length) { el.innerHTML = ''; return; }
  if (tabellenAnsicht('figs-view')) {
    el.innerHTML = manuelleTabelle(manualFigsCache, 'fig');
    if (typeof window.__bimLabelTables === 'function')
      window.__bimLabelTables(el.querySelector('table'));
    return;
  }
  el.innerHTML = `<div class="man-grid">
    ${manualFigsCache.map(f => {
      const imgSrc = imgUrl(thumbUrl(f.image_local || f.image_url) || f.image_local || f.image_url || '', true);
      const img = imgSrc
        ? bildTag({ src: imgSrc, alt: f.fig_name || f.fig_number, klasse: 'man-tile-img', ph: 'figur' })
        : `<span class="bild-ph man-tile-img" role="img" aria-label="${esc(f.fig_name || f.fig_number)}">${platzhalterInhalt('figur')}</span>`;
      // Mengengewichteter Kaufpreis über die Erfassungen (Server rechnet ihn).
      // unit_price ist der zuletzt geschriebene Einzelwert der Stammzeile —
      // bei zwei Erfassungen zu verschiedenen Preisen stimmte er nicht.
      const figPrice = f.avg_purchase_price ?? f.unit_price ?? f.purchase_price;
      const priceStr = figPrice!=null ? fmtN(figPrice, CURRENCY) : '—';
      const condBadge = condBadges(f);
      return `<div class="man-tile" tabindex="0" role="button" data-click="openManDetail" data-arg="fig" data-arg2="${esc(f.fig_number)}" data-arg3="0" data-stil="cursor:pointer">
        <div class="ca"><span class="delbtn" data-click="deleteManualFigStop"${echt()} aria-hidden="true" data-arg="${esc(f.fig_number)}" data-arg2="${f.user_id||''}" title="${esc(t('figs.delete'))}">${TRASH_ICON_SVG}</span></div>
        ${img}
        <div class="man-tile-num">${esc(f.fig_number)}</div>
        <div class="man-tile-name">${esc(f.fig_name) || '—'}</div>
        <div data-stil="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:2px">
          <span class="qbadge">×${f.quantity}</span>${condBadge}${ownerBadges(f)}
        </div>
        <div class="preis man-preis">${priceStr}</div>
      </div>`;
    }).join('')}
  </div>`;
}

/** @param {number} [owner] Besitzer der Karte — siehe deleteManualPart. */
export async function updateManualFig(figNumber, body, owner) {
  const d = await api('PUT', `/v1/minifigs/${encodeURIComponent(figNumber)}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`, body);
  if (d.success) { toast(tRaw('settings.saved'),'success'); loadManualFigsTable(); loadMinifigs(); if(aktiverReiter()==='finance') loadFinance(); }
  else toast(d.error||t('settings.error'),'error');
}

/**
 * Der Hinweis, wenn der Kaufpreis aus dem ANDEREN Zustand stammt.
 *
 * ── Warum es ihn gibt ────────────────────────────────────────
 * Marcos zwei Befunde waren zwei Seiten derselben Tatsache: BrickLink fuehrt
 * zu vielen Teilen und Figuren nur EINEN Zustand.
 *
 *   „Der Zustand hat keinen Einfluss auf den Preis"   → der Rueckfall war unsichtbar
 *   „Teilweise wird der Kaufpreis nicht geladen"      → ohne Rueckfall blieb es leer
 *
 * Seine Entscheidung: uebernehmen und kennzeichnen. Der Server sagt in
 * `price_from_condition`, aus welchem Zustand der Wert stammt; hier steht der
 * Satz dazu.
 *
 * EIN Helfer fuer beide Erfassungen: Teile und Figuren hatten denselben
 * Erfolgsblock in zwei Kopien, und in diesem Baum ist schon mehrfach eine
 * Regel nur in einer davon nachgezogen worden.
 *
 * @param zustand 'N' | 'U' | null — null heisst „nichts zu sagen".
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
  if (!preis.ok) return;
  const btn = G('btn-add-fig'); btn.disabled=true; btn.textContent='…';
  res.style.color='var(--mut)'; res.textContent=tRaw('adding.progress');
  const d = await api('POST','/v1/minifigs',{
    fig_number: num,
    bl_fig_number: G('af-blnum-inline')?.value.trim()||null,
    quantity:   parseInt(G('af-qty-inline')?.value)||1,
    unit_price: preis.wert,
    condition: G('af-condition')?.value || 'N',
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
    G('af-num-inline').value=''; G('af-blnum-inline').value=''; G('af-qty-inline').value='1'; G('af-price-inline').value='';
    leereLagerortFeld('af-storage');
    loadMinifigs();
    // Mit Hinweis laenger stehen lassen: Drei Sekunden reichen fuer ein
    // Haekchen, nicht fuer einen Satz, den man lesen soll.
    setTimeout(()=>{ res.textContent=''; }, hinweisF ? 9000 : 3000);
  } else { res.style.color='var(--r500)'; res.textContent=d.error||t('settings.error'); }
});

// Persistente Status-/Hinweiszeile für den CSV-Import (Teile & Minifiguren)
export function csvImportStatus(elId, state, msg) {
  const el = G(elId);
  if (!el) return;
  if (state === 'hide') { el.style.display = 'none'; el.textContent = ''; return; }
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
  const fi = G('fig-csv-file');
  if (!fi.files[0]) return;
  const fd = new FormData(); fd.append('file', fi.files[0]);
  csvImportStatus('fig-csv-status', 'running', t('import.running'));
  try {
    const d = await api('POST', '/v1/minifigs/import/csv', fd);
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
  const csv = 'fig_number,bl_fig_number,quantity,unit_price,condition,acquired_at\nfig-007357,sw0001,1,12.50,N,2024-01-15\nfig-009314,,2,,U,\n';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'minifigs-template.csv';
  a.click();
};


/**
 * Abfrageteil für die MANUELL erfassten Listen: Kontofilter und Suchtext.
 *
 * ── Warum nicht scopeQuery() allein (Marcos Befund vom 20.10.) ──────────────
 *
 * „Wenn ich im Filter z.b. nach 3001 suche passiert nichts."
 *
 * Hier stand `scopeQuery('parts')` — nur der Kontofilter. Der Suchtext ging
 * über partsParams() (03-parts.js) ausschliesslich an die Set-Teile-Wand, und
 * die manuellen Kacheln blieben unberührt. public/index.html stellt die
 * Filterleiste aber über den manuellen Bereich und begründet das dort
 * ausdrücklich damit, dass der Filter auf BEIDE Listen wirkt.
 *
 * Gefiltert wird am Server (die Begründung steht in 14-scope.js beim
 * Lagerortfilter), deshalb reist der Text als Abfrageparameter mit — und
 * deshalb muss jeder Weg, der eine dieser Listen neu lädt, hier vorbei.
 *
 * EIN Helfer für Teile und Figuren: Dieselbe Lücke bestand in beiden Reitern,
 * und zwei Fassungen wären zwei Stellen, an denen der nächste Filter vergessen
 * wird.
 *
 * @param {string} view     Name des Blickfelds ('parts' | 'minifigs')
 * @param {string} sucheId  ID des Suchfelds der Filterleiste
 */
export function manuellQuery(view, sucheId) {
  const p = new URLSearchParams();
  addScopeParam(p, view);
  // Der Lagerortfilter steht in derselben Leiste und gehoert damit zum
  // gleichen Versprechen. Es gibt ihn nur fuer Galerie und Teile (LAGER_VIEWS
  // in 14-scope.js); fuer 'minifigs' haengt addLagerParam nichts an, und
  // deshalb kennt getManualMinifigs ihn auch nicht.
  addLagerParam(p, view);
  const q = G(sucheId)?.value?.trim();
  if (q) p.set('search', q);
  const s = p.toString();
  return s ? '?' + s : '';
}

/**
 * Die manuell erfassten Posten als TABELLE — Teile und Figuren.
 *
 * ── Marcos Befund vom 20.10. ────────────────────────────────────────────────
 *
 *   „Wenn ich bei den Teilen auf Tabelle umschalte, werden nur die Teile aus
 *    den Sets als Tabelle angezeigt. Die manuell erfassten sind immer
 *    Kacheln."
 *
 * Das stimmte, und zwar doppelt: renderManualParts() zeichnete unbedingt
 * `man-grid`, und der Umschalter hing allein an loadPartsData() — derselbe
 * halbe Anschluss wie beim Suchtext (siehe teileFilterGeaendert in
 * public/js/03-parts.js und test/manuelle-listen-filter-db.test.js). Die
 * Filterleiste MIT dem Umschalter steht ueber beiden Listen; was dort
 * eingestellt wird, gilt fuer beide.
 *
 * ── EIN Bauer fuer Teile und Figuren ────────────────────────────────────────
 *
 * Dieselbe Luecke bestand in beiden Reitern (figs-view rief renderFigsAll(),
 * also nur die Figuren aus Sets). Zwei Fassungen waeren zwei Stellen, an denen
 * die naechste Spalte vergisst, dass es die andere Liste gibt — genau die
 * Begruendung, die schon an manuellQuery() oben steht.
 *
 * ── Was die Tabelle zeigt ───────────────────────────────────────────────────
 *
 * Alles, was auch auf der Kachel steht, und den Lagerort dazu: Beide
 * Abfragen liefern ihn langst (`lo.name AS storage`), die Kachel hat nur
 * keinen Platz dafuer. Eine Tabelle ist der Ort, an dem eine solche Spalte
 * etwas nutzt — Marco hat den Lagerort am selben Tag zum Thema gemacht.
 *
 * Die Handlungen sind dieselben wie auf der Kachel — Zeile klicken oeffnet das
 * Detail, der Papierkorb loescht. Eine Ansicht darf nicht koennen, was die
 * andere nicht kann; der Satz steht so schon an partsTableRow()
 * (public/js/03-parts.js), und dort steht auch, dass in diesem Projekt genau
 * daran mehrfach etwas auseinandergelaufen ist.
 *
 * @param {Array}  posten  Die Einträge aus dem jeweiligen Cache.
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
  const zeile = (p) => {
    const nummer = istTeil ? p.part_number : p.fig_number;
    const blNummer = (istTeil ? p.bl_part_number : p.bl_fig_number) || nummer;
    const name = istTeil ? p.part_name : p.fig_name;
    const imgSrc = imgUrl(thumbUrl(p.image_local || p.image_url) || p.image_local || p.image_url || '', true);
    const preis = p.avg_purchase_price ?? p.unit_price ?? p.purchase_price;
    const loeschKlick = istTeil ? 'deleteManualPartStop' : 'deleteManualFigStop';
    const loeschTitel = tRaw(istTeil ? 'parts.delete.title' : 'figs.delete');
    // Beim Teil traegt der Papierkorb (Nummer, Farbe, Besitzer), bei der Figur
    // (Nummer, Besitzer) — dieselbe Reihenfolge wie auf den Kacheln.
    const loeschArgs = istTeil
      ? `data-arg="${esc(nummer)}" data-arg2="${p.color_id || 0}" data-arg3="${p.user_id || ''}"`
      : `data-arg="${esc(nummer)}" data-arg2="${p.user_id || ''}"`;
    return `<tr data-stil="cursor:pointer" tabindex="0" data-click="openManDetail" data-arg="${art}" data-arg2="${esc(nummer)}" data-arg3="${istTeil ? (p.color_id || 0) : 0}">
      <td>${imgSrc
        ? bildTag({ src: imgSrc, alt: '', klasse: 'bild-klein', ph: istTeil ? 'teil' : 'figur' })
        : `<span class="bild-ph bild-klein" aria-hidden="true">${platzhalterInhalt(istTeil ? 'teil' : 'figur')}</span>`}</td>
      <td><span data-stil="font-family:var(--mono);font-size:var(--fs-1);color:var(--b600)" title="${esc(nummer)}">${esc(blNummer)}</span></td>
      <td data-stil="max-width:200px">${esc(name) || '—'}</td>
      ${istTeil ? `<td><div data-stil="display:flex;align-items:center;gap:5px">${
        p.color_hex ? `<div class="color-dot" data-farbe="${escHex(p.color_hex, 'var(--s300)')}"></div>` : ''
      }${esc(colorName(p.color_name))}</div></td>` : ''}
      <td><span data-stil="font-family:var(--mono);font-weight:600;color:var(--b700)">${p.quantity || 0}</span></td>
      <td>${condBadges(p)}</td>
      <td class="preis">${preis != null ? fmtN(preis, CURRENCY) : '—'}</td>
      <td data-stil="font-size:var(--fs-1);color:var(--mut)">${esc(p.storage || '')}</td>
      <td><button class="delbtn" data-click="${loeschKlick}"${echt()} ${loeschArgs} title="${esc(loeschTitel)}" aria-label="${esc(loeschTitel)}">${TRASH_ICON_SVG}</button>${ownerBadges(p)}</td>
    </tr>`;
  };
  return `<div class="tw"><table class="dt" data-stil="font-size:var(--fs-2)"><thead><tr>${
    kopf.map(h => `<th>${h}</th>`).join('')
  }</tr></thead><tbody>${posten.map(zeile).join('')}</tbody></table></div>`;
}

/** Steht der Umschalter des Reiters auf „Tabelle"? */
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
