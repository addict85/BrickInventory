import { ladeAnzeige } from './01-bausteine.js';
import { registerActions } from './00-registry.js';
import { locale, t, tRaw} from '../i18n.js';
import { CURRENCY, G, ME, TRASH_ICON_SVG, _gibSse, _gibTimer, _monitorTimer, api, esc, escJs, escUrl, fmtBig, fmtN, gibStart, imgUrl, loadMonitor, observeLazyImages, thumbUrl, toast, set_monitorTimer } from './01-core.js';
import { SCOPE_VIEWS, addScopeParam, scopeMode, scopeQuery, setScopeMode } from './14-scope.js';
import { setScrollLabel } from './15-scrollbar.js';
import { loadParts } from './03-parts.js';
import { loadFinance } from './04-finance.js';
import { loadApiLimits, loadCacheStats, loadCacheTtl, loadProfile, loadRateLimitStats, loadSettings } from './05-settings.js';
import { loadBrickColors, loadManualParts, loadMinifigs } from './06-minifigs.js';
import { _lastImportAt, confirmDelete, enrichGalleryWithPrices, jobPollTimer, openModal, pollJobStatus, set_jobPollTimer, set_lastImportAt } from './07-admin.js';
import { openAcqModal, renderAcqModalBody, renderAcquisitionSummary } from './13-acquisition-modals.js';
import { initCatalog } from './09-catalog.js';
import { delSetStop, openPdfViewerLink, stopEvent } from './11-actions.js';

// ═══ Navigation, Stats, Progress-Overlay, Galerie, CSV-Polling, Set-Detail-Modal ═══
// Teil von app.js — die Dateien in public/js/ werden in nummerierter
// Reihenfolge geladen und teilen sich den globalen Scope (kein Modul-
// System noetig, Inline-onclick-Handler in index.html funktionieren
// unveraendert). Der Split ist rein sequenziell und verhaelt sich
// identisch zur frueheren Einzeldatei.

// ── NAVIGATION ────────────────────────────────────────
// Icon des Reiters in den Seitentitel spiegeln (links vom Text), damit
// oben derselbe Icon wie im Nav-Tab erscheint. Quelle ist der Nav-Tab
// selbst — Emoji ODER Inline-SVG —, so bleibt beides automatisch synchron.
function syncTabTitleIcon(tab){
  const nav = document.querySelector(`.ntab[data-tab="${tab}"]`);
  const slot = document.querySelector(`.ptitle[data-tab-title="${esc(tab)}"] .ptitle-icon`);
  if(!nav || !slot) return;
  // Alles vor dem .tab-label ist das Icon (Emoji-Textknoten oder <svg>).
  const label = nav.querySelector('.tab-label');
  let html = '';
  for(const node of nav.childNodes){
    if(node === label) break;
    html += node.nodeType === Node.TEXT_NODE ? node.textContent : (node.outerHTML || '');
  }
  slot.innerHTML = html.trim();
}

export function bindTabs(){
  document.querySelectorAll('.ntab').forEach(t=>{
    // Avoid duplicate listeners
    if(t._tabBound) return; t._tabBound=true;
    t.addEventListener('click',()=>{
      document.querySelectorAll('.ntab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active'); G('tab-'+t.dataset.tab).classList.add('active');
      const tab = t.dataset.tab;
      syncTabTitleIcon(tab);
      // Das Jahres-Etikett am Scrollbalken gehört NUR in den Katalog. Ohne
      // dieses Abmelden lieferte die dort angemeldete Funktion weiterhin ein
      // Jahr — auch in der Galerie, wo die Zahl nichts bedeutet.
      if (tab !== 'catalog') setScrollLabel(null);
      if(tab==='gallery')      { loadGallery(); loadStats(); }
      if(tab==='catalog')      { initCatalog(); }
      if(tab==='parts')        {
        loadParts(); loadManualParts(); loadBrickColors();
        // If import was recent, reload again after background job completes
        if(Date.now()-_lastImportAt<30000) setTimeout(()=>{ loadParts(); loadManualParts(); },5000);
      }
      if(tab==='minifigs')     {
        loadMinifigs();
        if(Date.now()-_lastImportAt<30000) setTimeout(loadMinifigs,5000);
      }
      if(tab==='finance')      { loadFinance(); } // loadFinance already fetches parts+minifigs valuation in parallel
      if(tab==='partslist')    { /* session-only, no server load needed */ }
      if(tab==='settings')     { loadSettings(); loadProfile(); if(ME?.isAdmin) loadApiLimits(); }
      if(tab==='monitor')      { loadMonitor(); loadCacheStats(); loadRateLimitStats(); loadCacheTtl(); if(jobPollTimer) clearTimeout(jobPollTimer); pollJobStatus(); }
      if(tab!=='monitor' && _monitorTimer) { clearInterval(_monitorTimer); set_monitorTimer(null); if(jobPollTimer){clearTimeout(jobPollTimer);set_jobPollTimer(null);} }
    });
  });
  // Alle Seitentitel-Icons füllen — läuft bei jedem bindTabs()-Aufruf, also
  // auch nach dem Login (showApp ruft bindTabs erneut), wenn der Inhalt
  // sichtbar wird. So erscheint das Icon links vom Titel auf allen Tabs,
  // nicht nur nach einem Klick.
  document.querySelectorAll('.ptitle[data-tab-title]').forEach(h=>syncTabTitleIcon(h.dataset.tabTitle));
}
// Aufruf verschoben nach startApp() (js/08-init.js), das js/main.js NACH der
// Auswertung aller Module aufruft. Im Modulrumpf lief er zu früh: Bei
// gegenseitigen Importen ist das Übersetzungsobjekt aus i18n.js dann noch
// nicht initialisiert, und t() wirft.


// ── STATS ─────────────────────────────────────────────
export async function loadStats(){
  // Mit Kontofilter. Hier stand `api('GET', '/v1/stats')` ohne ihn — und das
  // war nachweislich nicht so gemeint: onScopeChange('gallery') ruft
  // ausgerechnet loadStats() gleich nach loadGallery() auf. Etwas neu zu laden,
  // das sich nicht ändern kann, ergibt nur einen Sinn, wenn es sich ändern
  // SOLLTE.
  //
  // Die Wirkung: Wer auf „nur meine" stellte, sah darunter eine gefilterte
  // Liste und darüber weiter die Zahlen des ganzen Haushalts. Am Telefon
  // stimmten beide — die App schickt accounts an /v1/stats seit jeher
  // (BrickApiService.getStats).
  const d = await api('GET', '/v1/stats' + scopeQuery('gallery'));
  if (d.success) {
    G('hs-sets').textContent     = d.stats.total_sets;
    G('hs-parts').textContent    = fmtBig(d.stats.total_parts    || 0);
    G('hs-minifigs').textContent = fmtBig(d.stats.total_minifigs || 0);
    G('hs-instr').textContent    = d.stats.total_instructions;
    // Werte in die großen Stein-Stat-Kacheln der Galerie spiegeln (nur im
    // Stein-Design sichtbar, sonst per CSS ausgeblendet).
    const _mir = (from, to) => { const s = G(from), t2 = G(to); if (s && t2) t2.textContent = s.textContent; };
    _mir('hs-sets', 'bstat-sets'); _mir('hs-parts', 'bstat-parts'); _mir('hs-minifigs', 'bstat-minifigs');
  }
}

