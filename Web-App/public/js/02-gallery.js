// Die Sammlung: Kennzahlen, Galerie (Kacheln und Liste), Set erfassen, Set-
// CSV-Import und Löschen. Neu geladen wird sie auch, wenn ein tieferes Modul
// 'setsGeaendert' oder 'bestandGeaendert' meldet.
import { abonniere } from './00-ereignisse.js';
import { skelettKacheln, listeLadefehler, condBadges, ownerBadges, pnlBadge, schliesseErfassen, teileAufschluesselung } from './01-bausteine.js';
import { echt, registerActions } from './00-registry.js';
import { LANG, locale, t, tRaw} from '../i18n.js';
import { fehlerMeldung, fmtDatum, bildTag, fullUrl, platzhalterInhalt, setnummerFeldGueltig, leerZustand, meldeTreffer, ico, G, TRASH_ICON_SVG, api, escJs, fmtBig, fmtGeld, fmtN, fmtPct, istGeschenk, imgUrl, observeLazyImages, thumbUrl, toast, zuruecksetzenKnopf, betragAusFeld, aktiverReiter, alle } from './01-core.js';
import { gibStart, importZaehler, protokollZeile, csvPollAktiv, addCsvLog, handleSseEvent, hideProgress, setProgBar, showProgress, streamFertig, streamRequest, setzeCsvPollAktiv } from './01-fortschritt.js';
import { addScopeParam, scopeQuery, addLagerParam, lagerModus } from './14-scope.js';
import { loadParts, loadManualParts } from './03-parts.js';
import { loadMinifigs } from './06-minifigs.js';
import { geloeschtMitRueckgaengig } from './20-papierkorb.js';
import { CURRENCY, _lastImportAt, set_lastImportAt, setAllSets, allSets, curSet, _pnlCache, set_pnlCache } from './00-zustand.js';
import { esc } from './00-escapen.js';
import { confirmDelete } from './01-rueckfrage.js';
import { springe } from './00-ziele.js';
import { leereLagerortFeld, selectedOwner, selectedStorage } from './02-konten-orte.js';
/** @typedef {import('./00-zustand.js').Kachel} Kachel */

/**
 * Der Thementon für das Design „Farbfächer“ — auch in der Sammlung: Ohne ihn
 * war das Design dort grau in grau. Ohne Thema-Nummer entscheidet der
 * Themenname, damit ein Thema immer denselben Ton trägt.
 * @param {{ theme_id?: number | null, theme?: string | null }} s
 */
function faecherTon(s) {
  if (typeof s.theme_id === 'number' && Number.isInteger(s.theme_id)) return ` data-faecher="${((s.theme_id % 12) + 12) % 12}"`;
  const name = String(s.theme || '').split(' / ')[0];
  if (!name) return '';
  let h = 0;
  for (const z of name) h = (h * 31 + (z.codePointAt(0) ?? 0)) >>> 0;
  return ` data-faecher="${h % 12}"`;
}

// ── STATS ─────────────────────────────────────────────
export async function loadStats(){
  // Kennzahlen mit demselben Kontofilter wie die Liste: Sonst stand über „nur meine“ weiter die Summe
  // des ganzen Haushalts.
  // Ausführlich: docs/begruendungen/public/js/02-gallery.js.md#d
  const d = await api('GET', `/v1/stats${scopeQuery('gallery')}`);
  if (d.success && d.stats) {
    // Die Kennzahlen stehen in jedem Design als Kacheln über der Sammlung.
    // Stück wie Teile und Figuren daneben; die Zahl der verschiedenen Sets steht darunter.
    const stueck = d.stats.total_quantity || d.stats.total_sets;
    G('bstat-sets').textContent     = fmtBig(stueck);
    const verschieden = G('bstat-sets').parentElement?.querySelector('.bstat-s');
    if (verschieden) verschieden.textContent = stueck !== d.stats.total_sets ? tRaw('gallery.stat.verschieden', { n: d.stats.total_sets }) : '';
    G('bstat-parts').textContent    = fmtBig(d.stats.total_parts    || 0);
    // 0 Teile trotz Sets heisst: Die Teilelisten fehlen noch. Ohne den Satz sähe es nach einem Fehler aus.
    const ohneListen = !d.stats.total_parts && d.stats.total_sets > 0;
    G('bstat-parts-sub').textContent = ohneListen ? tRaw('parts.stat.ohne_listen', { n: d.stats.total_sets })
      : teileAufschluesselung(d.stats.set_parts ?? 0, d.stats.manual_parts ?? 0);
    G('bstat-parts').closest('.bstat')?.classList.toggle('bstat-erklaert', ohneListen);
    G('bstat-minifigs').textContent = fmtBig(d.stats.total_minifigs || 0);
    G('bstat-instr').textContent    = String(d.stats.total_instructions);
  }
}

