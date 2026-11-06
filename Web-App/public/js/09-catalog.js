// Der Katalog: Sets suchen, Details zeigen und in die Sammlung übernehmen.
import { detailZeile, ladeAnzeige, listeLadefehler } from './01-bausteine.js';
import { registerActions } from './00-registry.js';
import { locale, t, tRaw} from '../i18n.js';
import { fehlerMeldung, api } from './01-api.js';
import { bildTag, platzhalterInhalt, fullUrl, imgUrl, thumbUrl, setzeDialogbild, PLATZHALTER_SET } from './01-bilder.js';
import { leerZustand, meldeTreffer, ico, G, zuruecksetzenKnopf, alle, eins, setzeHtml, fuegeHtmlEin } from './01-dom.js';
import { betragAusFeld } from './01-formular.js';
import { toast } from './01-meldungen.js';
import { setScrollLabel } from './15-scrollbar.js';
import { loadGallery, loadStats } from './02-gallery.js';
import { _lastImportAt, set_lastImportAt, ME, _settingsCache } from './00-zustand.js';
import { esc, html, ungeprueft } from './00-escapen.js';
import { handleSseEvent, hideProgress, showProgress, streamFertig, streamRequest } from './01-fortschritt.js';
import { leereLagerortFeld, selectedOwner, selectedStorage } from './02-konten-orte.js';

// Datenquelle ist /api/v1/catalog/* (lokale rb_*-Tabellen aus dem täglichen CSV-Sync) — serverseitig
// paginiert, da der Katalog ~25k Sets umfasst.

let _catState = { page: 1, q: '', theme: '', yearFrom: '', yearTo: '', sort: 'year_desc' };
// Infinite Scroll: Generationszähler verwirft späte Antworten nach einem Filterwechsel (gleiches Muster wie
// in der Android-App), _catItems hält die geladenen Sets für In-Place-Updates (owned-Badge nach
// Galerie-Aufnahme).
let _catGen = 0;
// Fensterladen statt Endlos-Scroll: Die Jahresleiste springt mitten in die Liste, und eine angehängte Liste
// hätte darüber und darunter nichts. Ein Block je Seite; geladen wird, was ins Bild kommt, Platzhalter halten
// die Höhe frei.
// Ausführlich: docs/begruendungen/public/js/09-catalog.js.md#cat-limit
const CAT_LIMIT = 60;
let _catTotal = 0;
let _catPageCount = 0;
let _catLoadedPages = new Set();
let _catLoadingPages = new Set();
let _catScrollGebunden = false;
/** @type {import('../../frontend-typen/vertrag').CatalogSetItem[]} */
let _catItems = [];
/** Datenbereich aus /catalog/meta. @type {number | null} */
let _catYearMin = null;
/** @type {number | null} */
let _catYearMax = null;
let _catMetaLoaded = false;
/** Das Set im Detail-Dialog. @type {import('../../frontend-typen/vertrag').CatalogSetDetail | null} */
let _catCurSet = null;
/** Jahr → Zahl der Sets (Etikett am Jahresregler). @type {Record<number, number>} */
let _catYearCounts = {};


export function initCatalog(){
  if (!_catMetaLoaded) {
    _catMetaLoaded = true;
    _bindCatalogControls();
    loadCatalogMeta();
    loadCatalogSets();
  } else {
    // Tab erneut geöffnet: aktuelle Seite neu laden, damit owned-Badges nach Galerie-Änderungen stimmen.
    loadCatalogSets();
  }
}

