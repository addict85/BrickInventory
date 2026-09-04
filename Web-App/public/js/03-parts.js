import { ladeAnzeige } from './01-bausteine.js';
import { registerActions } from './00-registry.js';
import { colorName, locale, t } from '../i18n.js';
import { G, api, esc, escHex, escHtml, escJs, escUrl, fmtBig, fullUrl, imgUrl, observeLazyImages, thumbUrl } from './01-core.js';
import { addScopeParam, scopeQuery } from './14-scope.js';
import { PARTS_ICON_SVG, allSets } from './02-gallery.js';

/**
 * Ziegel-Symbol des Reiters „Teile" für die Leer-Anzeige.
 *
 * PARTS_ICON_SVG ist in 02-gallery.js definiert und dort auf 1em ausgelegt
 * (Fliesstext). Für die Leer-Anzeige braucht es dieselbe Zeichnung in gross —
 * deshalb nur die Grössenangabe ersetzen statt eine zweite Konstante
 * anzulegen. Ein zweites `const PARTS_ICON_SVG` würde die Datei mit
 * „Identifier has already been declared" abbrechen lassen, und dann wäre KEINE
 * Funktion daraus definiert.
 */
function partsIconLarge() {
  return PARTS_ICON_SVG.replace('width:1em;height:1em', 'width:56px;height:56px');
}

// ═══ Teile-Inventar (Liste, Suche, Filter) ═══
// Teil von app.js — die Dateien in public/js/ werden in nummerierter
// Reihenfolge geladen und teilen sich den globalen Scope (kein Modul-
// System noetig, Inline-onclick-Handler in index.html funktionieren
// unveraendert). Der Split ist rein sequenziell und verhaelt sich
// identisch zur frueheren Einzeldatei.

// ── PARTS ─────────────────────────────────────────────
let partsColors=[], partsCats=[], activeColor=null, activeCat=null;
// Kategorie-ID (part_cat_id) -> Klartextname via geladenem partsCats-Mapping.
function catLabel(cn){ if(cn==null||cn==='') return '—'; const c=partsCats.find(x=>String(x.category_name)===String(cn)); return (c&&c.label)?c.label:String(cn); }

export async function loadParts(){
  // Run stats + filters in parallel, then load data (needs filters first for UI)
  await Promise.all([loadPartsStats(), loadPartsFilters()]);
  await loadPartsData();
}

async function loadPartsStats(){
  const d=await api('GET','/v1/parts/stats'+scopeQuery('parts'));
  if(!d.success) return;
  const s=d.stats;
  G('ps-total').textContent=fmtBig(s.total_parts||0);
  G('ps-unique').textContent=fmtBig(s.unique_parts||0);
  G('ps-colors').textContent=s.unique_colors||0;
}

async function loadPartsFilters(){
  const [cd,catd]=await Promise.all([api('GET','/v1/parts/colors'+scopeQuery('parts')),api('GET','/v1/parts/categories')]);
  partsColors=cd.colors||[]; partsCats=catd.categories||[];

  G('color-filter').innerHTML=`<div class="filter-item ${!activeColor?'active':''}" data-click="setColorFilter" data-arg=""><span>${t('gallery.filter.all')}</span></div>`
    +partsColors.map(c=>`<div class="filter-item ${activeColor===c.color_name?'active':''}" data-click="setColorFilter" data-arg="${escHtml(c.color_name)}">
      <div style="display:flex;align-items:center;gap:6px"><div class="color-dot" style="background:${escHex(c.color_hex, 'var(--s300)')}"></div><span>${esc(colorName(c.color_name))}</span></div>
      <span class="cnt">${c.unique_parts} ${t('parts.stat.types')}</span>
    </div>`).join('');

  G('cat-filter').innerHTML=`<div class="filter-item ${!activeCat?'active':''}" data-click="setCatFilter" data-arg=""><span>${t('filter.all')}</span></div>`
    +partsCats.map(c=>`<div class="filter-item ${activeCat===c.category_name?'active':''}" data-click="setCatFilter" data-arg="${escHtml(c.category_name)}">
      <span>${esc(c.label||c.category_name)||'Unbekannt'}</span><span class="cnt">${(c.total_quantity||0).toLocaleString(locale())}</span>
    </div>`).join('');
}