// ── GALLERY ───────────────────────────────────────────
let curView='grid';

/**
 * Übernimmt das Zustands-Aggregat vom Server: Die eigene Nachrechnung nahm die zuletzt erfasste
 * Position und zeigte bei [U, N] „neu“ statt „gebraucht“.
 * Ausführlich: docs/begruendungen/public/js/02-gallery.js.md#applysetaggregate
 * @param {Partial<Kachel> | null | undefined} agg
 */
export function applySetAggregate(agg){
  if (!agg?.set_number) return;
  const before = allSets;
  setAllSets(allSets.map(s => s.set_number === agg.set_number ? { ...s, ...agg } : s));
  if (allSets !== before) renderGallery();
}
// ── Endlos-Scroll der Galerie ───────────────────────────────────────────────
// Muster wie im Katalog und in der Teileansicht. Filtern und Sortieren liegen
// seit dieser Umstellung auf dem Server: Clientseitig über allSets zu filtern
// verträgt sich nicht mit seitenweisem Laden — ein Filter hätte nur die bereits
// geladene Seite durchsucht.
const GAL_PAGE_SIZE = 60;
let _galGen = 0, _galPage = 1, _galDone = false, _galLoadingMore = false, _galTotal = 0;

/**
 * Aktuelle Filter- und Sortierwerte als Query-Parameter.
 * @param {number} page
 */
function galleryParams(page, pageSize = GAL_PAGE_SIZE){
  const p = new URLSearchParams();
  p.set('page', String(page));
  p.set('page_size', String(pageSize));
  const q = G('gs')?.value?.trim();      if (q)     p.set('search', q);
  const th = G('gtheme')?.value;         if (th)    p.set('theme', th);
  const so = G('gsort')?.value;          if (so)    p.set('sort', so);
  addScopeParam(p, 'gallery');
  addLagerParam(p, 'gallery');
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
    setAllSets(allSets.concat(batch));
    if (allSets.length >= (_galTotal || 0)) _galDone = true;
    appendGallery(batch);
    updateGalleryPrices();
    kickGallerySentinel();     // s. Erklärung dort
  } catch (_) { /* stumm: der Sentinel versucht es beim nächsten Scrollen erneut */ }
  finally { if (gen === _galGen) _galLoadingMore = false; }
}

/**
 * Hängt eine Folgeseite an, ohne die bereits gezeichneten Kacheln neu zu bauen.
 * @param {Kachel[]} batch
 */
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
 * Selbst nachsehen, ob der Sentinel sichtbar ist: IntersectionObserver meldet nur Übergänge, und wird
 * der Inhalt darunter ersetzt, lädt sonst nichts mehr, bis man hoch- und wieder herunterscrollt.
 * Ausführlich: docs/begruendungen/public/js/02-gallery.js.md#kickgallerysentinel
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
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) maybeLoadMoreGallery(); },
      { rootMargin: '600px' }).observe(sent);
  } else {
    window.addEventListener('scroll', () => {
      if (sent.getBoundingClientRect().top < window.innerHeight + 600) maybeLoadMoreGallery();
    }, { passive: true });
  }
}