function _bindCatalogControls(){
  const s = G('cat-search');
  s.addEventListener('input', ()=>{
    clearTimeout(s._t);
    s._t = setTimeout(()=>{ _catState.q = s.value.trim(); _catState.page = 1; loadCatalogSets(); }, 350);
  });
  G('cat-theme').addEventListener('change', ()=>{ _catState.theme = G('cat-theme').value; _catState.page = 1; loadCatalogSets(); });
  G('cat-sort').addEventListener('change',  ()=>{ _catState.sort  = G('cat-sort').value;  _catState.page = 1; loadCatalogSets(); });
  // Jahr-Dropdowns (Präzisionswahl) -> gehen durch den zentralen Setter. Das geänderte Feld gewinnt: die
  // andere Grenze wird bei Bedarf mitgezogen (gleiches Verhalten wie das Klemmen der Slider-Griffe).
  G('cat-year-from').addEventListener('change', ()=>{
    const from = G('cat-year-from').value;
    let to = _catState.yearTo;
    if (from && to && parseInt(from) > parseInt(to)) to = from;
    setCatalogYearRange(from, to);
  });
  G('cat-year-to').addEventListener('change', ()=>{
    const to = G('cat-year-to').value;
    let from = _catState.yearFrom;
    if (to && from && parseInt(to) < parseInt(from)) from = to;
    setCatalogYearRange(from, to);
  });
  // Der Von-Bis-Schieber ist entfallen — gefiltert wird über die beiden Auswahlfelder oben, gesprungen über
  // die Leiste am rechten Rand. Auch der Sentinel des Endlos-Scrolls ist weg: Geladen wird die Seite, die
  // gerade ins Bild kommt (siehe _beobachteSeiten).
  G('cat-modal').addEventListener('click', e=>{ if(e.target===e.currentTarget) closeCatModal(); });
  G('cat-m-add').onclick = addCatalogSetToGallery;
}

async function loadCatalogMeta(){
  const d = await api('GET', '/v1/catalog/meta');
  if (!d.success) return;
  // Themen-Dropdown: Pfadnamen ("Star Wars › UCS") mit Set-Zahl
  const themeEl = G('cat-theme');
  const cur = themeEl.value;
  setzeHtml(themeEl, html`${html`<option value="">${tRaw('catalog.filter.all_themes')}</option>`}${(d.themes||[]).map(th=>html`<option value="${th.id}"${String(th.id)===cur ? ' selected' : ''}>${th.name} (${th.set_count})</option>`)}`);
  // Jahr-Dropdowns (Von/Bis): absteigend von max bis min
  const { year_min: von, year_max: bis } = d;
  if (von && bis) {
    const mk = (/** @type {HTMLElement | null} */ el, /** @type {string} */ placeholderKey, /** @type {string} */ cur)=>{
      let opts = html`<option value="">${tRaw(placeholderKey)}</option>`;
      for (let y = bis; y >= von; y--) {
        opts = html`${opts}${html`<option value="${y}"${String(y)===cur ? ' selected' : ''}>${y}</option>`}`;
      }
      if (el) setzeHtml(el, opts);
    };
    mk(G('cat-year-from'), 'catalog.filter.year_from', _catState.yearFrom);
    mk(G('cat-year-to'),   'catalog.filter.year_to',   _catState.yearTo);
  }
  // Von-Bis-Slider initialisieren
  _catYearCounts = {};
  for (const yc of (d.year_counts||[])) _catYearCounts[yc.year] = yc.n;
  _catYearMin = d.year_min || null; _catYearMax = d.year_max || null;
  _initYearRail();
}

/** Suche, Thema und Jahre leeren; die Sortierung bleibt. */
export function katalogZuruecksetzen(){
  G('cat-search').value = ''; G('cat-theme').value = '';
  _catState.q = ''; _catState.theme = '';
  setCatalogYearRange('', '');
}

/**
 * Zentrale Stelle für Jahresbereichs-Änderungen — hält Dropdowns, Slider und Badge synchron.
 * @param {string} from
 * @param {string} to
 */
function setCatalogYearRange(from, to){
  from = from ? String(from) : '';
  to   = to   ? String(to)   : '';
  // Von > Bis (über die Dropdowns möglich) -> tauschen
  if (from && to && parseInt(from) > parseInt(to)) { const tmp = from; from = to; to = tmp; }
  _catState.yearFrom = from;
  _catState.yearTo   = to;
  _catState.page = 1;
  _syncYearUI();
  loadCatalogSets();
}

