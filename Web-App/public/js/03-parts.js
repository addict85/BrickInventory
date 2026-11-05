// Der Reiter Teile: Teile aus Sets (seitenweise) und die manuell erfassten
// Teile samt Erfassen, Farbwahl und CSV-Import — beide Listen teilen Filter
// und Leerzustand.
import { abonniere } from './00-ereignisse.js';
import { ladeAnzeige, skelettKacheln, listeLadefehler, teileAufschluesselung, condBadges, ownerBadges, schliesseErfassen } from './01-bausteine.js';
import { registerActions, echt } from './00-registry.js';
import { colorName, locale, t, tRaw } from '../i18n.js';
import { bildTag, G, api, escHex, escHtml, escJs, fmtBig, fullUrl, imgUrl, leerZustand, observeLazyImages, platzhalterInhalt, thumbUrl, zuruecksetzenKnopf, TRASH_ICON_SVG, betragAusFeld, fmtN, hexZiffern, toast, aktiverReiter } from './01-core.js';
import { addScopeParam, addLagerParam, scopeQuery } from './14-scope.js';
import { allSets, CURRENCY } from './00-zustand.js';
import { esc } from './00-escapen.js';
import { confirmDelete } from './01-rueckfrage.js';
import { csvImportStatus, manuellQuery, manuelleTabelle, preisHerkunftHinweis, tabellenAnsicht } from './06-minifigs.js';
import { geloeschtMitRueckgaengig } from './20-papierkorb.js';
import { leereLagerortFeld, selectedOwner, selectedStorage } from './02-konten-orte.js';
import { loadFinance } from './04-finance.js';

// ── PARTS ─────────────────────────────────────────────
let partsColors=[], partsCats=[];
/** @type {string | null} */
let activeColor = null;
/** @type {string | null} */
let activeCat=null;
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
  // Wie die Kachel der Sammlung: Teile aus Sets und einzeln erfasste zusammen.
  const einzeln=s.manual_parts||0;
  G('ps-total').textContent=fmtBig((s.total_parts||0)+einzeln);
  G('ps-total-sub').textContent=teileAufschluesselung(s.total_parts||0, einzeln);
  G('ps-unique').textContent=fmtBig(s.unique_parts||0);
  G('ps-colors').textContent=s.unique_colors||0;
}

async function loadPartsFilters(){
  const [cd,catd]=await Promise.all([api('GET','/v1/parts/colors'+scopeQuery('parts')),api('GET','/v1/parts/categories'+scopeQuery('parts'))]);
  partsColors=cd.colors||[]; partsCats=catd.categories||[];
  zeichneTeileFilter();
}

/**
 * Farbe und Kategorie als Auswahlfelder in der Filterleiste. Sie gelten wie
 * Suche und Konto für BEIDE Listen; die manuellen Teile bringen ihre Farben
 * und Kategorien deshalb mit ein. Ohne Auswahl bleibt ein Feld verborgen.
 */
export function zeichneTeileFilter(){
  const farben = new Map(partsColors.map(c => [c.color_name, `${colorName(c.color_name)} (${c.unique_parts} ${t('parts.stat.types')})`]));
  const kategorien = new Map(partsCats.map(c => [String(c.category_name), c.label || String(c.category_name)]));
  for (const p of manualPartsCache) {
    if (p.color_name && !farben.has(p.color_name)) farben.set(p.color_name, colorName(p.color_name));
    if (p.category_name != null && p.category_name !== '' && !kategorien.has(String(p.category_name)))
      kategorien.set(String(p.category_name), catLabel(p.category_name));
  }
  fuelleFilter('parts-color', t('parts.filter.all_colors'), farben, activeColor);
  fuelleFilter('parts-cat', t('parts.filter.all_categories'), kategorien, activeCat);
}

function fuelleFilter(id, alle, eintraege, gewaehlt){
  const el = G(id);
  if (!el) return;
  // Eine gewählte Farbe bleibt auswählbar, auch wenn ein anderer Filter sie gerade ausblendet.
  if (gewaehlt && !eintraege.has(gewaehlt)) eintraege.set(gewaehlt, gewaehlt);
  el.innerHTML = `<option value="">${esc(alle)}</option>` +
    [...eintraege].map(([wert, text]) => `<option value="${escHtml(wert)}">${esc(text)}</option>`).join('');
  el.value = gewaehlt || '';
  el.style.display = eintraege.size ? '' : 'none';
}