/**
 * @param {{restore?: boolean}} [opts] restore=true behält die bereits
 *   gescrollte TIEFE und die Scrollposition bei.
 *
 * ── Warum es restore gibt (Marcos Bericht) ─────────────────────
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
  filterZahlZeigen();
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
    gal.innerHTML = skelettKacheln(8, t('gallery.loading'));
  }
  _galGen++; _galPage = 1; _galDone = false; _galLoadingMore = false;
  const gen = _galGen;
  const hatteListe = allSets.length > 0;
  const d=await api('GET', `/v1/sets?${galleryParams(1, holen)}`);
  if (gen !== _galGen) return;
  if (listeLadefehler(gal, d, { erneut: 'loadGallery', behalten: hatteListe })) { if (hatteListe) renderGallery(); return; }
  setAllSets(d.sets||[]);
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
  if (themeEl && !themeEl._bound) { themeEl._bound = true; themeEl.addEventListener('change', () => loadGallery()); }
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
  // Ein Filter ohne Suchtext (Thema, Lagerort) ist auch ein Filter: Sonst stünde
  // „Noch keine Sets“ über einer Sammlung, die nur ausgeblendet ist.
  const gefiltert = !!(q || G('gtheme')?.value || lagerModus('gallery'));
  // Ohne ein einziges Set filtern und sortieren die Felder nichts (N5).
  G('tab-gallery')?.classList.toggle('sammlung-leer', !list.length && !gefiltert);
  if (gefiltert) meldeTreffer(list.length ? tRaw('treffer.sets', { n: _galTotal || list.length })
    : q ? tRaw('common.no_hits', { query: q }) : tRaw('gallery.no_results_filter'));
  if(!list.length){
    c.innerHTML = gefiltert
      ? leerZustand({ ico: 'suche', titel: q ? tRaw('common.no_hits', { query: q }) : tRaw('gallery.no_results_filter'),
                      knopf: zuruecksetzenKnopf('gallery') })
      // Ohne eigenen Knopf: „Set hinzufügen“ steht direkt darüber in der Erfassen-Leiste.
      : leerZustand({ ico: 'set', titel: tRaw('gallery.empty'),
                      text: tRaw(window.matchMedia?.('(max-width: 640px)').matches ? 'gallery.empty_hint_telefon' : 'gallery.empty_hint'),
                      knopf: { text: tRaw('gallery.add.title'), click: 'oeffneErfassen', arg: 'set' } });
    return;
  }
  if(curView==='grid'){
    c.innerHTML=`<div class="sgrid">${list.map(gridCard).join('')}</div>`;
    observeLazyImages(c);
  } else {
    c.innerHTML=`<div class="tw"><table class="dt"><thead><tr><th>${t('col.image_th')}</th><th>${t('col.nr')}</th><th>${t('col.name')}</th><th>${t('detail.year')}</th><th>${t('detail.theme')}</th><th>${t('detail.pieces')}</th><th>${t('detail.minifigs')}</th><th>${t('detail.qty')}</th><th>${t('detail.created')}</th><th>${t('detail.instructions')}</th><th><span class="vh">${t('detail.reimport_parts')}</span></th><th><span class="vh">${t('detail.delete')}</span></th></tr></thead><tbody>${list.map(tableRow).join('')}</tbody></table></div>`;
    observeLazyImages(c);   // fehlte für die Listenansicht komplett
  }
}
/**
 * Preise in die bestehenden Kacheln nachtragen statt die Wand neu zu bauen: Neu gebaute <img>
 * blendeten erneut ein und liessen die Galerie flackern.
 * Ausführlich: docs/begruendungen/public/js/02-gallery.js.md#updategalleryprices
 */
export function updateGalleryPrices(){
  const bySet = new Map(allSets.map(x => [x.set_number, x]));
  alle('[data-price-for]').forEach(el => {
    const s = bySet.get(el.dataset.priceFor ?? '');
    if (!s) return;
    const inhalt = preisZeile(s);
    el.innerHTML = inhalt;
    el.hidden = !inhalt;
  });
}

/**
 * Preis und Prozent der Kachel mit Beschriftung: Ohne sie war nicht zu sehen,
 * ob der Betrag Markt- oder Kaufpreis ist und wogegen das Prozent rechnet.
 * Ohne geladenen Marktpreis steht der mengengewichtete Kaufpreis da.
 * @param {Kachel} s
 */
function preisZeile(s){
  const kauf = s.avg_purchase_price ?? s.max_purchase_price;
  // Der Server sagt, woher kachel_preis stammt: Ohne Marktpreis ist es der Kaufpreis.
  const markt = !!s._price && (s._quelle ? s._quelle === 'markt' : true);
  const betrag = markt ? fmtN(s._price, CURRENCY) : (kauf != null ? fmtGeld(kauf, CURRENCY) : (s._price ? fmtGeld(s._price, CURRENCY) : ''));
  // Ein Geschenk steht als Plakette beim Zustand: Im Preiskasten las es sich als Eigenschaft des Marktpreises.
  const pnl = istGeschenk(kauf) ? '' : pnlBadge(s._pnl_pct, kauf);
  if (!betrag && !pnl) return '';
  const art = betrag ? `<span class="preis-art">${t(markt ? 'gallery.card.market' : 'gallery.card.paid')}</span>` : '';
  const pct = pnl ? `<span title="${esc(tRaw('gallery.card.pnl_hint'))}"><span class="vh">${t('gallery.card.pnl_hint')}: </span>${pnl}</span>` : '';
  return `${art}<span class="preis">${betrag}</span>${pct ? `<span class="preis-pnl">${pct}</span>` : ''}`;
}