// ── PROGRESS OVERLAY ─────────────────────────────────
export function showProgress(title, csvMode){
  G('prog-title-txt').textContent=title;
  G('prog-bar').style.width='0%';
  G('prog-footer').textContent=tRaw('common.please_wait');
  G('prog-set-name').textContent='';
  G('csv-log').style.display=csvMode?'block':'none';
  G('csv-log').innerHTML='';
  G('prog-steps').style.display=csvMode?'none':'';
  // Der Hintergrund-Hinweis gilt nur fürs Erfassen eines einzelnen Sets. Beim
  // CSV-Import ist die Schrittliste ohnehin ausgeblendet, dort zeigt das
  // Protokoll (`csv-log`) je Zeile ein echtes Ergebnis.
  if (G('prog-hint')) G('prog-hint').style.display=csvMode?'none':'';
  ['ps-meta','ps-image'].forEach(id=>{
    const el=G(id); el.classList.remove('active','done','err');
  });
  G('progress-overlay').classList.add('open');
  // Reset buttons for new import
  G('btn-cancel-import').style.display='none';
  const btnClose = G('btn-close-import');
  if (btnClose) btnClose.style.display='none';
}
export function hideProgress(){
  G('progress-overlay').classList.remove('open');
  G('prog-steps').style.display='';
  // Show header bar when minimizing if import is polling
  if ((_gibTimer || _gibSse) && ME) {
    G('global-import-bar').style.display = 'flex';
  }
}

// Call this whenever progress changes to sync header bar
function syncGibFromProgress(pct, text) {
  const bar = G('global-import-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  G('gib-fill').style.width = pct + '%';
  G('gib-text').textContent = text;
}
// `extra` fiel weg: Es schrieb in ein `.step-count`-Feld, das nur die
// entfernten Teile-/Teilbilder-Schritte hatten. Ohne diese Schritte gibt es
// kein Element mehr, in das es hätte schreiben können.
function setStep(stepId, state){
  const el=G('ps-'+stepId); if(!el) return;
  el.classList.remove('active','done','err'); el.classList.add(state);
}
function setProgBar(pct){ G('prog-bar').style.width=Math.min(100,pct)+'%'; }
function addCsvLog(text, ok){
  const d=G('csv-log'), line=document.createElement('div');
  line.className='csv-log-line '+(ok?'ok':'er');
  line.textContent=text; d.appendChild(line); d.scrollTop=d.scrollHeight;
}

// Verarbeitet die SSE-Ereignisse beim Erfassen EINES Sets.
//
// ── Warum hier nur noch zwei Schritte stehen ────────────────────────────────
// Der Dialog listete früher sechs Schritte: Set-Infos, Bild, Anleitungen,
// Teile, Teilbilder, Preis. Davon wartet der Aufrufer heute nur noch auf die
// ersten beiden — `addSet()` (utils/setService.ts) holt Set-Daten und Bild
// synchron und schiebt alles Übrige in ein `setTimeout`, das erst nach der
// Antwort läuft. Die vier hinteren Schritte konnten den Browser deshalb gar
// nicht mehr erreichen:
//   • `instructions` wurde zwar noch gesendet, aber der Download lief bereits
//     in einem `setImmediate` — der Punkt sprang auf „aktiv" und blieb dort
//     stehen, weil ihn nie ein Abschluss erreichte.
//   • `parts_start`, `parts_importing`, `parts_done`, `parts_images` und
//     `parts_error` stammen aus `importPartsForSet()`. NACHGEMESSEN: alle fünf
//     Aufrufstellen übergeben dort `null` als Fortschritts-Melder.
//   • `step:'price'` wurde von KEINER Serverstelle je gesendet.
// Ein Fortschrittsbalken, der Arbeit anzeigt, auf die niemand wartet, ist
// keine Auskunft, sondern eine Behauptung. Statt der vier Punkte steht jetzt
// ein fester Hinweis im Dialog (`prog-hint`), dass diese Arbeit im Hintergrund
// weiterläuft — was zutrifft und den Dialog nicht künstlich offen hält.
//
// `done_meta` markiert die Stelle, an der der synchrone Teil fertig ist. Der
// Schritt wurde bisher gesendet und vom Browser verworfen; er schliesst jetzt
// den Bild-Schritt ab. Ohne ihn bliebe „Bild herunterladen" bis zum Ende auf
// „aktiv", weil das früher der `instructions`-Zweig erledigt hat.
export function handleSseEvent(ev, singleSetName){
  switch(ev.step){
    case 'meta':      setStep('meta','active'); setProgBar(10); G('prog-set-name').textContent=ev.set||singleSetName||''; break;
    case 'image':     setStep('meta','done'); setStep('image','active'); setProgBar(35); break;
    case 'done_meta': setStep('image','done'); setProgBar(90); break;
    case 'done':      setProgBar(100); G('prog-footer').textContent=`✅ ${ev.action==='added'?t('common.added_cap'):t('common.updated_cap')}: ${esc(ev.set_number)}`; break;
    case 'error':     G('prog-footer').textContent=`❌ ${esc(ev.error)}`; break;
  }
}

// ── GALLERY ───────────────────────────────────────────
export let allSets=[], curView='grid';

/**
 * Übernimmt das vom Server gelieferte Zustands-Aggregat eines Sets in die
 * Galerie-Liste und zeichnet neu.
 *
 * Vorher hat das Frontend die Regel selbst nachgebaut und dabei die Bedingung
 * der ZULETZT erfassten Position genommen. Der Server sagt aber: sobald EINE
 * Erfassung "U" ist, gilt das Set als gebraucht. Bei der Reihenfolge [U, N]
 * zeigte die Kachel deshalb "neu", bis die Liste neu geladen wurde.
 *
 * @param {{set_number:string, condition?:string, acq_count?:number,
 *          used_count?:number, max_purchase_price?:number|null}|undefined} agg
 */
export function applySetAggregate(agg){
  if (!agg?.set_number) return;
  const before = allSets;
  allSets = allSets.map(s => s.set_number === agg.set_number ? { ...s, ...agg } : s);
  if (allSets !== before) renderGallery();
}
// ── Endlos-Scroll der Galerie ───────────────────────────────────────────────
// Muster wie im Katalog und in der Teileansicht. Filtern und Sortieren liegen
// seit dieser Umstellung auf dem Server: Clientseitig über allSets zu filtern
// verträgt sich nicht mit seitenweisem Laden — ein Filter hätte nur die bereits
// geladene Seite durchsucht.
const GAL_PAGE_SIZE = 60;
let _galGen = 0, _galPage = 1, _galDone = false, _galLoadingMore = false, _galTotal = 0;

/** Aktuelle Filter- und Sortierwerte als Query-Parameter. */
function galleryParams(page, pageSize = GAL_PAGE_SIZE){
  const p = new URLSearchParams();
  p.set('page', page);
  p.set('page_size', pageSize);
  const q = G('gs')?.value?.trim();      if (q)     p.set('search', q);
  const th = G('gtheme')?.value;         if (th)    p.set('theme', th);
  const so = G('gsort')?.value;          if (so)    p.set('sort', so);
  addScopeParam(p, 'gallery');
  return p.toString();
}

async function loadGalleryMore(){
  if (_galLoadingMore || _galDone) return;
  _galLoadingMore = true;
  const gen = _galGen;
  try {
    const d = await api('GET', `/v1/sets?${galleryParams(_galPage + 1)}`);
    if (gen !== _galGen) return;            // Filter hat sich zwischenzeitlich geändert
    const batch = d.sets || [];
    if (!batch.length) { _galDone = true; return; }
    _galPage++;
    allSets = allSets.concat(batch);
    if (allSets.length >= (_galTotal || 0)) _galDone = true;
    appendGallery(batch);
    updateGalleryPrices();
    kickGallerySentinel();     // s. Erklärung dort
  } catch (_) { /* stumm: der Sentinel versucht es beim nächsten Scrollen erneut */ }
  finally { if (gen === _galGen) _galLoadingMore = false; }
}

/** Hängt eine Folgeseite an, ohne die bereits gezeichneten Kacheln neu zu bauen. */
function appendGallery(batch){
  const c = G('gallery');
  const grid = c.querySelector('.sgrid');
  const tbody = c.querySelector('.dt tbody');
  if (curView === 'grid' && grid) {
    grid.insertAdjacentHTML('beforeend', batch.map(gridCard).join(''));
    observeLazyImages(grid);
  } else if (tbody) {
    tbody.insertAdjacentHTML('beforeend', batch.map(tableRow).join(''));
  } else {
    renderGallery();                        // Struktur fehlt (leerer Zustand)
  }
}

function maybeLoadMoreGallery(){
  if (!G('tab-gallery')?.classList.contains('active')) return;
  loadGalleryMore();
}

/**
 * Nachfassen, wenn der Sentinel OHNE Zustandswechsel sichtbar bleibt.
 *
 * IntersectionObserver meldet nur ÜBERGÄNGE. Steht der Sentinel schon im
 * Sichtfeld und der Inhalt wird darunter ersetzt (Eigentümerwechsel, Filter,
 * kurze Seite), kommt kein neues Ereignis — es lädt nichts mehr, bis der
 * Nutzer erst hoch- und wieder runterscrollt. Genau das hat Marco gemeldet.
 * Deshalb nach jedem Anhängen selbst nachsehen.
 */
function kickGallerySentinel(){
  const sent = G('gallery-sentinel');
  if (!sent) return;
  if (sent.getBoundingClientRect().top < window.innerHeight + 600) {
    requestAnimationFrame(maybeLoadMoreGallery);
  }
}

function bindGallerySentinel(){
  const sent = G('gallery-sentinel');
  if (!sent || sent._bound) return;
  sent._bound = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) maybeLoadMoreGallery(); },
      { rootMargin: '600px' }).observe(sent);
  } else {
    window.addEventListener('scroll', () => {
      if (sent.getBoundingClientRect().top < window.innerHeight + 600) maybeLoadMoreGallery();
    }, { passive: true });
  }
}