function setColorFilter(c){ activeColor=c; loadPartsFilters(); loadPartsData(); }
function setCatFilter(c){ activeCat=c; loadPartsFilters(); loadPartsData(); }
// esc / escJs / escUrl / escHex liegen jetzt zentral in 01-core.js — sie wurden
// hier definiert, aber auch von 02-gallery.js und 04-finance.js benutzt, also
// von Dateien, die VOR dieser geladen werden. Das ging nur gut, weil die
// Aufrufe erst nach dem Laden aller Skripte passieren.

// ═══ TEILE-LISTE: SEITENWEISE MIT ENDLOS-SCROLL ═════════════════════════════
//
// Vorher holte diese Ansicht in einem Zug JEDE Teil/Farb-Kombination der
// Sammlung und baute daraus in einem Rutsch die komplette Kachelwand. An einem
// Datensatz mit 380 Sets (171'000 parts-Zeilen) gemessen: 20,65 MB Nutzlast und
// zehntausende DOM-Knoten pro Tabwechsel. Mit Seiten zu 100 sind es 0,03 MB und
// 100 Kacheln; nachgeladen wird erst beim Scrollen.
//
// Muster wie im Katalog (09-catalog.js): Sentinel plus IntersectionObserver,
// Scroll-Fallback, und ein Generationszähler, damit eine langsame Antwort einer
// verworfenen Filterkombination nicht in eine neuere Liste hineinschreibt.
//
// Die eine Stelle, die hier eigenes Nachdenken braucht: Die Kachelansicht
// gruppiert nach Farbe mit Zwischenüberschrift, und eine Farbe kann über eine
// Seitengrenze laufen. Der Server sortiert nach MIN(color_name), MIN(part_name),
// die Seiten kommen also farbsortiert an — die neue Seite hängt ihre ersten
// Karten deshalb in die BESTEHENDE letzte Gruppe ein, statt eine zweite
// Überschrift derselben Farbe zu erzeugen. _partsLastColor merkt sich, welche
// das war.

const PARTS_PAGE_SIZE = 100;
let _partsPage = 0;          // zuletzt geladene Seite
let _partsTotal = 0;         // Gesamtzahl der Gruppen laut Server
let _partsShown = 0;         // bereits gerenderte Gruppen
let _partsGen = 0;           // Generationszähler gegen späte Antworten
let _partsLoading = false;
let _partsDone = false;
let _partsLastColor = null;  // Farbe der zuletzt gerenderten Gruppe

/** Filter- und Modusparameter für eine Seitenabfrage. */
function partsParams(page){
  const p = new URLSearchParams();
  if (activeColor) p.set('color', activeColor);
  if (activeCat)   p.set('category', activeCat);
  const search = G('parts-search').value.trim();
  if (search) p.set('search', search);
  const spare = G('parts-spare').value;
  if (spare !== '') p.set('spare', spare);
  // Manuell erfasste Teile haben ihren eigenen Bereich oben — hier nur Set-Teile.
  p.set('exclude_manual','1');
  // in_sets ist serverseitig Opt-in (kostet bei 380 Sets rund 155 ms und 2 MB).
  // Nur die Tabellenansicht hat eine Spalte dafür, die Kachel nicht.
  if (G('parts-view').value === 'table') p.set('with_sets','1');
  p.set('page', page);
  p.set('page_size', PARTS_PAGE_SIZE);
  addScopeParam(p, 'parts');
  return p;
}

/** Vollständiger Neuaufbau — bei jedem Filter-, Such- oder Moduswechsel. */
async function loadPartsData(){
  _partsGen++;
  _partsPage = 0; _partsShown = 0; _partsTotal = 0;
  _partsDone = false; _partsLoading = false; _partsLastColor = null;

  const main = G('parts-main');
  main.innerHTML = ladeAnzeige(t('parts.loading'));
  await loadPartsPage(true);
}