/** @param {Kachel} s */
function gridCard(s){
  const src=s.image_local||s.image_url||'';
  // thumbUrl() greift nur bei lokal abgelegten Bildern (_thumb-Variante).
  // Sets ohne lokale Kopie laufen über den Proxy — dort erzeugt imgUrl(…, true)
  // die verkleinerte Fassung, sonst käme die volle Auflösung für eine Kachel.
  const thumb=src?imgUrl(thumbUrl(src)||src, true):null;
  // Ohne Alternativtext: Die Kachel ist ein Knopf, ihr Text nennt das Set schon.
  const img=src?bildTag({ src: thumb||src, alt: '', orig: imgUrl(fullUrl(src)), fade: true, ph: 'set' }):`<span class="bild-ph" aria-hidden="true">${platzhalterInhalt('set')}</span>`;
  // Ohne geladenen Marktpreis der mengengewichtete Kaufpreis. Vorher stand
  // hier max_purchase_price — bei 2x100 und 1x160 zeigte die Kachel 160 statt
  // der tatsächlichen 120.
  const preis = preisZeile(s);
  // Das Datum des letzten Kaufs: Die Aufnahme ins Konto war bei einem Import
  // für alle Sets derselbe Tag und sagte nichts.
  const kaufFmt = s.letzter_kauf ? fmtDatum(s.letzter_kauf) : '';
  // Zustand: Der Server liefert die vorkommenden Zustände als Aggregat —
  // eine Plakette je Zustand, siehe condBadges().
  const condBadge = condBadges(s);
  // Ohne Jahr, Thema und echten Namen kennt der Katalog die Nummer (noch) nicht.
  const unbekannt = !s.year && !s.theme && (!s.name || s.name === 'Set ' + s.set_number);
  // Kein aria-label: Der Name kommt aus dem Inhalt, sonst fehlte dem Vorleser, was sichtbar dasteht.
  return `<div class="sc"${faecherTon(s)} tabindex="0" role="button" aria-keyshortcuts="Delete" data-click="openModal" data-arg="${escJs(s.set_number)}">
    <div class="ca"><span class="delbtn" data-click="delSetStop"${echt()} aria-hidden="true" data-arg="${esc(s.set_number)}" title="${esc(t('detail.delete'))}">${TRASH_ICON_SVG}</span></div>
    <div class="sci">${img}</div>
    <div class="scb">
      <div class="snum">${esc(s.set_number)}</div>
      <div class="sname">${esc(s.name)||t('common.unknown')}</div>
      <div class="smeta">
        <span class="smeta-text"${s.theme ? ` title="${esc(s.theme)}"` : ''}>${s.year||'—'}${s.theme?' · '+esc(s.theme):''}</span>
        <div class="splaketten">
          ${s.instructions?.length?`<span class="ibadge">${ico('liste')}${s.instructions.length}</span>`:''}
          ${s.quantity>1?`<span class="qbadge">×${s.quantity}</span>`:''}
          ${condBadge}
          ${istGeschenk(s.avg_purchase_price ?? s.max_purchase_price) ? `<span class="geschenk-badge">${t('finance.gift')}</span>` : ''}
          ${unbekannt ? `<span class="unbekannt-badge" title="${esc(tRaw('gallery.card.unbekannt_hint'))}">${t('gallery.card.unbekannt')}</span>` : ''}
          ${ownerBadges(s)}
        </div>
      </div>
      <div class="price-badge" data-price-for="${esc(s.set_number)}"${preis ? '' : ' hidden'}>${preis}</div>
      ${kaufFmt ? `<div class="kachel-datum" title="${esc(t('gallery.card.bought'))}">${ico('kalender')} <span>${t('detail.added')}</span> ${kaufFmt}</div>` : '<div class="kachel-datum" aria-hidden="true"></div>'}
    </div>
  </div>`;
}
/** @param {Kachel} s */
function tableRow(s){
  const src=s.image_local||s.image_url||'';
  const addedFmt = s.added_at ? fmtDatum(s.added_at) : '—';
  return `<tr data-stil="cursor:pointer" tabindex="0" data-click="openModal" data-arg="${escJs(s.set_number)}">
    <td>${src?bildTag({ src: imgUrl(thumbUrl(src)||src, true), alt: '', ph: 'set' }):`<span class="bild-ph" aria-hidden="true">${platzhalterInhalt('set')}</span>`}</td>
    <td><span data-stil="font-family:var(--mono);color:var(--b600);font-size:var(--fs-1)">${esc(s.set_number)}</span></td>
    <td>${esc(s.name)||'—'}</td><td>${s.year||'—'}</td><td>${esc(s.theme)||'—'}</td>
    <td>${s.pieces?s.pieces.toLocaleString(locale()):'—'}</td><td>${s.minifigs||'—'}</td>
    <td><span class="qbadge">×${s.quantity}</span></td>
    <td data-stil="font-size:var(--fs-1);color:var(--mut)">${addedFmt}</td>
    <td>${s.instructions?.length?`<span class="ibadge">${ico('liste')}${s.instructions.length}</span>`:'—'}</td>
    <td data-click="stopEvent"><button class="btn bs btn-sm" data-click="reimportParts" data-arg="${escJs(s.set_number)}" title="${esc(t('detail.reimport_parts'))}" aria-label="${esc(t('detail.reimport_parts'))}">${PARTS_ICON_SVG}</button></td>
    <td data-click="stopEvent"><button class="btn bd btn-sm" data-click="delSet"${echt()} data-arg="${escJs(s.set_number)}" title="${esc(t('detail.delete'))}" aria-label="${esc(t('detail.delete'))}">${TRASH_ICON_SVG}</button></td>
  </tr>`;
}