/** Die beiden Auswahlfelder auf den Zustand ziehen. */
function _syncYearUI(){
  G('cat-year-from').value = _catState.yearFrom || '';
  G('cat-year-to').value   = _catState.yearTo   || '';
}

/**
 * @param {number} page
 */
function _catQuery(page){
  const p = new URLSearchParams();
  if (_catState.q)        p.set('q', _catState.q);
  if (_catState.theme)    p.set('theme_id', _catState.theme);
  if (_catState.yearFrom) p.set('year_from', _catState.yearFrom);
  if (_catState.yearTo)   p.set('year_to', _catState.yearTo);
  p.set('sort', _catState.sort);
  p.set('page', String(page));
  p.set('page_size', '60');
  return p.toString();
}

/**
 * Liste neu aufbauen: erste Seite laden, den Rest als Platzhalter-Blöcke.
 *
 * Ein Block je Seite über das GANZE Ergebnis — nur so kann die Jahres-Leiste irgendwohin springen, statt zu
 * filtern.
 */
async function loadCatalogSets(){
  const gen = ++_catGen;
  _catLoadedPages = new Set();
  _catLoadingPages = new Set();
  const grid = G('catalog-grid');
  setzeHtml(grid, ladeAnzeige(tRaw('catalog.loading')));
  _catState.page = 1;
  const d = await api('GET', `/v1/catalog/sets?${_catQuery(1)}`);
  if (gen !== _catGen) return;   // inzwischen neuer Filter — Antwort verwerfen
  if (listeLadefehler(grid, d, { erneut: 'loadCatalogSets' })) return;

  _catTotal = d.total || 0;
  _catPageCount = Math.max(1, Math.ceil(_catTotal / CAT_LIMIT));
  _catItems = d.sets || [];
  G('cat-count').textContent = tRaw(_catTotal === 1 ? 'catalog.result_count_one' : 'catalog.result_count', { count: _catTotal.toLocaleString(locale()) });
  meldeTreffer(_catTotal ? G('cat-count').textContent : tRaw('common.no_hits', { query: G('cat-search')?.value.trim() || '' }));

  if (!_catItems.length) {
    // Ohne Filter heisst „leer": der Katalog ist noch nicht abgeglichen.
    const gefiltert = !!(_catState.q || _catState.theme || _catState.yearFrom || _catState.yearTo);
    const ohneSchluessel = !gefiltert && !String(_settingsCache?.rebrickable_api_key || '').trim();
    const leerText = gefiltert ? 'catalog.no_results_hint' : !ME?.isAdmin ? 'catalog.empty_hint_konto'
      : ohneSchluessel ? 'catalog.empty_ohne_schluessel' : 'catalog.empty_hint';
    const leerKnopf = gefiltert ? zuruecksetzenKnopf('catalog')
      : !ME?.isAdmin ? undefined
      : ohneSchluessel ? { text: tRaw('rb_key.banner_link'), click: 'rbHinweisOeffnen', ico: 'schluessel' }
      : { text: tRaw('catalog.zum_abgleich'), click: 'oeffneReiter', arg: 'monitor', ico: 'aktualisieren' };
    setzeHtml(grid, leerZustand({ ico: gefiltert ? 'suche' : 'katalog', titel: tRaw(gefiltert ? 'catalog.no_results' : 'catalog.leer_titel'),
      text: tRaw(leerText), knopf: leerKnopf }));
    setScrollLabel(null);
    return;
  }

  // Ein Block je Seite. Der erste ist gefüllt, die übrigen halten nur Platz.
  let markup = '';
  for (let seite = 1; seite <= _catPageCount; seite++) {
    const anzahl = (seite === _catPageCount) ? (_catTotal - (seite - 1) * CAT_LIMIT) : CAT_LIMIT;
    markup += seite === 1
      ? html`<div class="sgrid cat-page" data-page="1">${ungeprueft(_catItems.map(catCard).join(''))}</div>`
      // Ungeladene Seiten sind EIN leerer Block statt 60 Platzhalterkacheln: Bei 25 000 Sets wären das 25 000
      // Elemente. Die Höhe kommt aus der gemessenen ersten Seite, weil die Spaltenzahl am Fenster hängt.
      // Ausführlich: docs/begruendungen/public/js/09-catalog.js.md#ungeladene-seiten-sind-ein-leerer-block
      : html`<div class="cat-page cat-page-ph" data-page="${seite}" data-anzahl="${anzahl}"></div>`;
  }
  setzeHtml(grid, ungeprueft(markup));
  _catLoadedPages.add(1);
  _ladeJahrVerteilung();
  _setzePlatzhalterHoehe();
  _beobachteSeiten();
  _initYearRail();
}