/** Nächste Seite holen und anhängen. */
async function loadPartsPage(isFirst){
  if (_partsLoading || _partsDone) return;
  _partsLoading = true;
  const gen  = _partsGen;
  const page = _partsPage + 1;

  let d;
  try {
    d = await (await fetch('/api/v1/parts?' + partsParams(page))).json();
  } catch (_) {
    _partsLoading = false;
    if (isFirst) G('parts-main').innerHTML =
      `<div class="no-parts"><div class="icon">⚠️</div><h3>${t('settings.error')}</h3></div>`;
    return;
  }
  // Antwort einer inzwischen verworfenen Filterkombination — verwerfen.
  if (gen !== _partsGen) { _partsLoading = false; return; }

  const parts = d.parts || [];
  _partsTotal = d.total ?? _partsTotal;
  _partsPage  = page;

  if (isFirst && !parts.length){
    G('parts-main').innerHTML =
      // Dasselbe Ziegel-Symbol wie im Reiter „Teile" statt des Puzzleteils —
      // ein Puzzle hat mit LEGO nichts zu tun und passte nicht zur Navigation.
      `<div class="no-parts"><div class="icon">${partsIconLarge()}</div><h3>${t('parts.none_found')}</h3>` +
      `<p>${allSets.length ? t('parts.hint_import') : t('parts.hint_add_sets')}</p></div>`;
    _partsDone = true; _partsLoading = false;
    return;
  }

  if (isFirst) preparePartsShell();
  appendParts(parts);

  _partsShown += parts.length;
  // Fertig, wenn alles da ist oder der Server weniger als eine volle Seite liefert.
  if (parts.length < PARTS_PAGE_SIZE || (_partsTotal && _partsShown >= _partsTotal)) _partsDone = true;
  updatePartsSentinel();
  _partsLoading = false;

  // Füllt die erste Seite den Bildschirm nicht aus, gäbe es kein Scroll-Ereignis
  // und der Sentinel bliebe für immer sichtbar. Dann direkt nachlegen.
  if (!_partsDone && isFirst) requestAnimationFrame(maybeLoadMoreParts);
}

/** Grundgerüst je nach Ansichtsmodus anlegen (einmal pro Neuaufbau). */
function preparePartsShell(){
  const main = G('parts-main');
  if (G('parts-view').value === 'table'){
    main.innerHTML =
      `<div class="tw"><table class="dt"><thead><tr>` +
        `<th>${t('col.image_th')}</th><th>${t('col.part_nr')}</th><th>${t('col.name')}</th>` +
        `<th>${t('col.color')}</th><th>${t('col.category')}</th><th>${t('detail.qty')}</th>` +
        `<th>${t('col.sets')}</th>` +
      `</tr></thead><tbody class="parts-body"></tbody></table></div>`;
  } else {
    main.innerHTML = `<div class="parts-list"></div>`;
  }
  // parts-list und parts-body sind Kinder von #parts-main und werden bei jedem
  // Neuaufbau ersetzt — deshalb Klassen statt IDs. Der Sentinel steht dagegen
  // statisch in index.html (wie cat-sentinel) und überlebt den Moduswechsel.
  bindPartsSentinel();
}

/** Eine Seite an die bestehende Darstellung anhängen. */
function appendParts(parts){
  if (G('parts-view').value === 'table'){
    const tb = G('parts-main').querySelector('tbody.parts-body');
    if (!tb) return;
    tb.insertAdjacentHTML('beforeend', parts.map(partsTableRow).join(''));
    if (typeof observeLazyImages === 'function') observeLazyImages(tb);
    if (typeof window.__bimLabelTables === 'function') window.__bimLabelTables(tb.closest('table'));
    return;
  }

  const list = G('parts-main').querySelector('.parts-list');
  if (!list) return;

  // Nach Farbe gruppieren — der Server liefert bereits farbsortiert.
  const groups = [];
  for (const p of parts){
    // Gruppiert wird über den ENGLISCHEN Namen — er ist der stabile Schlüssel
    // aus der Datenbank. Übersetzt wird erst die Überschrift beim Zeichnen.
    const key = p.color_name || 'Unbekannt';
    const last = groups[groups.length - 1];
    if (last && last.color === key) last.parts.push(p);
    else groups.push({ color: key, hex: p.color_hex, parts: [p] });
  }

  let html = '';
  for (const g of groups){
    // Setzt die Gruppe die letzte der vorigen Seite fort? Dann in deren Raster
    // einhängen statt eine zweite Überschrift derselben Farbe zu erzeugen.
    if (g.color === _partsLastColor){
      const lastGrid = list.querySelector('.parts-group:last-child .parts-grid');
      if (lastGrid){
        lastGrid.insertAdjacentHTML('beforeend', g.parts.map(partsCard).join(''));
        bumpGroupCount(lastGrid.closest('.parts-group'), g.parts.length);
        if (typeof observeLazyImages === 'function') observeLazyImages(lastGrid);
        continue;
      }
    }
    html += `<div class="parts-group" data-count="${g.parts.length}">
      <div class="group-hd">
        <div class="color-dot" style="width:18px;height:18px;background:${escHex(g.hex, 'var(--s300)')}"></div>
        <span class="group-title">${esc(colorName(g.color))}</span>
        <span class="group-sub">${g.parts.length} ${t('parts.stat.types')}</span>
      </div>
      <div class="parts-grid">${g.parts.map(partsCard).join('')}</div>
    </div>`;
    _partsLastColor = g.color;
  }
  if (html){
    list.insertAdjacentHTML('beforeend', html);
    if (typeof observeLazyImages === 'function') observeLazyImages(list);
  }
  if (groups.length) _partsLastColor = groups[groups.length - 1].color;
}