/**
 * Kontoauswahl beim Erfassen — nur im Haushalt.
 *
 * Die Liste kommt vom Server (/sets/household-members) und enthält bei einem
 * Konto ohne Verknüpfung genau einen Eintrag. Dann bleibt das Feld verborgen:
 * Eine Auswahl mit einer einzigen Möglichkeit ist keine Auswahl, sondern eine
 * Frage, die sich nicht stellt.
 */
/**
 * Kontofilter je Ansicht sichtbar machen und mit dem gespeicherten Wert füllen.
 *
 * Bleibt verborgen, solange das Konto keine Unterkonten hat: Ein Filter mit
 * genau einer möglichen Antwort ist keine Wahl, sondern eine Frage, die sich
 * nicht stellt.
 */
export function initScopeSelects(members) {
  const isMain = members.length > 1;
  // Einträge: Alle Konten, Eigene, dann JEDES Unterkonto namentlich.
  //
  // Der Sammelposten „Unterkonten" ist auf Marcos Wunsch entfallen: Er
  // beantwortete nur „nicht mir" und stand zwischen zwei Einträgen, die
  // dieselbe Frage genauer beantworten. Bei zwei Kindern war die Auswahl
  // damit fünf Zeilen lang, von denen eine nichts hinzufügte.
  //
  // Der Server versteht `accounts=subs` weiterhin (utils/household.ts) — eine
  // ältere App-Fassung auf einem Gerät schickt es sonst ins Leere.
  const subs = members.filter(m => !m.is_self);
  const opts = [
    `<option value="all">${esc(tRaw('household.scope_all'))}</option>`,
    `<option value="own">${esc(tRaw('household.scope_own'))}</option>`,
    ...subs.map(m => `<option value="${m.id}">${esc(m.username)}</option>`),
  ].join('');

  for (const view of SCOPE_VIEWS) {
    const el = G('scope-' + view);
    if (!el) continue;
    if (!isMain) { el.style.display = 'none'; continue; }
    el.innerHTML = opts;
    // Gespeicherte Wahl kann auf ein inzwischen entkoppeltes Konto zeigen —
    // dann auf „Alle" zurückfallen statt eine leere Auswahl zu zeigen.
    const saved = scopeMode(view);
    el.value = [...el.options].some(o => o.value === saved) ? saved : 'all';
    if (el.value !== saved) setScopeMode(view, el.value);
    el.style.display = '';
  }
}

/**
 * Umschalten — lädt NUR die betroffene Ansicht neu.
 *
 * Die Wahl gilt pro Ansicht; alle vier gleichzeitig neu zu laden würde drei
 * Ansichten anfassen, die niemand gerade ansieht, und dabei Preisabrufe
 * auslösen.
 */
export function onScopeChange(view) {
  const el = G('scope-' + view);
  if (!el) return;
  setScopeMode(view, el.value);
  if (view === 'gallery')  { loadGallery(); loadStats(); }
  // Die Reiter Teile und Minifiguren haben je ZWEI Listen: die aus Sets und
  // die manuell erfassten. Nur loadParts() neu zu laden liess den manuellen
  // Bereich ungefiltert stehen — er lädt über einen eigenen Endpunkt.
  if (view === 'parts')    { loadParts(); loadManualParts(); }
  if (view === 'minifigs') loadMinifigs();
  if (view === 'finance')  loadFinance();
}

export async function loadHouseholdMembers() {
  const d = await api('GET', '/v1/sets/household-members').catch(() => null);
  const members = d?.members || [];
  // Dieselbe Antwort entscheidet über den Kontofilter: mehr als ein Konto
  // heisst Hauptkonto mit Unterkonten.
  initScopeSelects(members);
  const html = members.map(m =>
    `<option value="${m.id}"${m.is_self ? ' selected' : ''}>${esc(m.username)}${m.is_self ? ' (ich)' : ''}</option>`
  ).join('');
  // Alle drei Erfassen-Formulare: Set, manuelles Teil, manuelle Minifigur.
  // Dieselbe Liste, dieselbe Regel — ein Kaufpreis für ein Kind zu erfassen
  // soll für alle drei gleich gehen.
  // cat-m-owner seit Nachtrag 66 dabei — der Katalog-Dialog ist der vierte
  // Erfassungsweg und war als einziger nicht angeschlossen.
  for (const id of ['add-owner', 'ap-owner', 'af-owner', 'cat-m-owner']) {
    const box = G(`${id}-box`), sel = G(id);
    if (!box || !sel) continue;
    if (members.length < 2) { box.style.display = 'none'; continue; }
    sel.innerHTML = html;
    box.style.display = '';
  }
}

/** Gewähltes Zielkonto eines Formulars — undefined, solange es keines gibt. */
export function selectedOwner(selectId) {
  const box = G(`${selectId}-box`), sel = G(selectId);
  if (!box || box.style.display === 'none' || !sel?.value) return undefined;
  return parseInt(sel.value);
}

/**
 * @param {{restore?: boolean}} [opts] restore=true behält die bereits
 *   gescrollte TIEFE und die Scrollposition bei.
 *
 * ── Warum es restore gibt (Nachtrag 34, Marcos Bericht) ─────────────────────
 * Nach einem Eigentümerwechsel im Kaufpreis-Dialog rief der Aufrufer schlicht
 * loadGallery(). Das setzt _galPage auf 1 zurück: Wer sich bis Zeile 50
 * durchgescrollt hatte, stand plötzlich vor 60 statt 300 Kacheln. Das Dokument
 * schrumpft, der Browser klemmt den Scrollbalken ans neue Ende — der gefühlte
 * „Sprung nach oben". Und weil der Sentinel dabei sichtbar BLEIBT, meldet der
 * IntersectionObserver keinen Übergang: Es lud erst wieder, nachdem man hoch-
 * und zurückgescrollt war. Beides genau wie gemeldet.
 *
 * restore holt die volle Tiefe in EINER Anfrage zurück (der Server deckelt
 * page_size bei MAX_PAGE_SIZE=500; darüber übernimmt der Sentinel wie sonst)
 * und stellt die Scrollposition nach dem Zeichnen wieder her.
 */