function setColorFilter(){ activeColor=G('parts-color').value||null; loadPartsData(); renderManualParts(); }
function setCatFilter(){ activeCat=G('parts-cat').value||null; loadPartsData(); renderManualParts(); }

/** Passt ein manuell erfasstes Teil zu Farbe und Kategorie der Filterleiste? */
export function teilPasstZumFilter(p){
  if (activeColor && p.color_name !== activeColor) return false;
  if (activeCat && String(p.category_name ?? '') !== String(activeCat)) return false;
  return true;
}

/** @type {boolean | null} */
let _setTeileLeer = null;   // null: noch nicht geladen
let _manuelleLeer = null;

/**
 * Ein Leerzustand für den ganzen Reiter: Er steht nur da, wenn weder manuell
 * erfasste Teile noch Teile aus Sets zu sehen sind. Eine leere Teilliste
 * verschwindet stumm, solange die andere etwas zeigt.
 */
export function teileLeerAbgleichen(manuelleLeer){
  if (manuelleLeer !== undefined) _manuelleLeer = manuelleLeer;
  const box = G('manual-parts-box');
  // Erst sichtbar, wenn die Liste geladen ist und etwas zeigt: Vorher stand
  // die leere Box „Manuell erfasste Teile“ über dem Skelett.
  if (box) box.style.display = _manuelleLeer === false ? '' : 'none';
  if (_setTeileLeer !== true) return;
  const main = G('parts-main');
  if (_manuelleLeer === false) { main.innerHTML = ''; return; }
  const q = G('parts-search')?.value.trim() || '';
  const gefiltert = !!(activeColor || activeCat || q || G('parts-spare')?.value);
  // Wie in allen Listen: „Noch keine …“ ohne Filter, sonst „Keine Treffer“.
  main.innerHTML = gefiltert
    ? leerZustand({ ico: 'suche', titel: q ? tRaw('common.no_hits', { query: q }) : tRaw('parts.no_filter_match'),
                    knopf: zuruecksetzenKnopf('parts') })
    : leerZustand({ ico: 'teil', titel: tRaw('parts.empty'),
                    text: tRaw(allSets.length ? 'parts.hint_import' : 'parts.none_manual_hint'),
                    knopf: { text: tRaw('parts.add_title'), click: 'oeffneErfassen', arg: 'part' } });
}

/** Suche, Ersatzteil-, Farb- und Kategoriefilter leeren (Knopf im Leerzustand). */
export function teileFilterZuruecksetzen(){
  activeColor = null; activeCat = null;
  for (const id of ['parts-search', 'parts-spare', 'parts-color', 'parts-cat']) { const el = G(id); if (el) el.value = ''; }
  teileFilterGeaendert();
}
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
  const ordnung = G('parts-ordnung').value;
  if (ordnung !== 'farbe') p.set('ordnung', ordnung);
  // Manuell erfasste Teile haben ihren eigenen Bereich oben — hier nur Set-Teile.
  p.set('exclude_manual','1');
  // in_sets ist serverseitig Opt-in (kostet bei 380 Sets rund 155 ms und 2 MB).
  // Nur die Tabellenansicht hat eine Spalte dafür, die Kachel nicht.
  if (G('parts-view').value === 'table') p.set('with_sets','1');
  p.set('page', page);
  p.set('page_size', String(PARTS_PAGE_SIZE));
  addScopeParam(p, 'parts');
  addLagerParam(p, 'parts');
  return p;
}

/** Vollständiger Neuaufbau — bei jedem Filter-, Such- oder Moduswechsel. */
async function loadPartsData(){
  _partsGen++;
  _partsPage = 0; _partsShown = 0; _partsTotal = 0;
  _partsDone = false; _partsLoading = false; _partsLastColor = null;
  _setTeileLeer = null;

  const main = G('parts-main');
  main.innerHTML = skelettKacheln(12, t('parts.loading'), 'teil');
  await loadPartsPage(true);
}