/**
 * Die Höhe der leeren Blöcke aus der ERSTEN, echten Seite ableiten.
 *
 * Gemessen statt gerechnet: Wie viele Kacheln nebeneinander passen, entscheidet die Fensterbreite; jede
 * Schätzung läge bei einem anderen Fenster daneben. Und eine falsche Höhe ist hier teuer — die Liste springt
 * beim Nachladen, und man verliert die Stelle, an der man gerade war.
 */
function _setzePlatzhalterHoehe(){
  const erste = eins('#catalog-grid .cat-page[data-page="1"]');
  if (!erste) return;
  const hoehe = erste.offsetHeight;
  if (hoehe < 10) return;   // noch nicht gezeichnet
  const proKachel = hoehe / Math.max(1, _catItems.length);
  for (const el of alle('#catalog-grid .cat-page-ph')) {
    const anzahl = parseInt(el.dataset.anzahl ?? '') || CAT_LIMIT;
    el.style.height = Math.round(anzahl * proKachel) + 'px';
  }
}

/**
 * Die Lage der Seitenblöcke einmal messen, dann aus dem Gedächtnis: getBoundingClientRect je Block und Bild
 * erzwang über 400 Layouts, und das Ziehen am Balken legte die CPU auf 100 %.
 * Ausführlich: docs/begruendungen/public/js/09-catalog.js.md#catblocklagen
 */
/** @type {{ seite: number, oben: number, unten: number }[]} */
let _catBlockLagen = [];
// Jahre mit ihrer Anzahl, in der Reihenfolge der Liste — die Grundlage für das Etikett am Scrollbalken (siehe
// _jahrAnPosition).
/** @type {import('../../frontend-typen/vertrag').JahrAnzahl[]} */
let _catJahrVerteilung = [];

function _messeBloecke(){
  _catBlockLagen = [];
  for (const el of alle('#catalog-grid .cat-page')) {
    const r = el.getBoundingClientRect();
    _catBlockLagen.push({
      seite: parseInt(el.dataset.page ?? ''),
      oben:  r.top + window.scrollY,
      unten: r.bottom + window.scrollY,
    });
  }
}

/**
 * Erst laden, wenn das Rollen ruht (150 ms): Ein Zug über die ganze Leiste forderte sonst hunderte Seiten an,
 * von denen nur die letzte angesehen wird. Beim normalen Scrollen merkt man die Pause nicht.
 * Ausführlich: docs/begruendungen/public/js/09-catalog.js.md#die-seiten-laden-die-im-bild-stehen-erst
 */
/** @type {number | null} */
let _catLadeTimer = null;
/**
 * @param {boolean} [sofort]
 */
function _ladeSichtbareSeiten(sofort){
  clearTimeout(_catLadeTimer);
  const tun = () => {
    const oben  = window.scrollY - 600;
    const unten = window.scrollY + window.innerHeight + 600;
    for (const b of _catBlockLagen) {
      if (b.unten >= oben && b.oben <= unten) ladeSeite(b.seite);
    }
  };
  if (sofort) tun(); else _catLadeTimer = setTimeout(tun, 150);
}