// Add set via SSE stream
G('btn-add').onclick=doAddSet;
G('add-num').addEventListener('input', unbekanntZuruecksetzen);
G('add-num').addEventListener('keydown',e=>e.key==='Enter'&&doAddSet());
/**
 * Eine Nummer, die der Katalog nicht kennt, wird erst nach Rückfrage
 * angelegt: Sonst entsteht aus einem Tippfehler ein Set ohne Namen und Bild.
 * Die Rückfrage steht im Dialog; ein zweiter Klick legt an.
 */
function unbekanntZuruecksetzen() {
  const box = G('add-unbekannt'); if (box) box.hidden = true;
  delete G('add-num').dataset.bestaetigt;
  G('btn-add-text').textContent = tRaw('gallery.add.submit');
}

/**
 * @param {string} num
 */
async function setUnbekannt(num) {
  const nr = /-\d+$/.test(num) ? num : num + '-1';
  if (G('add-num').dataset.bestaetigt === nr) return false;
  const box = G('add-unbekannt');
  // Erst die eigene Sammlung: Ein vorhandenes Set ist nie „unbekannt“, und
  // der Server legt es ohnehin nicht doppelt an, sondern öffnet es.
  const eigen = await api('GET', `/v1/sets/${encodeURIComponent(nr)}`);
  if (eigen?.success && eigen.set) {
    G('add-num').dataset.bestaetigt = nr;
    box.innerHTML = `${esc(tRaw('gallery.add.schon_da', { num: nr, name: eigen.set.name || nr, n: eigen.set.quantity || 1 }))}
      <button type="button" class="btn bs btn-sm" data-click="erfassenZumSet" data-arg="${esc(nr)}">${ico('set')}${esc(tRaw('gallery.add.zum_set'))}</button>`;
    box.hidden = false;
    G('btn-add-text').textContent = tRaw('gallery.add.zum_set');
    return true;
  }
  const d = await api('GET', `/v1/catalog/sets/${encodeURIComponent(nr)}`);
  if (d?.success) return false;
  const ursache = d?.code === 'katalog_nicht_geladen' ? 'gallery.add.katalog_fehlt'
    : d?.code === 'set_nicht_im_katalog' || d?.status === 404 ? 'gallery.add.unbekannt' : null;
  if (!ursache) return false;
  G('add-num').dataset.bestaetigt = nr;
  box.textContent = tRaw(ursache, { num: nr });
  box.hidden = false;
  G('btn-add-text').textContent = tRaw('gallery.add.trotzdem');
  return true;
}
/**
 * Aus dem Erfassen-Dialog direkt zum vorhandenen Set.
 * @param {string} nr
 */
export function erfassenZumSet(nr) {
  G('add-num').value = '';
  unbekanntZuruecksetzen();
  schliesseErfassen();
  springe('setDetail', nr);
}

/** Am Telefon steckt der Filter hinter einem Sinnbild; die Zahl sagt, dass gerade gefiltert wird. */
export function filterZahlZeigen() {
  const zahl = G('gallery-filter-zahl'); if (!zahl) return;
  const n = ['gtheme', 'storage-gallery'].filter(id => /** @type {HTMLInputElement | null} */ (G(id))?.value).length;
  zahl.textContent = n ? String(n) : ''; zahl.hidden = !n;
}


async function doAddSet(){
  const num=G('add-num').value.trim(), qty=parseInt(G('add-qty').value)||1;
  const preis = betragAusFeld('add-price');
  const purchase_price = preis.wert;
  const condition = G('add-condition')?.value || 'N';
  // Zielkonto nur mitschicken, wenn die Auswahl überhaupt sichtbar ist. Ohne
  // Haushalt schickt die Webapp gar nichts, und der Server bleibt beim
  // eigenen Konto — dieselbe Antwort wie vor der Haushaltssicht.
  const owner_user_id = selectedOwner('add-owner');
  if(!setnummerFeldGueltig('add-num', num) || !preis.ok) return;
  if (await setUnbekannt(num)) return;
  unbekanntZuruecksetzen();
  showProgress(t('gallery.adding_set',{num}), false);
  try{
    await streamRequest('/v1/sets/add-stream', {set_number:num,quantity:qty,purchase_price,condition,owner_user_id,storage:selectedStorage('add-storage')}, (ev)=>{
      handleSseEvent(ev, num);
      if(ev.step==='done' && ev.action==='exists'){
        // Set steht schon im Blickfeld — der Server hat NICHTS geschrieben
        // (Marcos Festlegung, src/sets/setAdd.ts). Statt einer Meldung öffnet
        // sich die Detailansicht, genau wie in der App.
        streamFertig();
        hideProgress();
        G('add-num').value='';
        schliesseErfassen();
        springe('setDetail', ev.set_number ?? '');
        return;
      }
      if(ev.step==='done'){
        streamFertig();
        schliesseErfassen();
        setTimeout(()=>{
          hideProgress(); loadGallery(); loadStats();
          G('add-num').value=''; if(G('add-price')) G('add-price').value='';
          leereLagerortFeld('add-storage');
          if (ev.katalog_offen) toast(tRaw('gallery.added_no_catalog', { num: ev.set_number }), 'info');
          else toast(`Set ${esc(ev.set_number)} ${ev.action==='added'?t('common.added'):t('common.updated')}!`,'success');
          // Background jobs still running — refresh all tabs periodically
          set_lastImportAt(Date.now());
          [3000, 8000, 15000, 25000].forEach(delay => setTimeout(()=>{
            loadGallery(); loadStats();
            const activeTab = aktiverReiter();
            if(activeTab==='parts')    { loadParts(); loadManualParts(); }
            if(activeTab==='minifigs') { loadMinifigs(); }
          }, delay));
        },800);
      }
      else if(ev.step==='error'){ streamFertig(); setTimeout(()=>{hideProgress();toast(ev.error,'error');},1500); }
    });
  }catch(e){if(/** @type {Error} */ (e).name!=='AbortError'){hideProgress();toast(fehlerMeldung(e),'error');}}
}