export async function loadGallery(opts = {}){
  // Tiefe und Position merken, BEVOR irgendetwas zurückgesetzt wird.
  const tiefe   = opts.restore ? Math.max(1, _galPage) : 1;
  const scrollY = opts.restore ? window.scrollY : null;
  // Vielfaches von GAL_PAGE_SIZE unter der Serverdeckelung — sonst stimmt die
  // Seitenrechnung für das nächste Nachladen nicht mehr.
  const holen   = Math.min(tiefe * GAL_PAGE_SIZE, 480);

  // Spinner NUR beim ersten Laden. Vorher wurde das Grid bei jedem Aufruf
  // sofort geleert — also auch dann, wenn schon gültige Kacheln standen und
  // bloss aufgefrischt wurde. Genau das war die kurz leere Wand beim Neuladen
  // und nach dem Login. Sind bereits Sets da, bleiben sie stehen, bis die neue
  // Antwort da ist; erst dann wird einmal neu gezeichnet.
  const gal = G('gallery');
  if (!allSets.length || !gal.querySelector('.sgrid, .tw, .empty')) {
    gal.innerHTML = ladeAnzeige(t('gallery.loading'));
  }
  _galGen++; _galPage = 1; _galDone = false; _galLoadingMore = false;
  const gen = _galGen;
  const d=await api('GET', `/v1/sets?${galleryParams(1, holen)}`);
  if (gen !== _galGen) return;
  allSets=d.sets||[];
  _galTotal = d.total ?? allSets.length;
  // Seitenzähler an die tatsächlich geholte Menge angleichen, damit die nächste
  // Folgeseite am richtigen Versatz ansetzt.
  _galPage = Math.max(1, Math.ceil(allSets.length / GAL_PAGE_SIZE));
  if (allSets.length >= _galTotal) _galDone = true;
  bindGallerySentinel();
  // Füllt die erste Seite den Bildschirm nicht, gäbe es nie ein Scroll-Ereignis.
  requestAnimationFrame(maybeLoadMoreGallery);
  
  // Populate theme dropdown
  // Themen kommen vom Server: allSets enthält seit der Paginierung nur noch die
  // erste Seite, das Auswahlfeld wäre sonst unvollständig.
  const themeEl = G('gtheme');
  if (themeEl && Array.isArray(d.themes)) {
    const current = themeEl.value;
    themeEl.innerHTML = `<option value="">${t('gallery.filter.all')}</option>` +
      d.themes.map(th=>`<option value="${esc(th)}"${th===current?' selected':''}>${esc(th)}</option>`).join('');
    themeEl.value = current;
  }
  if (themeEl && !themeEl._bound) { themeEl._bound = true; themeEl.addEventListener('change', loadGallery); }
  renderGallery(); loadStats();
  // Erst NACH dem Zeichnen zurückspringen — vorher ist das Dokument noch kurz
  // und der Browser würde die Position wieder abschneiden.
  if (scrollY != null) requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
  enrichGalleryWithPrices();
}
export function renderGallery(){
  // Filtern und Sortieren macht der Server (getSets in utils/handlers.ts) —
  // hier wird nur noch gezeichnet, was geladen ist. Andernfalls würde ein
  // Filter bloss die aktuell geladene Seite durchsuchen.
  const q=G('gs')?.value?.toLowerCase()||'';
  const list=allSets;
  const c=G('gallery');
  if(!list.length){c.innerHTML=`<div class="empty"><img src="/assets/set-placeholder.svg" style="width:64px;height:64px;opacity:.4;margin:0 auto 12px;display:block" /><h3>${t('gallery.no_results',{query:q})}</h3><p>${q?t('gallery.no_results',{query:q}):t('gallery.empty')}</p></div>`;return;}
  if(curView==='grid'){
    c.innerHTML=`<div class="sgrid">${list.map(gridCard).join('')}</div>`;
    observeLazyImages(c);
  } else {
    c.innerHTML=`<div class="tw"><table class="dt"><thead><tr><th>${t('detail.pieces')}</th><th>Nr.</th><th>${t('gallery.sort.name')}</th><th>${t('detail.year')}</th><th>${t('detail.theme')}</th><th>${t('detail.pieces')}</th><th>${t('detail.minifigs')}</th><th>${t('detail.qty')}</th><th>${t('detail.instructions')}</th><th>${t('parts.stat.total')}</th><th></th></tr></thead><tbody>${list.map(tableRow).join('')}</tbody></table></div>`;
    observeLazyImages(c);   // fehlte für die Listenansicht komplett
  }
}
/**
 * Trägt Marktpreis und Gewinn/Verlust in die bestehenden Kacheln nach.
 *
 * Ersetzt den früheren renderGallery()-Aufruf am Ende von
 * enrichGalleryWithPrices(): Der hat die komplette Kachelwand per innerHTML neu
 * gebaut, nur um pro Kachel eine Zeile zu ergänzen. Alle <img> waren dadurch
 * neue Elemente und blendeten erneut ein — das sichtbare Flackern ein paar
 * Sekunden nach dem Laden bzw. direkt nach dem Login.
 *
 * Hier wird ausschliesslich der Preis-Container angefasst; Bilder, Scrollposition
 * und Fokus bleiben unberührt.
 */
export function updateGalleryPrices(){
  const bySet = new Map(allSets.map(x => [x.set_number, x]));
  document.querySelectorAll('[data-price-for]').forEach(el => {
    const s = bySet.get(el.dataset.priceFor);
    if (!s) return;
    const priceStr = s._price ? fmtN(s._price, CURRENCY)
                              : (s.max_purchase_price != null ? fmtN(s.max_purchase_price, CURRENCY) : '');
    const pnl = pnlBadge(s._pnl_pct);
    el.innerHTML = `<span style="font-weight:600;color:var(--b600)">${priceStr}</span>${pnl}`;
    el.hidden = !(priceStr || pnl);
  });
}

export function pnlBadge(pct){
  if(pct===null||pct===undefined) return '';
  const v=parseFloat(pct); const cls=v>0?'pnl-pos':v<0?'pnl-neg':'pnl-neu';
  return `<span class="${cls}">${v>0?'+':''}${v.toFixed(1)}%</span>`;
}

/**
 * Zustands-Plaketten eines Eintrags — eine je erfasstem Zustand.
 *
 * ── Warum eine Liste ────────────────────────────────────────────────────────
 * `condition` ist ein Aggregat und liefert genau einen Wert („gebraucht,
 * sobald eine Erfassung gebraucht ist"). Wer ein Exemplar neu und eines
 * gebraucht gekauft hat, sah damit nur „Gebraucht" — die Neu-Erfassung war
 * unsichtbar, obwohl sie mit ihrem eigenen Preis in die Bewertung eingeht.
 *
 * `conditions` kommt vom Server (utils/handlers.ts, conditionsFromAcquisitions)
 * und ist die EINE Stelle, an der entschieden wird, welche Plaketten es gibt.
 * Hier wird nichts nachgerechnet; ältere Antworten ohne das Feld fallen auf
 * `condition` zurück.
 *
 * Steht in dieser Datei, weil Galerie-, Minifiguren- und Teile-Kacheln sie
 * alle brauchen — vorher stand dieselbe Plakette viermal im Code, dreimal
 * davon mit fest eingetragenen Farben statt der CSS-Klassen.
 */
/**
 * Besitzer-Plaketten — nur im Haushalt.
 *
 * Der Server hängt `owners` nur an, wenn mehrere Konten im Blickfeld sind. Im
 * Einzelkonto stünde an jeder Kachel „gehört mir", und das ist reines
 * Rauschen. Im Haushalt ist es dagegen die wichtigste Angabe der Kachel: Ohne
 * sie verschiebt man das falsche Exemplar.
 *
 * Mehrere Namen heisst, dass dasselbe Set in mehreren Konten liegt — die
 * Kachel zeigt es bewusst nur EINMAL, mit der Summe der Mengen.
 */