/**
 * Auf Rollen und Fenstergrösse hören.
 *
 * Der frühere IntersectionObserver ist entfallen: Er war ein zweiter Weg zum selben Ziel, meldete nur
 * ÄNDERUNGEN der Sichtbarkeit (weshalb bei grossen Blöcken nichts nachkam) und feuerte zusätzlich zu dieser
 * Rechnung. Ein Weg, der immer greift, ist besser als zwei, die sich ergänzen sollen.
 */
function _beobachteSeiten(){
  _messeBloecke();
  if (!_catScrollGebunden) {
    _catScrollGebunden = true;
    let angefordert = false;
    const beiBewegung = () => {
      if (angefordert) return;
      angefordert = true;
      // Über requestAnimationFrame gedrosselt: Ein Scroll-Ereignis feuert dutzende Male je Sekunde.
      requestAnimationFrame(() => { angefordert = false; _ladeSichtbareSeiten(); });
    };
    window.addEventListener('scroll', beiBewegung, { passive: true });
    window.addEventListener('resize', () => { _messeBloecke(); beiBewegung(); }, { passive: true });
  }
  // Was schon im Bild steht, sofort — darauf wartet der Nutzer.
  _ladeSichtbareSeiten(true);
}

/**
 * Eine Seite nachladen und ihren Block füllen.
 *
 * Bereits geladene oder gerade ladende Seiten werden übersprungen — ohne diese Prüfung löste jeder
 * Scroll-Schritt denselben Abruf mehrfach aus.
 * @param {number} seite
 */
export async function ladeSeite(seite){
  if (seite < 1 || seite > _catPageCount) return;
  if (_catLoadedPages.has(seite) || _catLoadingPages.has(seite)) return;
  _catLoadingPages.add(seite);
  const gen = _catGen;
  try {
    const d = await api('GET', `/v1/catalog/sets?${_catQuery(seite)}`);
    if (gen !== _catGen) return;   // Filter hat inzwischen gewechselt
    if (!d.success || !d.sets?.length) return;
    const block = eins(`#catalog-grid .cat-page[data-page="${seite}"]`);
    if (!block) return;
    block.classList.remove('cat-page-ph');
    block.classList.add('sgrid');
    block.style.height = '';
    block.removeAttribute('data-anzahl');
    setzeHtml(block, ungeprueft(d.sets.map(catCard).join('')));
    _catLoadedPages.add(seite);
    _catItems = _catItems.concat(d.sets);
    // Die Blockhöhen haben sich geändert — neu messen, dann nachsehen, was jetzt zusätzlich im Bild steht.
    _messeBloecke();
    _ladeSichtbareSeiten();
  } finally {
    _catLoadingPages.delete(seite);
  }
}

