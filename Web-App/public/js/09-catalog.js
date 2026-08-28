import { registerActions } from './00-registry.js';
import { locale, t, tRaw} from '../i18n.js';
import { G, api, esc, escUrl, fullUrl, imgUrl, thumbUrl, toast } from './01-core.js';
import { setScrollLabel } from './15-scrollbar.js';
import { PARTS_ICON_SVG, handleSseEvent, hideProgress, loadGallery, loadStats, selectedOwner, showProgress, streamRequest } from './02-gallery.js';
import { _lastImportAt , set_lastImportAt} from './07-admin.js';

// ═══ Katalog: Rebrickable-Set-Katalog browsen, suchen, filtern ═══
// Teil von app.js — gleiche Konvention wie 01–08: globaler Scope, Helfer
// (G, api, t, esc, toast, showProgress, streamRequest, handleSseEvent)
// kommen aus den vorher geladenen Dateien.
//
// Datenquelle ist /api/v1/catalog/* (lokale rb_*-Tabellen aus dem täglichen
// CSV-Sync) — serverseitig paginiert, da der Katalog ~25k Sets umfasst.

let _catState = { page: 1, q: '', theme: '', yearFrom: '', yearTo: '', sort: 'year_desc' };
// Infinite Scroll: Generationszähler verwirft späte Antworten nach einem
// Filterwechsel (gleiches Muster wie in der Android-App), _catItems hält die
// geladenen Sets für In-Place-Updates (owned-Badge nach Galerie-Aufnahme).
let _catGen = 0;
// ── Fensterladen statt Endlos-Scroll (Nachtrag 90) ─────────────────────────
//
// Marcos Vorgabe: Die Jahres-Leiste soll nicht filtern, sondern schnell
// scrollen — „kann nicht geprüft werden, wo man hinscrollt, und dieser Teil
// wird dann geladen".
//
// Mit einer angehängten Liste geht das nicht: Wer auf 2005 springt, landet
// mitten im Bestand, und darüber wie darunter fehlt alles. Die Liste führt
// deshalb einen Block je SEITE über das ganze Ergebnis; geladen wird der Block,
// der ins Bild kommt — vorwärts wie rückwärts. Ungeladene Blöcke halten ihre
// Höhe mit Platzhaltern frei, damit nichts springt.
const CAT_LIMIT = 60;
let _catTotal = 0;
let _catPageCount = 0;
let _catLoadedPages = new Set();
let _catLoadingPages = new Set();
let _catScrollGebunden = false;
let _catItems = [];
let _catYearMin = null, _catYearMax = null;   // Datenbereich aus /catalog/meta
let _catMetaLoaded = false;
let _catCurSet = null;      // aktuell im Modal geöffnetes Set
let _catYearCounts = {};    // Jahr -> Set-Zahl (für Slider-Badge)

// Platzhalter für fehlende/kaputte Katalogbilder — gleiches Muster wie die
// Galerie (.no-img-box), damit es in jedem Design konsistent aussieht.
window._catPlaceholderImg = `<div class="no-img-box"><img src="/assets/set-placeholder.svg" alt="Set" class="loaded" /></div>`;