export function ownerBadges(item) {
  if (!item?.owners?.length) return '';
  return item.owners.map(o =>
    `<span class="cond-badge" style="background:var(--b100);color:var(--b600)">${esc(o.username)}</span>`
  ).join('');
}

export function condBadges(item) {
  const list = Array.isArray(item?.conditions) && item.conditions.length
    ? item.conditions
    : [item?.condition === 'U' ? 'U' : 'N'];
  return list.map(c => c === 'U'
    ? `<span class="cond-badge cond-used">${t('common.condition_used')}</span>`
    : `<span class="cond-badge cond-new">${t('common.condition_new')}</span>`
  ).join('');
}

function gridCard(s){
  const src=s.image_local||s.image_url||'';
  // thumbUrl() greift nur bei lokal abgelegten Bildern (_thumb-Variante).
  // Sets ohne lokale Kopie laufen über den Proxy — dort erzeugt imgUrl(…, true)
  // die verkleinerte Fassung, sonst käme die volle Auflösung für eine Kachel.
  const thumb=src?imgUrl(thumbUrl(src)||src, true):null;
  const img=src?`<img src="${escUrl(thumb||src)}" loading="lazy" decoding="async" data-fade="1" data-orig="${escUrl(src)}" />`:`<img src="/assets/set-placeholder.svg" alt="Set" class="loaded" style="width:65%;height:65%;object-fit:contain;opacity:.85" />`;
  // Ohne geladenen Marktpreis der mengengewichtete Kaufpreis. Vorher stand
  // hier max_purchase_price — bei 2x100 und 1x160 zeigte die Kachel 160 statt
  // der tatsächlichen 120.
  const fallbackPurchase = s.avg_purchase_price ?? s.max_purchase_price;
  const priceStr = s._price ? fmtN(s._price, CURRENCY) : (fallbackPurchase!=null ? fmtN(fallbackPurchase, CURRENCY) : '');
  const pnl = pnlBadge(s._pnl_pct);
  const addedFmt = s.added_at ? new Date(s.added_at).toLocaleDateString(locale()) : '';
  // Zustand: Der Server liefert die vorkommenden Zustände als Aggregat —
  // eine Plakette je Zustand, siehe condBadges().
  const condBadge = condBadges(s);
  return `<div class="sc" data-click="openModal" data-arg="${escJs(s.set_number)}">
    <div class="ca"><button class="delbtn" data-click="delSetStop" data-arg="${esc(s.set_number)}" title="${esc(t('detail.delete'))}" aria-label="${esc(t('detail.delete'))}">${TRASH_ICON_SVG}</button></div>
    <div class="sci">${img}</div>
    <div class="scb">
      <div class="snum">${esc(s.set_number)}</div>
      <div class="sname">${esc(s.name)||'Unbekannt'}</div>
      <div class="smeta">
        <span style="font-size:.68rem">${s.year||'—'}${s.theme?' · '+esc(s.theme.substring(0,12)):''}</span>
        <div style="display:flex;gap:3px;align-items:center;flex-wrap:wrap">
          ${s.instructions?.length?`<span class="ibadge">📋${s.instructions.length}</span>`:''}
          ${s.quantity>1?`<span class="qbadge">×${s.quantity}</span>`:''}
          ${condBadge}
          ${ownerBadges(s)}
        </div>
      </div>
      <div class="price-badge" data-price-for="${esc(s.set_number)}"${priceStr||pnl ? '' : ' hidden'}><span style="font-weight:600;color:var(--b600)">${priceStr}</span>${pnl}</div>
      ${addedFmt ? `<div style="font-size:.65rem;color:var(--mut);margin-top:.2rem">📅 ${addedFmt}</div>` : ''}
    </div>
  </div>`;
}
function tableRow(s){
  const src=s.image_local||s.image_url||'';
  const addedFmt = s.added_at ? new Date(s.added_at).toLocaleDateString(locale()) : '—';
  return `<tr style="cursor:pointer" data-click="openModal" data-arg="${escJs(s.set_number)}">
    <td>${src?`<img src="${escUrl(imgUrl(thumbUrl(src)||src, true)||'')}" loading="lazy" decoding="async" data-onerror="clear" />`:'—'}</td>
    <td><span style="font-family:var(--mono);color:var(--b600);font-size:.77rem">${esc(s.set_number)}</span></td>
    <td>${esc(s.name)||'—'}</td><td>${s.year||'—'}</td><td>${esc(s.theme)||'—'}</td>
    <td>${s.pieces?s.pieces.toLocaleString(locale()):'—'}</td><td>${s.minifigs||'—'}</td>
    <td><span class="qbadge">×${s.quantity}</span></td>
    <td style="font-size:.75rem;color:var(--mut)">${addedFmt}</td>
    <td>${s.instructions?.length?`<span class="ibadge">📋${s.instructions.length}</span>`:'—'}</td>
    <td data-click="stopEvent"><button class="btn bs btn-sm" data-click="reimportParts" data-arg="${escJs(s.set_number)}">${PARTS_ICON_SVG}</button></td>
    <td data-click="stopEvent"><button class="btn bd btn-sm" data-click="delSet" data-arg="${escJs(s.set_number)}" title="${esc(t('detail.delete'))}" aria-label="${esc(t('detail.delete'))}">${TRASH_ICON_SVG}</button></td>
  </tr>`;
}

// Add set via SSE stream
G('btn-add').onclick=doAddSet;
G('add-num').addEventListener('keydown',e=>e.key==='Enter'&&doAddSet());
async function doAddSet(){
  const num=G('add-num').value.trim(), qty=parseInt(G('add-qty').value)||1;
  const priceVal = G('add-price')?.value;
  const purchase_price = (priceVal != null && String(priceVal).trim() !== '' && !isNaN(parseFloat(priceVal))) ? parseFloat(priceVal) : null;
  const condition = G('add-condition')?.value || 'N';
  // Zielkonto nur mitschicken, wenn die Auswahl überhaupt sichtbar ist. Ohne
  // Haushalt schickt die Webapp gar nichts, und der Server bleibt beim
  // eigenen Konto — dieselbe Antwort wie vor der Haushaltssicht.
  const owner_user_id = selectedOwner('add-owner');
  if(!num){toast(tRaw('common.enter_set_number'),'error');return;}
  showProgress(t('gallery.adding_set',{num}), false);
  try{
    await streamRequest('/api/v1/sets/add-stream', {set_number:num,quantity:qty,purchase_price,condition,owner_user_id}, (ev)=>{
      handleSseEvent(ev, num);
      if(ev.step==='done' && ev.action==='exists'){
        // Set steht schon im Blickfeld — der Server hat NICHTS geschrieben
        // (Marcos Festlegung, utils/setAdd.ts). Statt einer Meldung öffnet
        // sich die Detailansicht, genau wie in der App.
        _activeAbort=null; G('btn-cancel-import').style.display='none';
        hideProgress();
        G('add-num').value='';
        openModal(ev.set_number);
        return;
      }
      if(ev.step==='done'){
        _activeAbort=null; G('btn-cancel-import').style.display='none';
        setTimeout(()=>{
          hideProgress(); loadGallery(); loadStats();
          G('add-num').value=''; if(G('add-price')) G('add-price').value='';
          toast(`Set ${esc(ev.set_number)} ${ev.action==='added'?t('common.added'):t('common.updated')}!`,'success');
          // Background jobs still running — refresh all tabs periodically
          set_lastImportAt(Date.now());
          [3000, 8000, 15000, 25000].forEach(delay => setTimeout(()=>{
            loadGallery(); loadStats();
            const activeTab = document.querySelector('.ntab.active')?.dataset?.tab;
            if(activeTab==='parts')    { loadParts(); loadManualParts(); }
            if(activeTab==='minifigs') { loadMinifigs(); }
          }, delay));
        },800);
      }
      else if(ev.step==='error'){ _activeAbort=null; G('btn-cancel-import').style.display='none'; setTimeout(()=>{hideProgress();toast(ev.error,'error');},1500); }
    });
  }catch(e){if(e.name!=='AbortError'){hideProgress();toast(e.message,'error');}}
}