/** @param {import('../../frontend-typen/vertrag').CatalogSetItem} s */
function catCard(s){
  // Vorschau über den Server wie bei Sets, Teilen und Figuren: kleiner als die volle CDN-Auflösung, und schon
  // heruntergeladene Bilder (image_local) sparen den Weg zum CDN ganz.
  // Ausführlich: docs/begruendungen/public/js/09-catalog.js.md#vorschau-ueber-den-server-wie
  const src = s.image_local || s.image_url;
  const img = src
    ? bildTag({ src: imgUrl(thumbUrl(src), 'nur'), alt: '', fade: true, ph: 'set' })
    : html`<span class="bild-ph" aria-hidden="true">${platzhalterInhalt('set')}</span>`;
  const themeShort = s.theme_name ? s.theme_name.split(' › ').pop() : '';
  const ownedBadge = s.owned
    ? html`<span class="ibadge besitz-badge">${ico('ok')}${tRaw('catalog.owned_badge')}${s.owned_quantity>1 ? html`${' ×'}${s.owned_quantity}` : ''}</span>`
    : '';
  // Der Thementon fuer das Design "farbfaecher" (themes/farbfaecher.css liest ihn als --faecher-ton). Immer
  // gesetzt, nicht nur bei aktivem Design: Die Variable kostet nichts, und eine Abfrage des aktiven Designs
  // hier waere eine zweite Stelle, die es kennen muss. Ohne Thema-Nummer bleibt sie weg — dann zeigt der
  // Streifen nichts statt etwas Falsches.
  const thema = s.theme_id;
  const ton = thema != null && Number.isInteger(thema)
    ? ` data-faecher="${((thema % 12) + 12) % 12}"` : '';
  return html`<div class="sc"${ungeprueft(ton)} tabindex="0" role="button" data-sn="${s.set_number}" data-year="${s.year || ''}" data-click="openCatModal" data-arg="${s.set_number}">
    <div class="sci">${img}</div>
    <div class="scb">
      <div class="snum">${s.set_number}</div>
      <div class="sname">${s.name || '—'}</div>
      <div class="smeta">
        <span class="smeta-text"${themeShort ? html` title="${themeShort}"` : ''}>${s.year || '—'}${themeShort ? html`${' · '}${themeShort}` : ''}</span>
        <div class="splaketten">
          ${s.num_parts ? html`<span class="teile-zahl">${tRaw('catalog.pieces_n', { n: s.num_parts.toLocaleString(locale()) })}</span>` : ''}
          ${ownedBadge}
        </div>
      </div>
    </div>
  </div>`;
}

// ── Detail-Modal ──────────────────────────────────────────────────────────────
/** @param {string} setNumber */
async function openCatModal(setNumber){
  const d = await api('GET', `/v1/catalog/sets/${encodeURIComponent(setNumber)}`);
  if (!d.success) { toast(d.error || t('settings.error'), 'error'); return; }
  const s = d.set;
  if (!s) return;
  _catCurSet = s;
  G('cat-m-tit').textContent = s.name || s.set_number;
  G('cat-m-sub').textContent = s.set_number;
  leereLagerortFeld('cat-m-storage');
  // Die volle Auflösung im Detail direkt vom CDN, nicht über den Proxy: Für ein einmaliges grosses Bild ist
  // das schneller und entlastet den Server; der Proxy lohnt sich nur für die vielen kleinen Vorschauen.
  // Ausführlich: docs/begruendungen/public/js/09-catalog.js.md#detailsrc
  const detailSrc = s.image_local || s.image_url;
  setzeDialogbild(G('cat-m-img'), detailSrc ? fullUrl(detailSrc) : PLATZHALTER_SET, PLATZHALTER_SET);
  /** @type {[string, string | number][]} */
  const rows = [
    [tRaw('detail.year'),     s.year || '—'],
    [tRaw('detail.theme'),    s.theme_name || '—'],
    [tRaw('detail.pieces'),   s.num_parts ? s.num_parts.toLocaleString(locale()) : '—'],
    [tRaw('detail.minifigs'), s.minifigs || '—'],
  ];
  if (s.owned) rows.push([tRaw('catalog.owned'), '×' + s.owned_quantity]);
  setzeHtml(G('cat-m-det'), rows.map(([k, v]) => detailZeile(k, esc(String(v)))));
  // Der Kauf-Link kommt fertig vom Server (bricklinkLink.ts): Aus der Rebrickable-Nummer gebaut, war er für
  // Gear, Bücher und Sammelfiguren falsch. Ist der Artikel nicht eindeutig, zeigt er auf die Suche — nie
  // ausblenden.
  // Ausführlich: docs/begruendungen/public/js/09-catalog.js.md#der-kauf-link-kommt-fertig
  const bl = s.bricklink;
  const blBtn = G('cat-m-bricklink');
  blBtn.style.display = '';
  blBtn.href = bl?.url || `https://www.bricklink.com/v2/search.page?q=${encodeURIComponent(s.set_number)}`;
  blBtn.textContent = (bl && bl.exact === false) ? tRaw('catalog.search_bricklink') : tRaw('catalog.buy_bricklink');
  blBtn.title = (bl && bl.exact === false)
    ? tRaw('catalog.search_bricklink_hint')
    : (bl && bl.type !== 'SET' ? `BrickLink: ${bl.type} ${bl.number}` : '');
  // Button-Zustand: bereits im Besitz → Beschriftung "erneut aufnehmen"
  G('cat-m-add').textContent = s.owned ? tRaw('catalog.add_again') : tRaw('catalog.add_to_gallery');
  G('cat-m-qty').value = '1';
  G('cat-m-price').value = '';
  // Die Setnummer hängt am Modal: Der Merklisten-Knopf liegt in einem anderen Modul, und das Modal weiss
  // ohnehin, was es zeigt. Ein Export von _catCurSet wäre ein zweiter Weg zum selben Zustand.
  // Ausführlich: docs/begruendungen/public/js/09-catalog.js.md#cat-modal
  G('cat-modal').dataset.setNumber = s.set_number;
  G('cat-modal').classList.add('open');
}