/** Nächste Seite holen und anhängen. */
async function loadPartsPage(isFirst){
  if (_partsLoading || _partsDone) return;
  _partsLoading = true;
  const gen  = _partsGen;
  const page = _partsPage + 1;

  const d = await api('GET', '/v1/parts?' + partsParams(page));
  // Antwort einer inzwischen verworfenen Filterkombination — verwerfen.
  if (gen !== _partsGen) { _partsLoading = false; return; }
  if (listeLadefehler(G('parts-main'), d, { erneut: 'loadParts', behalten: !isFirst })) {
    _partsLoading = false;
    return;
  }

  const parts = d.parts || [];
  _partsTotal = d.total ?? _partsTotal;
  _partsPage  = page;

  if (isFirst && !parts.length){
    _setTeileLeer = true;
    teileLeerAbgleichen();
    _partsDone = true; _partsLoading = false;
    updatePartsSentinel();
    return;
  }

  if (isFirst) { _setTeileLeer = false; teileLeerAbgleichen(); preparePartsShell(); }
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
  // Ungruppiert: dasselbe Raster ohne Farbkacheln, die Reihenfolge kommt vom Server.
  if (G('parts-ordnung').value !== 'farbe'){
    list.insertAdjacentHTML('beforeend', parts.map(partsCard).join(''));
    if (typeof observeLazyImages === 'function') observeLazyImages(list);
    return;
  }

  // Nach Farbe gruppieren — der Server liefert bereits farbsortiert.
  const groups = [];
  for (const p of parts){
    // Gruppiert wird über den ENGLISCHEN Namen — er ist der stabile Schlüssel
    // aus der Datenbank. Übersetzt wird erst die Überschrift beim Zeichnen.
    const key = p.color_name || tRaw('common.unknown');
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
        <div class="color-dot gross" data-farbe="${escHex(g.hex, 'var(--s300)')}"></div>
        <span class="group-title">${esc(colorName(g.color))}</span>
        <span class="group-sub">${t('parts.group_types', { n: g.parts.length })}</span>
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
  if (sub) sub.textContent = tRaw('parts.group_types', { n });
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
 * src/infra/validate.ts), ist es ein echter Wahrheitswert und `p.is_spare` genügt.
 */
function ersatzteilPlakette(p){
  return p.is_spare ? `<span class="spare-tag">${esc(t('parts.spare_tag'))}</span>` : '';
}

/** Alternativtext eines Teilbilds: Name und Farbe, wie sie auf der Kachel stehen. */
function teilAlt(p){ return [p.part_name || p.part_number, p.color_name ? colorName(p.color_name) : ''].filter(Boolean).join(', '); }

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
  return `<div class="part-card" data-stil="cursor:pointer" tabindex="0" role="button" data-click="openSetItemDetail" data-arg="part" data-arg2="${escJs(p.part_number)}" data-arg3="${p.color_id||0}">
    ${rawSrc ? bildTag({ src: imgUrl(thumbUrl(rawSrc)||rawSrc, true), alt: teilAlt(p), klasse: 'part-img', fade: true, orig: imgUrl(fullUrl(rawSrc), false), ph: 'teil' })
             : `<span class="bild-ph part-img" role="img" aria-label="${esc(teilAlt(p))}">${platzhalterInhalt('teil')}</span>`}
    <div class="part-num" title="${esc(p.part_number)}">${esc(p.bl_part_number||p.part_number)}</div>
    <div class="part-name">${esc(p.part_name)||'—'}</div>
    <div class="part-color"><div class="color-dot" data-farbe="${escHex(p.color_hex, 'var(--s300)')}"></div>${esc(colorName(p.color_name))}</div>
    <div class="part-qty">×${(p.total_quantity||0).toLocaleString(locale())}</div>
    ${ersatzteilPlakette(p)}
  </div>`;
}