// CSV import via SSE stream — Datei-Auswahl startet den Import direkt (analog Teile-Import)
async function startSetCsvImport(){
  const fi=G('csv-file'); if(!fi.files[0]){toast(tRaw('csv.select_file'),'error');return;}
  showProgress(t('csv.import_title'), true);
  const fd=new FormData(); fd.append('file',fi.files[0]);
  try{
    // Start import job (returns immediately)
    const start = await fetch('/api/v1/sets/import/csv',{method:'POST',body:fd});
    const startData = await start.json();
    if(!startData.success){ hideProgress(); toast(startData.error||t('settings.error'),'error'); return; }
    const total = startData.total;
    // Übersprungene Zeilen nennen — der Import läuft trotzdem weiter, aber wer
    // 500 Zeilen schickt und 498 importiert bekommt, soll es erfahren.
    if (startData.skipped_hint) toast(startData.skipped_hint, 'info');
    G('prog-footer').textContent=tRaw('csv.sets_progress',{done:0,total});

    _csvPollActive = true;
    gibStart(); // globalen Balken zeigen (dieses + andere Fenster)
    G('btn-cancel-import').style.display='inline-flex';

    // Fortschritt bevorzugt über SSE; nur bei Ausfall Polling-Fallback.
    const ctx = { total, prevDone:-1, prevResultCount:0 };
    const wt = sessionStorage.getItem('webToken');
    const url = '/api/v1/sets/import/csv/stream' + (wt ? ('?token=' + encodeURIComponent(wt)) : '');
    let usedSse = false;

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };

      if (typeof EventSource !== 'undefined') {
        try {
          const es = new EventSource(url, { withCredentials: true });
          usedSse = true;
          es.onmessage = (e) => {
            let s; try { s = JSON.parse(e.data); } catch(_) { return; }
            const finished = csvApplyOverlayStatus(s, ctx, fi);
            if (finished) { es.close(); finish(); }
          };
          es.onerror = () => {
            es.close();
            if (!settled) {
              // SSE weg → auf Polling zurückfallen
              usedSse = false;
              csvPollLoop(ctx, fi).then(finish);
            }
          };
        } catch(_) {
          csvPollLoop(ctx, fi).then(finish);
        }
      } else {
        csvPollLoop(ctx, fi).then(finish);
      }
    });
  }catch(e){ hideProgress(); toast(e.message,'error'); }
}

// Verarbeitet ein CSV-Status-Objekt fürs Overlay des startenden Fensters.
// Gibt true zurück, wenn der Import abgeschlossen ist.
function csvApplyOverlayStatus(s, ctx, fi){
  if(!s.success) return true;
  const total = ctx.total;
  if(s.done !== ctx.prevDone){
    ctx.prevDone = s.done;
    const done = s.done;
    const pct = total>0 ? (done/total)*95 : 0;
    setProgBar(pct);
    G('prog-footer').textContent=`${t('csv.sets_progress',{done,total})} (${s.ok} ok${s.warn?', '+s.warn+' '+t('csv.warnings'):''}${s.err?', '+s.err+' '+t('csv.errors'):''})`;
    if(s.current) G('prog-set-name').textContent=`Verarbeite: ${s.current} (${done}/${total})`;
    // Update header progress bar directly
    { const _p=total>0?Math.round(done/total*100):0; const _b=G('global-import-bar'); if(_b){_b.style.display='flex';G('gib-fill').style.width=_p+'%';G('gib-text').textContent=done+'/'+total+' ('+_p+'%)';} }
    // Show live results as they come in
    if(s.results && s.results.length > ctx.prevResultCount) {
      const newResults = s.results.slice(ctx.prevResultCount);
      newResults.forEach(r => {
        if(r.success) addCsvLog('✅ '+r.set_number+' – '+(r.action==='added'?t('common.added'):t('common.updated')), true);
        else if(r.isWarning) addCsvLog('⚠️ '+r.set_number+': '+r.error, false);
        else addCsvLog('❌ '+r.set_number+': '+(r.error||t('settings.error')), false);
      });
      ctx.prevResultCount = s.results.length;
    }
  }
  if(s.status==='done'||s.status==='cancelled'||s.status==='error'){
    _csvPollActive=false;
    G('btn-cancel-import').style.display='none';
    setProgBar(100);
    if(s.status==='error'){ hideProgress(); toast(s.error||t('csv.import_error'),'error'); }
    else{
      // Add any remaining results not yet shown in live log
      if(s.results) {
        const remaining = s.results.slice(ctx.prevResultCount);
        remaining.forEach(r=>{
          if(r.success) addCsvLog(`✅ ${esc(r.set_number)} – ${r.action==='added'?t('common.added'):t('common.updated')}`,true);
          else if(r.isWarning) addCsvLog(`⚠️ ${esc(r.set_number)}: ${esc(r.error)} (${t('csv.timeout_retry')})`,false);
          else addCsvLog(`❌ ${esc(r.set_number)}: ${r.error||t('common.unknown_error')}`,false);
        });
        ctx.prevResultCount = s.results.length;
      }
      if(s.err>0){
        const errSets = (s.results||[]).filter(r=>!r.success);
        const errList = errSets.map(r=>r.set_number+': '+(r.error||'?')).join('; ');
        console.warn('[CSV Import] Fehler: '+errList);
      }
      const warnTxt = s.warn ? `, ${s.warn} ${t('csv.timeout_warn')}` : '';
      const errTxt  = s.err  ? `, ${s.err} ${t('csv.errors')}` : '';
      G('prog-footer').textContent=`✅ Import: ${s.ok} ok${warnTxt}${errTxt}`;
      const btnClose = G('btn-close-import');
      if (btnClose) btnClose.style.display = '';
      loadGallery();
      toast(`Import: ${s.ok} ok${warnTxt}${errTxt}`,s.err?'error':s.warn?'info':'success');
      if(fi) fi.value='';
    }
    return true;
  }
  return false;
}

// Polling-Fallback für das startende Fenster (nur wenn SSE nicht verfügbar).
async function csvPollLoop(ctx, fi){
  while(_csvPollActive){
    await new Promise(r=>setTimeout(r,1500));
    if(!_csvPollActive) break;
    try{
      const s = await api('GET','/v1/sets/import/csv/status');
      if(csvApplyOverlayStatus(s, ctx, fi)) break;
    }catch(e){ console.warn('Poll error:',e); }
  }
}


// ── CSV import polling state ─────────────────────────────────────────────────
export let _csvPollActive = false;

function cancelImport(){
  _csvPollActive = false;
  api('POST','/v1/sets/import/csv/cancel').catch(()=>{});
  G('btn-cancel-import').style.display='none';
  hideProgress();
  toast(tRaw('csv.cancelled'),'info');
  loadGallery();
}
G('btn-cancel-import').onclick = cancelImport;