/**
 * Zähler in der Gruppenüberschrift hochsetzen.
 * Ohne das stünde dort die Anzahl der Karten aus der ERSTEN Seite, obwohl die
 * Gruppe inzwischen weitergewachsen ist.
 */
function bumpGroupCount(groupEl, add){
  if (!groupEl) return;
  const n = (parseInt(groupEl.dataset.count) || 0) + add;
  groupEl.dataset.count = n;
  const sub = groupEl.querySelector('.group-sub');
  if (sub) sub.textContent = `${n} ${t('parts.stat.types')}`;
}

/**
 * Ersatzteil-Plakette. Sets enthalten ein Tütchen Ersatzteile; Rebrickable
 * kennzeichnet sie.
 *
 * Der Text `parts.spare_tag` liegt seit jeher in beiden Sprachdateien —
 * gezeichnet hat ihn nie jemand. Der Grund stand im Feld selbst: `is_spare`
 * kam in vier Schreibweisen an, und die naheliegende Prüfung wäre falsch
 * gewesen, weil der Server "0" als ZEICHENKETTE lieferte und die in
 * JavaScript WAHR ist — jedes Teil wäre als Ersatzteil markiert worden.
 *
 * Seit der Server die Schreibweisen an einer Stelle liest (istErsatzteil() in
 * utils/validate.ts), ist es ein echter Wahrheitswert und `p.is_spare` genügt.
 */
function ersatzteilPlakette(p){
  return p.is_spare ? `<span class="spare-tag">${esc(t('parts.spare_tag'))}</span>` : '';
}

function partsCard(p){
  // data-orig speist den Zoom (11-actions.js, openImageLightboxFromEl):
  // ÜBER den Server-Proxy in voller Auflösung (imgUrl(fullUrl(...), false)),
  // nicht mehr die rohe CDN-Adresse direkt im Browser. Anders als bei Sets
  // bewusst so — auf Nutzerwunsch soll auch das Detailbild der Teile über
  // das Backend laufen, nicht am Server vorbei direkt zum CDN.
  const rawSrc = p.image_local||p.image_url||'';
  // Die Kachel oeffnet den Detail-Dialog (Marcos Wunsch). Bis hierher war sie
  // tot: Anders als bei manuell erfassten Teilen gab es zu einem Teil aus einem
  // Set nichts zu sehen — kein Bild in voller Groesse, keine Angabe, aus
  // welchem Set es stammt.
  return `<div class="part-card" style="cursor:pointer" data-click="openSetItemDetail" data-arg="part" data-arg2="${escJs(p.part_number)}" data-arg3="${p.color_id||0}">
    <img src="${escUrl(imgUrl(thumbUrl(p.image_local||p.image_url)||p.image_local||p.image_url||'', true)||'')}" class="part-img" loading="lazy" decoding="async" data-fade="1" data-orig="${escUrl(rawSrc ? imgUrl(fullUrl(rawSrc), false) : '')}" />
    <div class="part-img-ph" style="display:none">${partsIconLarge()}</div>
    <div class="part-num" title="${esc(p.part_number)}">${esc(p.bl_part_number||p.part_number)}</div>
    <div class="part-name">${esc(p.part_name)||'—'}</div>
    <div class="part-color"><div class="color-dot" style="background:${escHex(p.color_hex, 'var(--s300)')}"></div>${esc(colorName(p.color_name))}</div>
    <div class="part-qty">${(p.total_quantity||0).toLocaleString(locale())}×</div>
    ${ersatzteilPlakette(p)}
  </div>`;
}