function partsTableRow(p){
  // Dieselbe Handlung wie auf der Kachel — eine Ansicht darf nicht koennen,
  // was die andere nicht kann. Genau daran ist in diesem Projekt schon mehrfach
  // etwas auseinandergelaufen.
  return `<tr data-stil="cursor:pointer" tabindex="0" data-click="openSetItemDetail" data-arg="part" data-arg2="${escJs(p.part_number)}" data-arg3="${p.color_id||0}">
    <td>${(p.image_local||p.image_url) ? bildTag({ src: imgUrl(thumbUrl(p.image_local||p.image_url)||p.image_local||p.image_url, true), alt: '', klasse: 'bild-klein', ph: 'teil' })
                                       : `<span class="bild-ph bild-klein" aria-hidden="true">${platzhalterInhalt('teil')}</span>`}</td>
    <td><span data-stil="font-family:var(--mono);font-size:var(--fs-1);color:var(--b600)" title="${esc(p.part_number)}">${esc(p.bl_part_number||p.part_number)}</span></td>
    <td data-stil="max-width:200px">${esc(p.part_name)||'—'} ${ersatzteilPlakette(p)}</td>
    <td><div data-stil="display:flex;align-items:center;gap:5px"><div class="color-dot" data-farbe="${escHex(p.color_hex, 'var(--s300)')}"></div>${esc(colorName(p.color_name))}</div></td>
    <td>${esc(catLabel(p.category_name))}</td>
    <td><span data-stil="font-family:var(--mono);font-weight:600;color:var(--b700)">${(p.total_quantity||0).toLocaleString(locale())}</span></td>
    <td data-stil="font-size:var(--fs-1);color:var(--mut)">${esc((p.in_sets||'').replace(/,/g,', '))}</td>
  </tr>`;
}

/** Ladehinweis bzw. Abschlusszeile unter der Liste. */
function updatePartsSentinel(){
  const s = G('parts-sentinel');
  if (!s) return;
  if (_partsDone){
    s.innerHTML = _partsTotal
      ? `<div data-stil="text-align:center;color:var(--mut);font-size:var(--fs-2);padding:1rem">${_partsTotal.toLocaleString(locale())} ${t('parts.stat.types')}</div>`
      : '';
  } else {
    s.innerHTML = ladeAnzeige('', { stil: 'padding:1rem' });
  }
}

/** @type {IntersectionObserver | null} */
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

/**
 * Suchtext — und zwar fuer BEIDE Listen des Reiters.
 *
 * Marcos Befund vom 20.10.: „Wenn ich im Filter z.b. nach 3001 suche passiert
 * nichts." Hier stand allein loadPartsData(), also nur die Wand der Set-Teile.
 * Die manuell erfassten Kacheln darueber blieben unberuehrt, obwohl die
 * Filterleiste ausdruecklich UEBER ihnen steht (public/index.html, geprueft in
 * test/tab-layout.test.js).
 *
 * Eine Entprellung fuer beide: Zwei Zeitgeber auf demselben Feld waeren zwei
 * Stellen, an denen die naechste Liste vergessen wird.
 */
function teileFilterGeaendert() {
  loadPartsData();
  loadManualParts();
}
G('parts-search').addEventListener('input', ()=>{ clearTimeout(G('parts-search')._t); G('parts-search')._t=setTimeout(teileFilterGeaendert,350); });
G('parts-spare').addEventListener('change', loadPartsData);
// Die Reihenfolge ist eine Vorliebe, kein Filter: Sie bleibt im Browser stehen.
const TEILE_ORDNUNG_KEY = 'bim_teile_ordnung';
try {
  const gemerkt = localStorage.getItem(TEILE_ORDNUNG_KEY);
  if (gemerkt && [...G('parts-ordnung').querySelectorAll('option')].some(o => o.value === gemerkt)) G('parts-ordnung').value = gemerkt;
} catch (_) { /* ohne Speicher gilt die Vorgabe */ }
G('parts-ordnung').addEventListener('change', () => {
  try { localStorage.setItem(TEILE_ORDNUNG_KEY, G('parts-ordnung').value); } catch (_) { /* nur Komfort */ }
  loadPartsData();
});
/**
 * Der Ansichtsumschalter — fuer BEIDE Listen des Reiters.
 *
 * Marcos Befund vom 20.10.: „Wenn ich bei den Teilen auf Tabelle umschalte,
 * werden nur die Teile aus den Sets als Tabelle angezeigt. Die manuell
 * erfassten sind immer Kacheln." Hier stand allein loadPartsData() — derselbe
 * halbe Anschluss wie beim Suchtext darueber.
 *
 * Neu GEZEICHNET, nicht neu geladen: Die Wand der Set-Teile braucht in der
 * Tabellenansicht andere Daten (`with_sets=1`, siehe partsQuery) und muss
 * deshalb neu abrufen. Die manuelle Liste braucht dieselben Daten in einer
 * anderen Form — ein zweiter Abruf waere nur Wartezeit.
 */