function closeCatModal(){ G('cat-modal').classList.remove('open'); _catCurSet = null; }

// ── In Galerie aufnehmen — nutzt den bestehenden add-stream-SSE-Flow ─────────
async function addCatalogSetToGallery(){
  if (!_catCurSet) return;
  const num = _catCurSet.set_number;
  const qty = parseInt(G('cat-m-qty').value) || 1;
  const preis = betragAusFeld('cat-m-price');
  if (!preis.ok) return;
  const purchase_price = preis.wert;
  const condition = G('cat-m-cond').value || 'N';
  // Konto mitschicken (Marcos Fund): Der Katalog-Dialog war der VIERTE Erfassungsweg — Galerie-Formular,
  // manuelles Teil und manuelle Minifigur fragen das Konto längst ab, hier fehlte es. Folge: Ein aus dem
  // Katalog aufgenommenes Set landete immer beim eigenen Konto, ohne dass man es merkte. Genau das Muster,
  // das dieses Projekt durchzieht.
  const owner_user_id = selectedOwner('cat-m-owner');
  // VOR dem Schliessen lesen: closeCatModal() raeumt den Dialog, danach steht im Feld nichts mehr. Marcos
  // Befund vom 24.09. („aus dem Katalog in die Galerie — Lagerort nicht setzbar") waere sonst nur halb
  // behoben.
  const storage = selectedStorage('cat-m-storage');
  closeCatModal();
  showProgress(tRaw('gallery.adding_set', { num }), false);
  try {
    await streamRequest('/v1/sets/add-stream', { set_number: num, quantity: qty, purchase_price, condition, owner_user_id, storage }, (ev)=>{
      handleSseEvent(ev, num);
      if (ev.step === 'done') {
        streamFertig();
        setTimeout(()=>{
          hideProgress();
          toast(`Set ${esc(ev.set_number)} ${ev.action==='added'?t('common.added'):t('common.updated')}!`, 'success');
          set_lastImportAt(Date.now());
          _patchCatalogOwned(num, qty); // owned-Badge in-place (kein Reload: Scroll-Position bleibt)
          loadGallery(); loadStats();   // Galerie-Daten im Hintergrund auffrischen
        }, 800);
      } else if (ev.step === 'error') {
        streamFertig();
        setTimeout(()=>{ hideProgress(); toast(ev.error, 'error'); }, 1500);
      }
    });
  } catch(e) { if (/** @type {Error} */ (e).name !== 'AbortError') { hideProgress(); toast(fehlerMeldung(e), 'error'); } }
}

/**
 * owned-Badge eines Sets in der geladenen Liste aktualisieren, ohne die Liste neu zu laden (Infinite Scroll:
 * Scroll-Position bleibt erhalten).
 * @param {string} setNumber
 * @param {number} qty
 */