// SSE helper for JSON body — abortable
export function streamRequest(url, body, onEvent){
  _activeAbort = new AbortController();
  G('btn-cancel-import').style.display='inline-flex';
  return new Promise((resolve,reject)=>{
    fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:_activeAbort.signal})
      .then(res=>readSSE(res,onEvent,_activeAbort.signal)).then(resolve).catch(e=>{
        if(e.name==='AbortError') resolve(); else reject(e);
      });
  });
}
// SSE helper for FormData — abortable
function streamRequestForm(url, formData, onEvent){
  _activeAbort = new AbortController();
  G('btn-cancel-import').style.display='inline-flex';
  return new Promise((resolve,reject)=>{
    fetch(url,{method:'POST',body:formData,signal:_activeAbort.signal})
      .then(res=>readSSE(res,onEvent,_activeAbort.signal)).then(resolve).catch(e=>{
        if(e.name==='AbortError') resolve(); else reject(e);
      });
  });
}
async function readSSE(res, onEvent, signal){
  // Antwortet der Server mit gewöhnlichem JSON statt einem Ereignisstrom, ist
  // die Sache schon entschieden — beim Erfassen etwa, wenn das Set bereits im
  // Blickfeld steht (utils/setAdd.ts). Dann gibt es nichts zu verfolgen, und
  // die eine Antwort wird wie ein einzelnes Ereignis durchgereicht. Ohne
  // diesen Zweig liefe der Leser über JSON-Text, fände keine `data:`-Zeile und
  // der Aufrufer bekäme nie ein Ereignis — die Anzeige bliebe hängen.
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    const daten = await res.json().catch(() => null);
    if (daten) onEvent({ step: daten.success === false ? 'error' : 'done', ...daten });
    return;
  }
  const reader=res.body.getReader(), dec=new TextDecoder(); let buf='';
  try{
    while(true){
      if(signal?.aborted) break;
      const {done,value}=await reader.read();
      if(done) break;
      buf+=dec.decode(value,{stream:true});
      const lines=buf.split('\n'); buf=lines.pop();
      for(const line of lines){
        if(line.startsWith('data: ')){
          try{ onEvent(JSON.parse(line.slice(6))); }catch(e){}
        }
      }
    }
  } catch(e){
    if(e.name!=='AbortError') throw e;
  } finally {
    try{ reader.cancel(); }catch(_){}
  }
}

G('vg').onclick=()=>{ curView='grid'; G('vg').classList.add('active'); G('vl').classList.remove('active'); renderGallery(); };
G('vl').onclick=()=>{ curView='list'; G('vl').classList.add('active'); G('vg').classList.remove('active'); renderGallery(); };
// Suche entprellt: renderGallery baut das komplette Grid per innerHTML neu auf
// (inkl. Lazy-Image-Observer) — bei jedem Tastendruck wäre das bei grossen
// Sammlungen spürbar ruckelig. 250ms Debounce, wie bei der Parts-Suche.
// Suche und Sortierung gehen an den Server, also neu LADEN statt neu zeichnen.
G('gs').addEventListener('input',()=>{ clearTimeout(G('gs')._t); G('gs')._t=setTimeout(loadGallery,250); });
G('gsort').addEventListener('change',loadGallery);

/**
 * Ein Set löschen — mit GENAU EINER Rückfrage.
 *
 * ── Marcos Befund ──────────────────────────────────────────────────────────
 * „Wenn ich in der Webapp ein Set lösche, erscheinen 2 Rückfragen."
 *
 * Der Löschknopf im Detail-Dialog fragte selbst nach und rief danach diese
 * Funktion, die ein zweites Mal fragte. Von der Kachel und aus der Listenzeile
 * kam nur eine — dieselbe Handlung, drei Einstiege, zwei verschiedene
 * Erlebnisse.
 *
 * Die Rückfrage steht jetzt NUR hier, an der einen Stelle, die tatsächlich
 * löscht. Ein Aufrufer, der selbst fragt, ist damit gar nicht mehr möglich,
 * ohne dass es auffällt.
 *
 * Der Text nennt den Namen, wenn er bekannt ist. Das war vorher der einzige
 * Vorzug der Extra-Rückfrage im Dialog, und der bleibt erhalten.
 *
 * Gelöscht wird beim Server in einer Transaktion: Set, seine Teile, seine
 * Minifiguren und die Kaufpreise (deleteSetRows in utils/handlers.ts).
 *
 * @returns {Promise<boolean>} true, wenn wirklich gelöscht wurde
 */
export async function delSet(sn){
  const bekannt = (curSet && curSet.set_number === sn ? curSet : null)
    || (allSets || []).find(x => x.set_number === sn);
  const name = bekannt?.name || sn;
  if(!await confirmDelete(tRaw('gallery.delete.title'), t('gallery.delete.name_parts',{name}))) return false;
  const d=await api('DELETE',`/v1/sets/${sn}`);
  if(!d.success){ toast(d.error,'error'); return false; }
  toast(tRaw('users.deleted',{name:sn}),'success');
  // Alles nachladen, was mitgelöscht wurde. loadStats() fehlte: Die Kennzahlen
  // im Kopf (Sets, Einheiten, Teile, Minifiguren) blieben nach dem Löschen auf
  // dem alten Stand, obwohl die Teile und Minifiguren des Sets mit weg sind.
  loadGallery(); loadParts(); loadStats();
  return true;
}
export async function reimportParts(sn){ toast(tRaw('detail.importing_parts',{sn}),'info'); const d=await api('POST',`/v1/sets/${sn}/parts`); if(d.success){toast(tRaw('detail.parts_imported',{count:d.count}),'success');loadParts();} else toast(d.error,'error'); }

// ── MODAL ─────────────────────────────────────────────
export let curSet=null;
export let _pnlCache = {};
// Gemeinsames "Haufen von Steinen"-Icon für Teile (Nav-Tab, Platzhalter, Überschriften)
export const PARTS_ICON_SVG = '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" style="width:1em;height:1em;vertical-align:middle"><rect x="18" y="62" width="56" height="26" rx="2.5" fill="#0055BF"/><circle cx="28" cy="62" r="5.5" fill="#0055BF"/><circle cx="46" cy="62" r="5.5" fill="#0055BF"/><circle cx="64" cy="62" r="5.5" fill="#0055BF"/><g transform="rotate(-9 66 55)"><rect x="38" y="42" width="52" height="24" rx="2.5" fill="#F2CD37"/><circle cx="49" cy="42" r="5" fill="#F2CD37"/><circle cx="64" cy="42" r="5" fill="#F2CD37"/><circle cx="79" cy="42" r="5" fill="#F2CD37"/></g><g transform="rotate(7 58 80)"><rect x="26" y="76" width="58" height="26" rx="2.5" fill="#E63329"/><circle cx="37" cy="76" r="5.5" fill="#E63329"/><circle cx="55" cy="76" r="5.5" fill="#E63329"/><circle cx="73" cy="76" r="5.5" fill="#E63329"/></g></svg>';
// openModal defined below (with price history)

export function renderInstructions(instr, sn) {
  const items = instr.map(i => {
    const href = i.local_path || i.url;
    const isLocal = !!i.local_path;
    const isUpload = i.local_path && i.local_path.startsWith('/data/uploads/');
    const label = esc(i.description) || t('instr.label');
    // Lokale Dateien (PDF/Bild) im In-App-Viewer öffnen; externe URLs im neuen Tab.
    const link = isLocal
      ? `<a href="${escUrl(href)}" data-click="openPdfViewerLink" data-arg="${esc(href)}" data-arg2="${esc(i.description||'')}" style="cursor:pointer">${label}</a>`
      : `<a href="${escUrl(href)}" target="_blank" rel="noopener">${label}</a>`;
    return `<div class="ii" id="instr-${i.id}">
      ${link}
      ${isUpload ? `<span class="lv" style="background:var(--p100);color:var(--p600)">${t('instr.badge_manual')}</span>` : isLocal ? '<span class="lc">💾</span>' : '<span class="lv">🌐</span>'}
      <button data-click="delInstr" data-arg="${esc(sn)}" data-arg2="${i.id}" title="${t('instr.delete_tooltip')}" style="background:none;border:none;cursor:pointer;color:var(--s400);font-size:.85rem;padding:0 2px">✕</button>
    </div>`;
  }).join('');

  const uploadForm = `
    <div id="instr-upload-form" style="margin-top:10px;padding:10px;background:var(--s50);border:1px dashed var(--bdr);border-radius:8px">
      <div style="font-size:.75rem;font-weight:600;color:var(--mut);margin-bottom:7px">${t('instr.upload_title')}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:140px">
          <input type="text" id="instr-desc" placeholder="${t('instr.desc_placeholder')}" style="font-size:.8rem;padding:6px 10px" />
        </div>
        <label class="btn bs btn-sm" style="cursor:pointer">
          ${t('instr.choose_file')}
          <input type="file" id="instr-file" accept=".pdf,.jpg,.jpeg,.png" style="display:none" data-change="uploadInstr" data-arg="${escJs(sn)}" />
        </label>
      </div>
      <div id="instr-upload-status" style="font-size:.78rem;margin-top:6px;color:var(--mut)"></div>
    </div>`;

  G('m-instr').innerHTML = `
    <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin:12px 0 7px">
      ${t('instr.section_title')} ${instr.length ? `(${instr.length})` : ''}
      <button data-click="redownloadInstr" data-arg="${escJs(sn)}" class="btn bs btn-sm" style="margin-left:8px;font-size:.7rem;padding:3px 8px">${t('instr.reload')}</button>
    </div>
    ${items || `<div style="color:var(--mut);font-size:.82rem">${t('instr.none_auto')}</div>`}
    ${uploadForm}`;
}