// CSV import via SSE stream — Datei-Auswahl startet den Import direkt (analog Teile-Import)
async function startSetCsvImport(){
  const fi=G('csv-file'); if(!fi.files?.[0]){toast(tRaw('csv.select_file'),'error');return;}
  showProgress(t('csv.import_title'), true);
  const fd=new FormData(); fd.append('file',/** @type {File} */ (fi.files?.[0]));
  try{
    // Start import job (returns immediately)
    const startData = await api('POST', '/v1/sets/import/csv', fd);
    if(!startData.success){ hideProgress(); toast(startData.error||t('settings.error'),'error'); return; }
    const total = startData.total;
    // Übersprungene Zeilen nennen — der Import läuft trotzdem weiter, aber wer
    // 500 Zeilen schickt und 498 importiert bekommt, soll es erfahren.
    if (startData.skipped_hint) toast(startData.skipped_hint, 'info');
    G('prog-footer').textContent=tRaw('csv.items_progress',{done:0,total});

    setzeCsvPollAktiv(true);
    gibStart(); // globalen Balken zeigen (dieses + andere Fenster)
    G('btn-cancel-import').style.display='inline-flex';

    // Fortschritt bevorzugt über SSE; nur bei Ausfall Polling-Fallback.
    const ctx = { total: total ?? 0, prevDone: /** @type {number | null | undefined} */ (-1), prevResultCount:0 };
    // Ohne `?token=` — dieselbe Begründung wie an der Zwillingsstelle in
    // 01-core.js: das Cookie trägt den Kanal, der Token in der Adresse wäre
    // nur der Sitzungstoken im Protokoll.
    const url = `/api/v1/sets/import/csv/stream?sprache=${encodeURIComponent(LANG)}`;

    await /** @type {Promise<void>} */ (new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };

      if (typeof EventSource !== 'undefined') {
        try {
          const es = new EventSource(url, { withCredentials: true });
          es.onmessage = (e) => {
            let s; try { s = JSON.parse(e.data); } catch(_) { return; }
            const finished = csvApplyOverlayStatus(s, ctx, fi);
            if (finished) { es.close(); finish(); }
          };
          es.onerror = () => {
            es.close();
            if (!settled) {
              // SSE weg → auf Polling zurückfallen
              csvPollLoop(ctx, fi).then(finish);
            }
          };
        } catch(_) {
          csvPollLoop(ctx, fi).then(finish);
        }
      } else {
        csvPollLoop(ctx, fi).then(finish);
      }
    }));
  }catch(e){ hideProgress(); toast(fehlerMeldung(e),'error'); }
}

// Verarbeitet ein CSV-Status-Objekt fürs Overlay des startenden Fensters.
// Gibt true zurück, wenn der Import abgeschlossen ist.
/**
 * @param {import('./01-fortschritt.js').ImportStand} s
 * @param {{ total: number, prevDone: number | null | undefined, prevResultCount: number }} ctx
 * @param {HTMLInputElement | null} fi
 */