function teileAnsichtGeaendert() {
  loadPartsData();
  renderManualParts();
}
G('parts-view').addEventListener('change', teileAnsichtGeaendert);


// ── MANUAL PARTS ─────────────────────────────────────────────────────────────
let manualPartsCache = [];
/** Die zuletzt geladenen manuell erfassten Teile (nur lesen). */
export function manuelleTeile() { return manualPartsCache; }

export async function loadManualParts() {
  const [d, v] = await Promise.all([
    api('GET', '/v1/parts/manual'+manuellQuery('parts', 'parts-search')),
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

export function renderManualParts() {
  const el = G('manual-parts-list');
  zeichneTeileFilter();
  const teile = manualPartsCache.filter(teilPasstZumFilter);
  teileLeerAbgleichen(!teile.length);
  if (!teile.length) { el.innerHTML = ''; return; }
  if (tabellenAnsicht('parts-view')) {
    el.innerHTML = manuelleTabelle(teile, 'part');
    if (typeof window.__bimLabelTables === 'function')
      window.__bimLabelTables(el.querySelector('table'));
    return;
  }
  el.innerHTML = `<div class="man-grid">
    ${teile.map(p => {
      // War: p.image_local || p.image_url roh, ohne Vorschau und ohne Proxy —
      // einzige Stelle im ganzen Projekt, die das CDN-Bild direkt und in
      // voller Auflösung in eine Kachel geladen hat. Jetzt wie überall sonst:
      // Vorschau über den Server-Proxy.
      const imgSrc = imgUrl(thumbUrl(p.image_local || p.image_url) || p.image_local || p.image_url || '', true);
      const img = imgSrc
        ? bildTag({ src: imgSrc, alt: [p.part_name || p.part_number, p.color_name ? colorName(p.color_name) : ''].filter(Boolean).join(', '), klasse: 'man-tile-img', ph: 'teil' })
        : `<span class="bild-ph man-tile-img" role="img" aria-label="${esc(p.part_name || p.part_number)}">${platzhalterInhalt('teil')}</span>`;
      const colorRow = p.color_name
        ? `<div class="man-tile-color">${p.color_hex ? `<span class="man-tile-swatch" data-farbe="${escHex(p.color_hex, 'var(--s300)')}"></span>` : ''}${esc(colorName(p.color_name))}</div>`
        : '';
      // Wie bei den Minifiguren: mengengewichtet über die Erfassungen.
      const partPrice = p.avg_purchase_price ?? p.unit_price ?? p.purchase_price;
      const priceStr = partPrice!=null ? fmtN(partPrice, CURRENCY) : '—';
      const condBadge = condBadges(p);
      return `<div class="man-tile" tabindex="0" role="button" data-click="openManDetail" data-arg="part" data-arg2="${esc(p.part_number)}" data-arg3="${p.color_id||0}" data-stil="cursor:pointer">
        <div class="ca"><span class="delbtn" data-click="deleteManualPartStop"${echt()} aria-hidden="true" data-arg="${esc(p.part_number)}" data-arg2="${p.color_id||0}" data-arg3="${p.user_id||''}" title="${esc(t('parts.delete.title'))}">${TRASH_ICON_SVG}</span></div>
        ${img}
        <div class="man-tile-num" title="${esc(p.part_number)}">${esc(p.bl_part_number||p.part_number)}</div>
        <div class="man-tile-name">${esc(p.part_name) || '—'}</div>
        ${colorRow}
        <div data-stil="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:2px">
          <span class="qbadge">×${p.quantity}</span>${condBadge}${ownerBadges(p)}
        </div>
        <div class="preis man-preis">${priceStr}</div>
      </div>`;
    }).join('')}
  </div>`;
}

/** @param {number} [owner] Besitzer der Karte — siehe deleteManualPart. */
export async function updateManualPart(partNumber, colorId, body, owner) {
  const d = await api('PUT', `/v1/parts/${encodeURIComponent(partNumber)}/${colorId}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`, body);
  if (d.success) { toast(tRaw('settings.saved'),'success'); loadManualParts(); if(aktiverReiter()==='finance') loadFinance(); }
  else toast(d.error||t('settings.error'),'error');
}

/**
 * @param {string} partNumber
 * @param {number} colorId
 * @param {number|string} [owner]  Besitzer der KARTE. Im Haushalt zeigt der
 *   manuelle Bereich die Einträge aller Konten mit Plakette und Papierkorb;
 *   ohne diese Angabe löschte der Server immer die Zeile des Aufrufers —
 *   geklickt war die fremde Karte, weg war die eigene, und die Antwort sagte
 *   „success". Begründung und Messung in src/haushalt/haushalt.ts.
 */
export async function deleteManualPart(partNumber, colorId, owner) {
  if (!await confirmDelete(tRaw('parts.delete.title'), t('gallery.delete.text',{name:partNumber}), 'teil')) return false;
  const d = await api('DELETE', `/v1/parts/${encodeURIComponent(partNumber)}/${colorId}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`);
  if (d.success) { geloeschtMitRueckgaengig(tRaw('parts.deleted'), d); loadManualParts(); return true; }
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
    + _brickColors.map(c=>`<option value="${c.id}" data-name="${esc((c.name||'').replace(/"/g,'&quot;'))}" data-hex="${hexZiffern(c.hex)}">${esc(colorName(c.name))}</option>`).join('');
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
  const preis = betragAusFeld('ap-price-inline');
  if (!preis.ok) return;
  const btn = G('btn-add-part'); btn.disabled=true; btn.textContent='…';
  res.style.color='var(--mut)'; res.textContent=tRaw('adding.progress');
  const d = await api('POST','/v1/parts',{
    part_number: num, color_id: colorId, color_name: colorName, color_hex: colorHex,
    quantity: parseInt(G('ap-qty-inline')?.value)||1,
    unit_price: preis.wert,
    condition: G('ap-condition')?.value || 'N',
    owner_user_id: selectedOwner('ap-owner'),
    storage: selectedStorage('ap-storage'),
  });
  btn.disabled=false; btn.textContent=tRaw('gallery.add.submit');
  if(d.success){
    const hinweisT = preisHerkunftHinweis(d.price_from_condition);
    res.style.color='var(--g700)';
    res.textContent=`${d.part_number} ${d.action==='added'?t('common.added'):t('common.updated')}`
      + (hinweisT ? ` — ${hinweisT}` : '');
    schliesseErfassen('part'); toast(res.textContent.replace(/^\u2705\s*/, ''), 'success');
    G('ap-num-inline').value=''; G('ap-qty-inline').value='1'; G('ap-price-inline').value='';
    leereLagerortFeld('ap-storage');
    if(colorSel) colorSel.selectedIndex=0;
    loadManualParts();
    // Siehe die Figuren-Erfassung darueber: ein Satz braucht laenger als ein
    // Haekchen.
    setTimeout(()=>{ res.textContent=''; }, hinweisT ? 9000 : 3000);
  } else { res.style.color='var(--r500)'; res.textContent=d.error||t('settings.error'); }
});

// CSV import
async function importPartsCsv() {
  const fi = G('part-csv-file');
  if (!fi.files[0]) return;
  const fd = new FormData(); fd.append('file', fi.files[0]);
  csvImportStatus('part-csv-status', 'running', t('import.running'));
  try {
    const d = await api('POST', '/v1/parts/import/csv', fd);
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

G('btn-csv-template').onclick = (e) => {
  e.preventDefault();
  const csv = 'part_number,quantity,color_id,color_name,unit_price,condition,acquired_at\n3001,5,4,Red,,N,2024-01-15\n3003,2,0,White,0.15,U,\n';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'parts-template.csv';
  a.click();
};

abonniere('bestandGeaendert', () => { loadParts(); loadManualParts(); });

// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  loadParts,
  setCatFilter,
  setColorFilter,
  importPartsCsv,
  updateColorDot,
});