function partsTableRow(p){
  // Dieselbe Handlung wie auf der Kachel — eine Ansicht darf nicht koennen,
  // was die andere nicht kann. Genau daran ist in diesem Projekt schon mehrfach
  // etwas auseinandergelaufen.
  return `<tr style="cursor:pointer" data-click="openSetItemDetail" data-arg="part" data-arg2="${escJs(p.part_number)}" data-arg3="${p.color_id||0}">
    <td><img src="${escUrl(imgUrl(thumbUrl(p.image_local||p.image_url)||p.image_local||p.image_url||'', true)||'')}" loading="lazy" decoding="async" data-onerror="clear" style="width:36px;height:36px;object-fit:contain;background:var(--s50);border-radius:5px" /></td>
    <td><span style="font-family:var(--mono);font-size:.77rem;color:var(--b600)" title="${esc(p.part_number)}">${esc(p.bl_part_number||p.part_number)}</span></td>
    <td style="max-width:200px">${esc(p.part_name)||'—'} ${ersatzteilPlakette(p)}</td>
    <td><div style="display:flex;align-items:center;gap:5px"><div class="color-dot" style="background:${escHex(p.color_hex, 'var(--s300)')}"></div>${esc(colorName(p.color_name))}</div></td>
    <td>${esc(catLabel(p.category_name))}</td>
    <td><span style="font-family:var(--mono);font-weight:600;color:var(--b700)">${(p.total_quantity||0).toLocaleString(locale())}</span></td>
    <td style="font-size:.75rem;color:var(--mut)">${esc((p.in_sets||'').replace(/,/g,', '))}</td>
  </tr>`;
}

/** Ladehinweis bzw. Abschlusszeile unter der Liste. */
function updatePartsSentinel(){
  const s = G('parts-sentinel');
  if (!s) return;
  if (_partsDone){
    s.innerHTML = _partsTotal
      ? `<div style="text-align:center;color:var(--mut);font-size:.8rem;padding:1rem">${_partsTotal.toLocaleString(locale())} ${t('parts.stat.types')}</div>`
      : '';
  } else {
    s.innerHTML = ladeAnzeige('', { stil: 'padding:1rem' });
  }
}

let _partsIO = null;
function bindPartsSentinel(){
  const s = G('parts-sentinel');
  if (!s) return;
  if (typeof IntersectionObserver !== 'undefined'){
    if (_partsIO) _partsIO.disconnect();
    _partsIO = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) maybeLoadMoreParts(); },
      { rootMargin: '600px' }   // Vorlauf, damit vor dem Sichtbarwerden geladen wird
    );
    _partsIO.observe(s);
  } else if (!window._partsScrollBound){
    // Fallback für Browser ohne IntersectionObserver
    window._partsScrollBound = true;
    window.addEventListener('scroll', () => {
      const el = G('parts-sentinel');
      if (el && el.getBoundingClientRect().top < window.innerHeight + 600) maybeLoadMoreParts();
    }, { passive: true });
  }
}

function maybeLoadMoreParts(){
  if (_partsDone || _partsLoading) return;
  // Nur laden, wenn der Teile-Tab auch sichtbar ist.
  const tab = G('tab-parts');
  if (tab && !tab.classList.contains('active')) return;
  loadPartsPage(false);
}

G('parts-search').addEventListener('input', ()=>{ clearTimeout(G('parts-search')._t); G('parts-search')._t=setTimeout(loadPartsData,350); });
G('parts-spare').addEventListener('change', loadPartsData);
G('parts-view').addEventListener('change', loadPartsData);



// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  setCatFilter,
  setColorFilter,
});