function csvApplyOverlayStatus(s, ctx, fi){
  if(!s.success) return true;
  const total = ctx.total;
  if(s.done !== ctx.prevDone){
    ctx.prevDone = s.done;
    const done = s.done ?? 0;
    const pct = total>0 ? (done/total)*95 : 0;
    setProgBar(pct);
    G('prog-footer').textContent=`${t('csv.items_progress',{done,total})} (${importZaehler(s)})`;
    if(s.current) G('prog-set-name').textContent=tRaw('csv.verarbeite', { set: s.current, done, total });
    // Update header progress bar directly
    { const _p=total>0?Math.round(done/total*100):0; const _b=G('global-import-bar'); if(_b){_b.style.display='flex';G('gib-fill').style.width=_p+'%';G('gib-text').textContent=done+'/'+total+' ('+fmtPct(_p,{vorzeichen:false,stellen:0})+')';} }
    // Show live results as they come in
    if(s.results && s.results.length > ctx.prevResultCount) {
      const newResults = s.results.slice(ctx.prevResultCount);
      newResults.forEach(r => {
        // Derselbe Bauer wie in 01-fortschritt.js — die Begruendung steht dort.
        const z = protokollZeile(r);
        if (z) addCsvLog(z.text, z.ok);
      });
      ctx.prevResultCount = s.results.length;
    }
  }
  if(s.status==='done'||s.status==='cancelled'||s.status==='error'){
    setzeCsvPollAktiv(false);
    G('btn-cancel-import').style.display='none';
    setProgBar(100);
    if(s.status==='error'){ hideProgress(); toast(s.error||t('csv.import_error'),'error'); }
    else{
      // Add any remaining results not yet shown in live log
      if(s.results) {
        const remaining = s.results.slice(ctx.prevResultCount);
        remaining.forEach(r=>{
          // Derselbe Zeilenbauer wie in 01-fortschritt.js. Ohne esc(), weil addCsvLog textContent setzt; der
          // Hinweis auf Zeitüberschreitung gilt nur hier.
          // Ausführlich: docs/begruendungen/public/js/02-gallery.js.md#z
          const z = protokollZeile(r, t('csv.timeout_retry'));
          if (z) addCsvLog(z.text, z.ok);
        });
        ctx.prevResultCount = s.results.length;
      }
      if((s.err ?? 0)>0){
        const errSets = (s.results||[]).filter(r=>!r.success);
        const errList = errSets.map(r=>r.set_number+': '+(r.error||'?')).join('; ');
        console.warn('[CSV Import] Fehler: '+errList);
      }
      const zaehler = importZaehler(s, 'csv.timeout_warn_n');
      G('prog-footer').textContent=`Import: ${zaehler}`;
      const btnClose = G('btn-close-import');
      if (btnClose) btnClose.style.display = '';
      loadGallery();
      toast(`Import: ${zaehler}`,s.err?'error':s.warn?'info':'success');
      if(fi) fi.value='';
    }
    return true;
  }
  return false;
}

// Polling-Fallback für das startende Fenster (nur wenn SSE nicht verfügbar).
/**
 * @param {{ total: number, prevDone: number | null | undefined, prevResultCount: number }} ctx
 * @param {HTMLInputElement | null} fi
 */
async function csvPollLoop(ctx, fi){
  while(csvPollAktiv()){
    await new Promise(r=>setTimeout(r,1500));
    if(!csvPollAktiv()) break;
    try{
      const s = await api('GET','/v1/sets/import/csv/status');
      if(csvApplyOverlayStatus(/** @type {import('./01-fortschritt.js').ImportStand} */ (s), ctx, fi)) break;
    }catch(e){ console.warn('Poll error:',e); }
  }
}


G('vg').onclick=()=>{ curView='grid'; G('vg').classList.add('active'); G('vl').classList.remove('active'); G('vg').setAttribute('aria-pressed','true'); G('vl').setAttribute('aria-pressed','false'); renderGallery(); };
G('vl').onclick=()=>{ curView='list'; G('vl').classList.add('active'); G('vg').classList.remove('active'); G('vl').setAttribute('aria-pressed','true'); G('vg').setAttribute('aria-pressed','false'); renderGallery(); };
// Suche entprellt: renderGallery baut das komplette Grid per innerHTML neu auf
// (inkl. Lazy-Image-Observer) — bei jedem Tastendruck wäre das bei grossen
// Sammlungen spürbar ruckelig. 250ms Debounce, wie bei der Parts-Suche.
// Suche und Sortierung gehen an den Server, also neu LADEN statt neu zeichnen.
G('gs').addEventListener('input',()=>{ clearTimeout(G('gs')._t); G('gs')._t=setTimeout(loadGallery,250); });
G('gsort').addEventListener('change',() => loadGallery());

/**
 * Ein Set löschen, mit genau EINER Rückfrage hier an der einen Stelle, die löscht: Der Detail-Dialog
 * fragte vorher selbst und dann noch einmal.
 * Ausführlich: docs/begruendungen/public/js/02-gallery.js.md#delset
 * @returns {Promise<boolean>} true, wenn wirklich gelöscht wurde
 * @param {string} sn
 */