export function initCatalog(){
  if (!_catMetaLoaded) {
    _catMetaLoaded = true;
    _bindCatalogControls();
    loadCatalogMeta();
    loadCatalogSets();
  } else {
    // Tab erneut geöffnet: aktuelle Seite neu laden, damit owned-Badges
    // nach Galerie-Änderungen stimmen.
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
  // Jahr-Dropdowns (Präzisionswahl) -> gehen durch den zentralen Setter.
  // Das geänderte Feld gewinnt: die andere Grenze wird bei Bedarf mitgezogen
  // (gleiches Verhalten wie das Klemmen der Slider-Griffe).
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
  // Der Von-Bis-Schieber ist entfallen (Nachtrag 90) — gefiltert wird über die
  // beiden Auswahlfelder oben, gesprungen über die Leiste am rechten Rand.
  // Auch der Sentinel des Endlos-Scrolls ist weg: Geladen wird die Seite, die
  // gerade ins Bild kommt (siehe _beobachteSeiten).
  G('cat-modal').addEventListener('click', e=>{ if(e.target.id==='cat-modal') closeCatModal(); });
  G('cat-m-add').onclick = addCatalogSetToGallery;
}

async function loadCatalogMeta(){
  const d = await api('GET', '/v1/catalog/meta');
  if (!d.success) return;
  // Themen-Dropdown: Pfadnamen ("Star Wars › UCS") mit Set-Zahl
  const themeEl = G('cat-theme');
  const cur = themeEl.value;
  themeEl.innerHTML = `<option value="">${t('catalog.filter.all_themes')}</option>` +
    (d.themes||[]).map(th=>`<option value="${th.id}"${String(th.id)===cur?' selected':''}>${esc(th.name)} (${th.set_count})</option>`).join('');
  // Jahr-Dropdowns (Von/Bis): absteigend von max bis min
  if (d.year_min && d.year_max) {
    const mk = (el, placeholderKey, cur)=>{
      let opts = `<option value="">${t(placeholderKey)}</option>`;
      for (let y = d.year_max; y >= d.year_min; y--) {
        opts += `<option value="${y}"${String(y)===cur?' selected':''}>${y}</option>`;
      }
      el.innerHTML = opts;
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

/** Zentrale Stelle für Jahresbereichs-Änderungen — hält Dropdowns, Slider und Badge synchron. */
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

function _catQuery(page){
  const p = new URLSearchParams();
  if (_catState.q)        p.set('q', _catState.q);
  if (_catState.theme)    p.set('theme_id', _catState.theme);
  if (_catState.yearFrom) p.set('year_from', _catState.yearFrom);
  if (_catState.yearTo)   p.set('year_to', _catState.yearTo);
  p.set('sort', _catState.sort);
  p.set('page', String(page));
  p.set('limit', '60');
  return p.toString();
}

/**
 * Liste neu aufbauen: erste Seite laden, den Rest als Platzhalter-Blöcke.
 *
 * Ein Block je Seite über das GANZE Ergebnis — nur so kann die Jahres-Leiste
 * irgendwohin springen, statt zu filtern.
 */
async function loadCatalogSets(){
  const gen = ++_catGen;
  _catLoadedPages = new Set();
  _catLoadingPages = new Set();
  const grid = G('catalog-grid');
  grid.innerHTML = `<div class="loading"><div class="spin"></div><span>${t('catalog.loading')}</span></div>`;
  _catState.page = 1;
  const d = await api('GET', '/v1/catalog/sets?' + _catQuery(1));
  if (gen !== _catGen) return;   // inzwischen neuer Filter — Antwort verwerfen
  if (!d.success) { grid.innerHTML = `<div class="empty"><h3>${esc(d.error||t('settings.error'))}</h3></div>`; return; }

  _catTotal = d.total || 0;
  _catPageCount = Math.max(1, Math.ceil(_catTotal / CAT_LIMIT));
  _catItems = d.sets || [];
  G('cat-count').textContent = tRaw('catalog.result_count', { count: _catTotal.toLocaleString(locale()) });

  if (!_catItems.length) {
    grid.innerHTML = `<div class="empty"><img src="/assets/set-placeholder.svg" style="width:64px;height:64px;opacity:.4;margin:0 auto 12px;display:block" /><h3>${t('catalog.no_results')}</h3></div>`;
    setScrollLabel(null);
    return;
  }

  // Ein Block je Seite. Der erste ist gefüllt, die übrigen halten nur Platz.
  let html = '';
  for (let seite = 1; seite <= _catPageCount; seite++) {
    const anzahl = (seite === _catPageCount) ? (_catTotal - (seite - 1) * CAT_LIMIT) : CAT_LIMIT;
    html += seite === 1
      ? `<div class="sgrid cat-page" data-page="1">${_catItems.map(catCard).join('')}</div>`
      // Ungeladene Seiten sind EIN leerer Block, nicht 60 Kachel-Platzhalter.
      // Bei 25 000 Sets wären das über 25 000 Elemente auf einmal — der Browser
      // baut sie, aber langsam, und jeder Scroll-Schritt kostet danach. Die
      // Höhe kommt gleich nach dem Zeichnen aus der GEMESSENEN ersten Seite
      // (siehe _setzePlatzhalterHoehe): geraten wäre sie falsch, sobald das
      // Fenster eine andere Spaltenzahl ergibt.
      : `<div class="cat-page cat-page-ph" data-page="${seite}" data-anzahl="${anzahl}"></div>`;
  }
  grid.innerHTML = html;
  _catLoadedPages.add(1);
  _ladeJahrVerteilung();
  _setzePlatzhalterHoehe();
  _beobachteSeiten();
  _initYearRail();
}

/**
 * Die Höhe der leeren Blöcke aus der ERSTEN, echten Seite ableiten.
 *
 * Gemessen statt gerechnet: Wie viele Kacheln nebeneinander passen, entscheidet
 * die Fensterbreite; jede Schätzung läge bei einem anderen Fenster daneben. Und
 * eine falsche Höhe ist hier teuer — die Liste springt beim Nachladen, und man
 * verliert die Stelle, an der man gerade war.
 */
function _setzePlatzhalterHoehe(){
  const erste = document.querySelector('#catalog-grid .cat-page[data-page="1"]');
  if (!erste) return;
  const hoehe = erste.offsetHeight;
  if (hoehe < 10) return;   // noch nicht gezeichnet
  const proKachel = hoehe / Math.max(1, _catItems.length);
  for (const el of document.querySelectorAll('#catalog-grid .cat-page-ph')) {
    const anzahl = parseInt(el.dataset.anzahl) || CAT_LIMIT;
    el.style.height = Math.round(anzahl * proKachel) + 'px';
  }
}

/**
 * Wo liegt welcher Seitenblock? EINMAL gemessen, dann aus dem Gedächtnis.
 *
 * ── Marcos Meldung ──────────────────────────────────────────────────────────
 * „Wenn ich im Katalog zu einem Jahr scrolle, hängt die Applikation wieder
 * (CPU auf 100 %)."
 *
 * Die vorige Fassung fragte bei JEDEM Bild jeden einzelnen Block nach seiner
 * Lage (`getBoundingClientRect`). Bei rund 25 000 Sets sind das über
 * vierhundert Blöcke — und jede dieser Abfragen zwingt den Browser, das Layout
 * neu zu berechnen. Beim Ziehen über die ganze Leiste passiert das sechzigmal
 * je Sekunde. Der Balken tat also genau das, wogegen er helfen sollte.
 *
 * Die Lagen ändern sich nur, wenn eine Seite eintrifft oder das Fenster sich
 * ändert — dann wird neu gemessen, sonst nie.
 */
let _catBlockLagen = [];
// Jahre mit ihrer Anzahl, in der Reihenfolge der Liste — die Grundlage für das
// Etikett am Scrollbalken (siehe _jahrAnPosition).
let _catJahrVerteilung = [];

function _messeBloecke(){
  _catBlockLagen = [];
  for (const el of document.querySelectorAll('#catalog-grid .cat-page')) {
    const r = el.getBoundingClientRect();
    _catBlockLagen.push({
      seite: parseInt(el.dataset.page),
      oben:  r.top + window.scrollY,
      unten: r.bottom + window.scrollY,
    });
  }
}

/**
 * Die Seiten laden, die im Bild stehen — erst, wenn das Rollen zur Ruhe kommt.
 *
 * ── Warum verzögert ─────────────────────────────────────────────────────────
 * Wer den Balken von oben nach unten zieht, kommt an JEDER Stelle der Liste
 * vorbei. Ohne Verzögerung fordert das ein paar hundert Seiten an, von denen
 * nur die letzte je angesehen wird — jede mit einer Abfrage über 25 000 Zeilen
 * und bis zu sechzig Bildern im Schlepptau. Das ist die Last aus Marcos
 * Meldung.
 *
 * 150 ms Ruhe genügen: Beim gewöhnlichen Scrollen merkt man sie nicht, ein Zug
 * über die ganze Leiste löst dagegen genau EINEN Abruf aus — am Ziel.
 */
let _catLadeTimer = null;
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
 * Der frühere IntersectionObserver ist entfallen: Er war ein zweiter Weg zum
 * selben Ziel, meldete nur ÄNDERUNGEN der Sichtbarkeit (weshalb bei grossen
 * Blöcken nichts nachkam) und feuerte zusätzlich zu dieser Rechnung. Ein Weg,
 * der immer greift, ist besser als zwei, die sich ergänzen sollen.
 */
function _beobachteSeiten(){
  _messeBloecke();
  if (!_catScrollGebunden) {
    _catScrollGebunden = true;
    let angefordert = false;
    const beiBewegung = () => {
      if (angefordert) return;
      angefordert = true;
      // Über requestAnimationFrame gedrosselt: Ein Scroll-Ereignis feuert
      // dutzende Male je Sekunde.
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
 * Bereits geladene oder gerade ladende Seiten werden übersprungen — ohne diese
 * Prüfung löste jeder Scroll-Schritt denselben Abruf mehrfach aus.
 */
export async function ladeSeite(seite){
  if (seite < 1 || seite > _catPageCount) return;
  if (_catLoadedPages.has(seite) || _catLoadingPages.has(seite)) return;
  _catLoadingPages.add(seite);
  const gen = _catGen;
  try {
    const d = await api('GET', '/v1/catalog/sets?' + _catQuery(seite));
    if (gen !== _catGen) return;   // Filter hat inzwischen gewechselt
    if (!d.success || !d.sets?.length) return;
    const block = document.querySelector(`#catalog-grid .cat-page[data-page="${seite}"]`);
    if (!block) return;
    block.classList.remove('cat-page-ph');
    block.classList.add('sgrid');
    block.style.height = '';
    block.removeAttribute('data-anzahl');
    block.innerHTML = d.sets.map(catCard).join('');
    _catLoadedPages.add(seite);
    _catItems = _catItems.concat(d.sets);
    // Die Blockhöhen haben sich geändert — neu messen, dann nachsehen, was
    // jetzt zusätzlich im Bild steht.
    _messeBloecke();
    _ladeSichtbareSeiten();
  } finally {
    _catLoadingPages.delete(seite);
  }
}

function catCard(s){
  // Über den Server statt direkt im Browser vom CDN — dieselbe Logik wie
  // Sets, Teile und Minifiguren (imgUrl(thumbUrl(...), true)), auf Wunsch
  // auch für den Katalog vereinheitlicht. Vorteil gegenüber der bisherigen
  // rohen CDN-Adresse: kleineres Vorschaubild statt der vollen Auflösung,
  // und derselbe serverseitige Existenz-Check auf image_local wie überall
  // sonst — lokal bereits heruntergeladene Sets (irgendein Nutzer hat sie
  // schon einmal seinem Bestand hinzugefügt) sparen den CDN-Umweg komplett.
  const src = s.image_local || s.image_url;
  const img = src
    ? `<img src="${escUrl(imgUrl(thumbUrl(src), 'nur'))}" loading="lazy" decoding="async" data-fade="1" data-onerror="placeholder" />`
    : window._catPlaceholderImg;
  const themeShort = s.theme_name ? s.theme_name.split(' › ').pop() : '';
  const ownedBadge = s.owned
    ? `<span class="ibadge" title="${t('catalog.owned')}">✓${s.owned_quantity>1?'×'+s.owned_quantity:''}</span>`
    : '';
  return `<div class="sc" data-sn="${esc(s.set_number)}" data-year="${s.year||''}" data-click="openCatModal" data-arg="${esc(s.set_number)}">
    <div class="sci">${img}</div>
    <div class="scb">
      <div class="snum">${esc(s.set_number)}</div>
      <div class="sname">${esc(s.name)||'—'}</div>
      <div class="smeta">
        <span style="font-size:.68rem">${s.year||'—'}${themeShort?' · '+esc(themeShort.substring(0,14)):''}</span>
        <div style="display:flex;gap:3px;align-items:center;flex-wrap:wrap">
          ${s.num_parts?`<span class="qbadge">${PARTS_ICON_SVG}${s.num_parts.toLocaleString(locale())}</span>`:''}
          ${ownedBadge}
        </div>
      </div>
    </div>
  </div>`;
}

// ── Detail-Modal ──────────────────────────────────────────────────────────────
async function openCatModal(setNumber){
  const d = await api('GET', '/v1/catalog/sets/' + encodeURIComponent(setNumber));
  if (!d.success) { toast(d.error || t('settings.error'), 'error'); return; }
  const s = d.set; _catCurSet = s;
  G('cat-m-tit').textContent = s.name || s.set_number;
  G('cat-m-sub').textContent = s.set_number;
  // Volle Auflösung im Detail-Modal — wie beim Zoom der eigenen Sets
  // (11-actions.js, openImageLightboxFromEl): NICHT über den Proxy, sondern
  // direkt im Browser vom CDN geladen. Das ist bewusst so: Der Server-Umweg
  // lohnt sich für die kleine Vorschau (spart Bandbreite, profitiert vom
  // Existenz-Check auf image_local), aber für die einmalige volle Auflösung
  // im Detail-Dialog ist der direkte Browser-Zugriff schneller UND entlastet
  // den Server — genau der Unterschied, den ein direkt geöffneter CDN-Link
  // (unter einer Sekunde) gegenüber dem Server-Proxy zeigt.
  const detailSrc = s.image_local || s.image_url;
  G('cat-m-img').src = detailSrc ? fullUrl(detailSrc) : '/assets/set-placeholder.svg';
  const rows = [
    [t('detail.year'),     s.year || '—'],
    [t('detail.theme'),    s.theme_name || '—'],
    [t('detail.pieces'),   s.num_parts ? s.num_parts.toLocaleString(locale()) : '—'],
    [t('detail.minifigs'), s.minifigs || '—'],
  ];
  if (s.owned) rows.push([t('catalog.owned'), '✓ ×' + s.owned_quantity]);
  G('cat-m-det').innerHTML = rows.map(([k,v]) =>
    `<div class="dr"><span class="dl">${k}</span><span class="dv">${esc(String(v))}</span></div>`).join('');
  // Kauf-Link kommt fertig vom Server (utils/bricklinkLink.ts). Vorher wurde er
  // hier aus der Rebrickable-Nummer gebaut und immer als Set verlinkt (S=…) —
  // für alles, was BrickLink als Gear oder Buch führt, war damit sowohl der
  // Parameter als auch die Nummer falsch (dort ohne "-1"-Suffix).
  // url ist immer gesetzt: Ist der Artikel nicht eindeutig bestimmbar, zeigt
  // sie auf die BrickLink-Suche. Der Button wird nie ausgeblendet — bei
  // Sammelminifiguren (Rebrickable führt sie als Set, BrickLink als MINIFIG mit
  // anderer Nummer) war er sonst weg, obwohl der Artikel dort sehr wohl
  // existiert, nur eben unter einer Nummer, die niemand herleiten kann.
  const bl = s.bricklink;
  const blBtn = G('cat-m-bricklink');
  blBtn.style.display = '';
  blBtn.href = bl?.url || `https://www.bricklink.com/v2/search.page?q=${encodeURIComponent(s.set_number)}`;
  blBtn.textContent = (bl && bl.exact === false) ? t('catalog.search_bricklink') : t('catalog.buy_bricklink');
  blBtn.title = (bl && bl.exact === false)
    ? t('catalog.search_bricklink_hint')
    : (bl && bl.type !== 'SET' ? `BrickLink: ${bl.type} ${bl.number}` : '');
  // Button-Zustand: bereits im Besitz → Beschriftung "erneut aufnehmen"
  G('cat-m-add').textContent = s.owned ? t('catalog.add_again') : t('catalog.add_to_gallery');
  G('cat-m-qty').value = '1';
  G('cat-m-price').value = '';
  G('cat-modal').classList.add('open');
}

function closeCatModal(){ G('cat-modal').classList.remove('open'); _catCurSet = null; }

// ── In Galerie aufnehmen — nutzt den bestehenden add-stream-SSE-Flow ─────────
async function addCatalogSetToGallery(){
  if (!_catCurSet) return;
  const num = _catCurSet.set_number;
  const qty = parseInt(G('cat-m-qty').value) || 1;
  const priceVal = G('cat-m-price').value;
  const purchase_price = (priceVal != null && String(priceVal).trim() !== '' && !isNaN(parseFloat(priceVal))) ? parseFloat(priceVal) : null;
  const condition = G('cat-m-cond').value || 'N';
  // Konto mitschicken (Nachtrag 66, Marcos Fund): Der Katalog-Dialog war der
  // VIERTE Erfassungsweg — Galerie-Formular, manuelles Teil und manuelle
  // Minifigur fragen das Konto längst ab, hier fehlte es. Folge: Ein aus dem
  // Katalog aufgenommenes Set landete immer beim eigenen Konto, ohne dass man
  // es merkte. Genau das Muster, das dieses Projekt durchzieht.
  const owner_user_id = selectedOwner('cat-m-owner');
  closeCatModal();
  showProgress(t('gallery.adding_set', { num }), false);
  try {
    await streamRequest('/api/sets/add-stream', { set_number: num, quantity: qty, purchase_price, condition, owner_user_id }, (ev)=>{
      handleSseEvent(ev, num);
      if (ev.step === 'done') {
        _activeAbort = null; G('btn-cancel-import').style.display = 'none';
        setTimeout(()=>{
          hideProgress();
          toast(`Set ${esc(ev.set_number)} ${ev.action==='added'?t('common.added'):t('common.updated')}!`, 'success');
          set_lastImportAt(Date.now());
          _patchCatalogOwned(num, qty); // owned-Badge in-place (kein Reload: Scroll-Position bleibt)
          loadGallery(); loadStats();   // Galerie-Daten im Hintergrund auffrischen
        }, 800);
      } else if (ev.step === 'error') {
        _activeAbort = null; G('btn-cancel-import').style.display = 'none';
        setTimeout(()=>{ hideProgress(); toast(ev.error, 'error'); }, 1500);
      }
    });
  } catch(e) { if (e.name !== 'AbortError') { hideProgress(); toast(e.message, 'error'); } }
}

/** owned-Badge eines Sets in der geladenen Liste aktualisieren, ohne die
 *  Liste neu zu laden (Infinite Scroll: Scroll-Position bleibt erhalten). */
function _patchCatalogOwned(setNumber, qty){
  const it = _catItems.find(x => x.set_number === setNumber);
  if (!it) return;
  it.owned = true;
  it.owned_quantity = (parseInt(it.owned_quantity) || 0) + (qty || 1);
  const el = document.querySelector(`#catalog-grid .sc[data-sn="${(window.CSS && CSS.escape) ? CSS.escape(setNumber) : setNumber}"]`);
  if (el) el.outerHTML = catCard(it);
}


// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  closeCatModal,
  openCatModal,
});


// ═══ Jahres-Etikett am gemeinsamen Scrollbalken ═════════════════════════════
//
// Den Balken selbst zeichnet die Anwendung für die ganze Seite (js/01-core.js,
// #app-scrollbar). Der Katalog trägt hier nur bei, WAS beim Ziehen daneben
// steht: das Jahr an der aktuellen Stelle.
//
// Gelesen wird es aus der obersten SICHTBAREN Kachel — das ist die Wahrheit,
// sobald die Seite geladen ist. Nur für noch leere Bereiche wird linear
// geschätzt; dort weiss der Browser es schlicht nicht. Eine rein lineare
// Rechnung wäre falsch, sobald ein Jahr mehr Sets hat als ein anderes.
function _jahrAnPosition(){
  const grid = G('catalog-grid');
  if (!grid) return null;
  // Erste Wahl: die oberste SICHTBARE Kachel. Sobald die Seite geladen ist, ist
  // das die Wahrheit und keine Rechnung.
  for (const karte of grid.querySelectorAll('.sc:not(.cat-page-ph)')) {
    const r = karte.getBoundingClientRect();
    if (r.bottom >= 0) {
      const jahr = karte.dataset.year;
      if (jahr) return parseInt(jahr);
      break;
    }
  }
  // Zweite Wahl: über die tatsächliche VERTEILUNG rechnen.
  //
  // Marcos Befund: Vorher wurde die Position linear auf den Jahresbereich
  // umgerechnet — als läge zwischen 1949 und 2027 in jedem Jahr gleich viel.
  // Tatsächlich stammt der weitaus grösste Teil des Katalogs aus den letzten
  // Jahrzehnten. Neun Zehntel hinuntergezogen stand deshalb „1965", während
  // gleich darauf Sets von 1999 erschienen.
  //
  // Jetzt wird aus der Position eine laufende NUMMER und daraus das Jahr, in
  // dem diese Nummer wirklich liegt.
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
 * Vom SERVER, weil nur er die Filter kennt: Eine Verteilung über den ganzen
 * Katalog läge bei gesetztem Thema oder Suchtext genauso daneben wie die
 * frühere lineare Schätzung. Einmal je Listenaufbau, nicht beim Rollen.
 */
async function _ladeJahrVerteilung(){
  _catJahrVerteilung = [];
  const p = new URLSearchParams();
  if (_catState.q)     p.set('q', _catState.q);
  if (_catState.theme) p.set('theme_id', _catState.theme);
  p.set('sort', _catState.sort);
  const gen = _catGen;
  const d = await api('GET', '/v1/catalog/year-verteilung?' + p.toString()).catch(() => null);
  if (gen !== _catGen) return;   // Filter hat inzwischen gewechselt
  if (d?.success) _catJahrVerteilung = (d.years || []).filter(y => y.year);
}

/** Beim Betreten des Reiters das Etikett anmelden, beim Verlassen abmelden. */
function _initYearRail(){
  const sinnvoll = _catYearMin && _catYearMax && _catYearMax > _catYearMin
    && (_catState.sort === 'year_desc' || _catState.sort === 'year_asc');
  // Bei „Name A–Z" liegen die Jahre verstreut — ein Jahr im Etikett wäre dort
  // ohne Aussage.
  setScrollLabel(sinnvoll ? () => { const j = _jahrAnPosition(); return j ? String(j) : null; } : null);
}