function _patchCatalogOwned(setNumber, qty){
  const it = _catItems.find(x => x.set_number === setNumber);
  if (!it) return;
  it.owned = true;
  it.owned_quantity = (parseInt(String(it.owned_quantity)) || 0) + (qty || 1);
  const el = document.querySelector(`#catalog-grid .sc[data-sn="${(window.CSS && CSS.escape) ? CSS.escape(setNumber) : setNumber}"]`);
  if (el) { fuegeHtmlEin(el, 'afterend', catCard(it)); el.remove(); }
}


// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  loadCatalogSets,
  closeCatModal,
  openCatModal,
});


// Den Balken zeichnet die Anwendung (#app-scrollbar); der Katalog liefert nur das Jahr daneben. Gelesen aus
// der obersten sichtbaren Kachel — geschätzt wird nur, wo noch nichts geladen ist.
// Ausführlich: docs/begruendungen/public/js/09-catalog.js.md#jahranposition
function _jahrAnPosition(){
  const grid = G('catalog-grid');
  if (!grid) return null;
  // Erste Wahl: die oberste SICHTBARE Kachel. Sobald die Seite geladen ist, ist das die Wahrheit und keine
  // Rechnung.
  for (const karte of alle('.sc:not(.cat-page-ph)', grid)) {
    const r = karte.getBoundingClientRect();
    if (r.bottom >= 0) {
      const jahr = karte.dataset.year;
      if (jahr) return parseInt(jahr);
      break;
    }
  }
  // Zweite Wahl: über die tatsächliche Verteilung der Jahre rechnen. Linear auf 1949–2027 umgerechnet stand
  // bei neun Zehnteln „1965“, weil der Katalog fast ganz aus den letzten Jahrzehnten stammt.
  // Ausführlich: docs/begruendungen/public/js/09-catalog.js.md#zweite-wahl-ueber-die-tatsaechliche
  if (!_catJahrVerteilung.length || !_catTotal) return null;
  const doc = document.documentElement;
  const rollbar = Math.max(1, doc.scrollHeight - window.innerHeight);
  const anteil = Math.min(1, Math.max(0, window.scrollY / rollbar));
  let nummer = Math.round(anteil * (_catTotal - 1));
  for (const eintrag of _catJahrVerteilung) {
    if (nummer < eintrag.n) return eintrag.year;
    nummer -= eintrag.n;
  }
  return _catJahrVerteilung[_catJahrVerteilung.length - 1]?.year ?? null;
}

/**
 * Die Jahresverteilung zu den aktuellen Filtern holen.
 *
 * Vom SERVER, weil nur er die Filter kennt: Eine Verteilung über den ganzen Katalog läge bei gesetztem Thema
 * oder Suchtext genauso daneben wie die frühere lineare Schätzung. Einmal je Listenaufbau, nicht beim Rollen.
 */
async function _ladeJahrVerteilung(){
  _catJahrVerteilung = [];
  const p = new URLSearchParams();
  if (_catState.q)     p.set('q', _catState.q);
  if (_catState.theme) p.set('theme_id', _catState.theme);
  p.set('sort', _catState.sort);
  const gen = _catGen;
  const d = await api('GET', `/v1/catalog/year-verteilung?${p.toString()}`).catch(() => null);
  if (gen !== _catGen) return;   // Filter hat inzwischen gewechselt
  if (d?.success) _catJahrVerteilung = (d.years || []).filter(y => y.year);
}

/** Beim Betreten des Reiters das Etikett anmelden, beim Verlassen abmelden. */
function _initYearRail(){
  const sinnvoll = _catYearMin && _catYearMax && _catYearMax > _catYearMin
    && (_catState.sort === 'year_desc' || _catState.sort === 'year_asc');
  // Bei „Name A–Z" liegen die Jahre verstreut — ein Jahr im Etikett wäre dort ohne Aussage.
  setScrollLabel(sinnvoll ? () => { const j = _jahrAnPosition(); return j ? String(j) : null; } : null);
}