export async function delSet(sn){
  const bekannt = (curSet && curSet.set_number === sn ? curSet : null)
    || (allSets || []).find(x => x.set_number === sn);
  const name = bekannt?.name || sn;
  if(!await confirmDelete(tRaw('gallery.delete.title'), t('gallery.delete.name_parts',{name}))) return false;
  const d=await api('DELETE',`/v1/sets/${sn}`);
  if(!d.success){ toast(d.error,'error'); return false; }
  geloeschtMitRueckgaengig(tRaw('users.deleted',{name}), d);
  // Alles nachladen, was mitgelöscht wurde. loadStats() fehlte: Die Kennzahlen
  // im Kopf (Sets, Einheiten, Teile, Minifiguren) blieben nach dem Löschen auf
  // dem alten Stand, obwohl die Teile und Minifiguren des Sets mit weg sind.
  loadGallery(); loadParts(); loadStats();
  return true;
}
/** @param {string} sn */
export async function reimportParts(sn){ toast(tRaw('detail.importing_parts',{sn}),'info'); const d=await api('POST',`/v1/sets/${sn}/parts`); if(d.success){toast(tRaw('detail.parts_imported',{count:d.count}),'success');loadParts();} else toast(d.error,'error'); }

// ── MODAL ─────────────────────────────────────────────
// Gemeinsames "Haufen von Steinen"-Icon für Teile (Nav-Tab, Platzhalter, Überschriften)
export const PARTS_ICON_SVG = '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" data-stil="width:1em;height:1em;vertical-align:middle"><rect x="18" y="62" width="56" height="26" rx="2.5" fill="#0055BF"/><circle cx="28" cy="62" r="5.5" fill="#0055BF"/><circle cx="46" cy="62" r="5.5" fill="#0055BF"/><circle cx="64" cy="62" r="5.5" fill="#0055BF"/><g transform="rotate(-9 66 55)"><rect x="38" y="42" width="52" height="24" rx="2.5" fill="#F2CD37"/><circle cx="49" cy="42" r="5" fill="#F2CD37"/><circle cx="64" cy="42" r="5" fill="#F2CD37"/><circle cx="79" cy="42" r="5" fill="#F2CD37"/></g><g transform="rotate(7 58 80)"><rect x="26" y="76" width="58" height="26" rx="2.5" fill="#E63329"/><circle cx="37" cy="76" r="5.5" fill="#E63329"/><circle cx="55" cy="76" r="5.5" fill="#E63329"/><circle cx="73" cy="76" r="5.5" fill="#E63329"/></g></svg>';
export async function enrichGalleryWithPrices(){
  // Mit Kontofilter — aus demselben Grund wie loadStats(): Diese Funktion
  // steht am Ende von loadGallery(), und loadGallery() laeuft bei jedem
  // Wechsel des Kontofilters. Etwas neu zu laden, das sich dadurch nicht
  // aendern kann, ergibt nur einen Sinn, wenn es sich aendern sollte.
  //
  const pnl = await api('GET',`/v1/finance/pnl${scopeQuery('gallery')}`);
  if(!pnl.success) return;
  set_pnlCache({});
  // Betrag und G&V der Kachel rechnet der Server (kachel_preis,
  // kachel_pnl_pct in /finance/pnl, src/finanzen/setValue.ts kachelWerte); im
  // Haushalt tragen alle Zeilen eines Sets dieselben Werte.
  for(const s of pnl.sets){
    if(!_pnlCache[s.set_number]) _pnlCache[s.set_number] = { price: s.kachel_preis, pnl_pct: s.kachel_pnl_pct, quelle: s.kachel_quelle };
  }
  // Inject price data into cached sets
  setAllSets(allSets.map(s => ({
    ...s,
    _price:   _pnlCache[s.set_number]?.price || 0,
    _quelle:  _pnlCache[s.set_number]?.quelle,
    _pnl_pct: _pnlCache[s.set_number]?.pnl_pct ?? undefined
  })));
  // Nur die Preis-Container nachtragen statt die ganze Galerie neu zu bauen —
  // ein voller renderGallery() erzeugt alle <img> neu und lässt sie erneut
  // einblenden (sichtbares Flackern nach dem Laden).
  updateGalleryPrices();
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

// Andere Module melden, dass sich der Bestand geändert hat; neu geladen wird hier.
abonniere('setsGeaendert', () => { loadGallery(); loadStats(); });
abonniere('bestandGeaendert', () => { loadGallery(); loadStats(); });

// Kein Kommentar zwischen den Namen: test/bundle-smoke.test.js trennt die Schlüssel an Kommas, und ein
// Kommentar wanderte in den ersten Namen.
// Ausführlich: docs/begruendungen/public/js/02-gallery.js.md#registeractions
registerActions({
  loadGallery,
  delSet,
  reimportParts,
  renderGallery,
  startSetCsvImport,
  erfassenZumSet,
});