async function delInstr(sn, instrId) {
  if (!await confirmDelete(tRaw('instr.delete_title'),t('instr.delete_text'),'📄')) return;
  const d = await api('DELETE', `/v1/sets/${sn}/instructions/${instrId}`);
  if (d.success) { toast(tRaw('instr.deleted'), 'success'); openModal(sn); }
  else toast(d.error || t('settings.error'), 'error');
}

async function uploadInstr(sn) {
  const fi = G('instr-file');
  if (!fi.files[0]) return;
  const status = G('instr-upload-status');
  status.textContent = tRaw('common.uploading');
  const fd = new FormData();
  fd.append('file', fi.files[0]);
  const desc = G('instr-desc').value.trim();
  if (desc) fd.append('description', desc);
  try {
    const r = await fetch(`/api/v1/sets/${sn}/instructions/upload`, { method: 'POST', body: fd });
    const d = await r.json();
    if (d.success) { toast(tRaw('instr.uploaded'), 'success'); openModal(sn); }
    else { status.textContent = '❌ ' + (d.error || t('settings.error')); status.style.color = 'var(--r500)'; }
  } catch (e) { status.textContent = '❌ ' + t('common.network_error'); }
}

// export, weil 07-admin.js die Funktion nach einem Eigentümerwechsel aufruft.
// Ohne das war sie dort schlicht nicht vorhanden: „closeModal is not defined",
// geworfen aus dem <select> für das Zielkonto. Der Wechsel war zu dem Zeitpunkt
// schon gespeichert — sichtbar blieb ein offener Dialog und eine Galerie mit
// altem Stand. Die Anmeldung über registerActions() reicht nur für
// data-click-Knöpfe im HTML, nicht für Aufrufe aus anderen Modulen.
export function closeModal(){ G('set-modal').classList.remove('open'); curSet=null; }
export function openImageLightbox(src){
  if(!src || src.endsWith('/assets/set-placeholder.svg')) return;
  G('lightbox-img').src = src;
  G('img-lightbox').classList.add('open');
}
export function closeImageLightbox(){ G('img-lightbox').classList.remove('open'); G('lightbox-img').src=''; }
document.addEventListener('keydown', e => { if(e.key==='Escape' && G('img-lightbox').classList.contains('open')) closeImageLightbox(); });
G('set-modal').addEventListener('click',e=>e.target.id==='set-modal'&&closeModal());

let _autosaveTimer=null;
export function autosaveSet(){
  if(!curSet) return;
  clearTimeout(_autosaveTimer);
  _autosaveTimer=setTimeout(async ()=>{
    const qty = parseInt(G('m-qty').value)||1;
    const prevQty = curSet.quantity || qty;
    const d = await api('PUT',`/v1/sets/${esc(curSet.set_number)}`,{quantity:qty});
    if(d.success){
      // Die WIRKLICHE Gesamtmenge kommt vom Server (Nachtrag 87).
      //
      // Angezeigt wird die Menge aller Konten, geschrieben wird die Differenz
      // auf das eigene. Beim VERRINGERN deckelt der Server bei den eigenen
      // Exemplaren — fremde lassen sich nicht wegnehmen —, und dann steht in
      // der Antwort eine andere Zahl als die gesendete. Ohne diese Übernahme
      // bliebe im Feld die eigene Annahme stehen, bis der Dialog neu geöffnet
      // wird.
      const echt = Number.isInteger(d.quantity) ? d.quantity : qty;
      curSet.quantity = echt;
      if (echt !== qty) G('m-qty').value = echt;
      // Bei jeder Mengenänderung die Erfassungs-Übersicht neu laden: beim
      // Erhöhen entsteht eine neue Zeile, beim Reduzieren fällt (LIFO) die
      // letzte weg — sonst blieb die entfernte Zeile in der Detailsicht stehen.
      if (echt !== prevQty && typeof renderAcquisitionSummary === 'function') {
        api('GET', `/v1/sets/${esc(curSet.set_number)}/acquisitions`).then(ad => {
          if (!ad?.success) return;
          const sumEl = G('m-acq-summary');
          if (sumEl) sumEl.innerHTML = renderAcquisitionSummary(ad.acquisitions, curSet.set_number) +
            `<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${escJs(curSet.set_number)}" style="margin-top:4px;font-size:.75rem;padding:2px 10px">✏️ ${t('detail.edit_prices')}</button>`;
          if (G('acq-modal').classList.contains('open') && typeof renderAcqModalBody === 'function') {
            renderAcqModalBody(curSet.set_number, ad.acquisitions);
          }
        }).catch(()=>{});
      }
      toast(tRaw('settings.saved'),'success');
      loadGallery();
      if(document.querySelector('.ntab.active')?.dataset?.tab==='finance') loadFinance();
    } else { toast(d.error||t('settings.error'),'error'); }
  }, 400);
}

// Keine eigene Rückfrage mehr — delSet() fragt (siehe dort). Der Dialog
// schliesst nur, wenn wirklich gelöscht wurde; sonst stünde er nach einem
// „Abbrechen" leer da.
G('btn-md').onclick=async()=>{ if(!curSet) return; if(await delSet(curSet.set_number)) closeModal(); };
async function redownloadInstr(sn){ toast(tRaw('instr.loading'),'info'); const d=await api('POST',`/v1/sets/${sn}/instructions`); if(d.success){toast(tRaw('instr.loaded',{count:d.instructions.length}),'success');if(curSet){openModal(sn);}loadStats();} else toast(d.error,'error'); }



// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  onScopeChange,
  autosaveSet,
  closeImageLightbox,
  closeModal,
  delInstr,
  delSet,
  hideProgress,
  redownloadInstr,
  reimportParts,
  renderGallery,
  startSetCsvImport,
  uploadInstr,
});


/**
 * allSets von aussen setzen.
 *
 * Importierte Bindungen sind in ES-Modulen schreibgeschützt — mit den früheren
 * Globals ging `allSets = […]` aus jeder Datei, jetzt braucht es einen Setter.
 * Bewusst eine Funktion statt eines Zustandsobjekts: Die Aufrufstellen bleiben
 * so an einer Hand abzählbar und der Schreibzugriff ist im Code sichtbar.
 *
 * @param {any[]} v
 */
export function setAllSets(v) { allSets = v; }

/**
 * Setter für _pnlCache — importierte Bindungen sind in ES-Modulen schreibgeschützt.
 * Ersetzt die frühere direkte Zuweisung aus einer anderen Datei, die mit
 * globalen Variablen noch möglich war.
 * @param {any} v
 */
export function set_pnlCache(v) { _pnlCache = v; }

/**
 * Setter für curSet — importierte Bindungen sind in ES-Modulen schreibgeschützt.
 * Ersetzt die frühere direkte Zuweisung aus einer anderen Datei, die mit
 * globalen Variablen noch möglich war.
 * @param {any} v
 */
export function set_curSet(v) { curSet = v; }
