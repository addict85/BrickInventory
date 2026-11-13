// Die Sammlung: Kennzahlen, Galerie (Kacheln und Liste), Set erfassen, Set-CSV-Import und Löschen. Neu
// geladen wird sie auch, wenn ein tieferes Modul 'setsGeaendert' oder 'bestandGeaendert' meldet.
import { abonniere } from './ereignisse.js';
import {
  skelettKacheln,
  listeLadefehler,
  condBadges,
  ownerBadges,
  pnlBadge,
  schliesseErfassen,
  teileAufschluesselung,
  geschaetztKauf,
  zeilenKnopf,
} from './bausteine.js';
import { echt, registerActions } from './registry.js';
import { locale, t, tRaw } from '../i18n.js';
import { html, ungeprueft } from './escapen.js';
import { fehlerMeldung, api } from './api.js';
import { bildTag, fullUrl, platzhalterInhalt, imgUrl, observeLazyImages, thumbUrl } from './bilder.js';
import {
  leerZustand,
  meldeTreffer,
  ico,
  G,
  TRASH_ICON_SVG,
  zuruecksetzenKnopf,
  aktiverReiter,
  alle,
  fuegeHtmlEin,
  setzeHtml,
} from './dom.js';
import { fmtDatum, fmtBig, fmtGeld, fmtN, istGeschenk } from './format.js';
import { setnummerFeldGueltig, betragAusFeld, mengeAusFeld, kaufdatumGueltig } from './formular.js';
import { toast } from './meldungen.js';
import { handleSseEvent, hideProgress, showProgress, streamFertig, streamRequest } from './fortschritt.js';
import { addScopeParam, scopeQuery, addLagerParam, lagerModus } from './scope.js';
import { loadParts, loadManualParts } from './parts.js';
import { loadMinifigs } from './minifigs.js';
import { geloeschtMitRueckgaengig } from './papierkorb.js';
import { CURRENCY, set_lastImportAt, setAllSets, allSets, curSet, _pnlCache, set_pnlCache } from './zustand.js';
import { confirmDelete } from './rueckfrage.js';
import { springe } from './ziele.js';
import { leereLagerortFeld, selectedOwner, selectedStorage } from './konten-orte.js';
/** @typedef {import('./zustand.js').Kachel} Kachel */

/**
 * Der Thementon für das Design „Farbfächer“ — auch in der Sammlung: Ohne ihn war das Design dort grau in
 * grau. Ohne Thema-Nummer entscheidet der Themenname, damit ein Thema immer denselben Ton trägt.
 * @param {{ theme_id?: number | null, theme?: string | null }} s
 */
function faecherTon(s) {
  if (typeof s.theme_id === 'number' && Number.isInteger(s.theme_id))
    return html` data-faecher="${((s.theme_id % 12) + 12) % 12}"`;
  const name = String(s.theme || '').split(' / ')[0];
  if (!name) return '';
  let h = 0;
  for (const z of name) h = (h * 31 + (z.codePointAt(0) ?? 0)) >>> 0;
  return html` data-faecher="${h % 12}"`;
}

// ── STATS ─────────────────────────────────────────────
/** Mit „Alle Konten“ im Haushalt zählt die Seite fremde Sets mit; „Meine Sammlung“ stimmte dann nicht. */
function sammlungTitel() {
  const titel = G('gallery-titel'),
    wahl = G('scope-gallery');
  if (!titel) return;
  const schluessel =
    wahl && wahl.style.display !== 'none' && wahl.value === 'all' ? 'gallery.title_haushalt' : 'gallery.title';
  titel.setAttribute('data-i18n', schluessel);
  titel.textContent = tRaw(schluessel);
}

export async function loadStats() {
  sammlungTitel();
  // Kennzahlen mit demselben Kontofilter wie die Liste: Sonst stand über „nur meine“ weiter die Summe des
  // ganzen Haushalts.
  const d = await api('GET', `/v1/stats${scopeQuery('gallery')}`);
  if (d.success && d.stats) {
    // Die Kennzahlen stehen in jedem Design als Kacheln über der Sammlung. Stück wie Teile und Figuren
    // daneben; die Zahl der verschiedenen Sets steht darunter.
    const stueck = d.stats.total_quantity || d.stats.total_sets;
    G('bstat-sets').textContent = fmtBig(stueck);
    const verschieden = G('bstat-sets').parentElement?.querySelector('.bstat-s');
    if (verschieden)
      verschieden.textContent =
        stueck !== d.stats.total_sets ? tRaw('gallery.stat.verschieden', { n: fmtBig(d.stats.total_sets) }) : '';
    G('bstat-parts').textContent = fmtBig(d.stats.total_parts || 0);
    // 0 Teile trotz Sets heisst: Die Teilelisten fehlen noch. Ohne den Satz sähe es nach einem Fehler aus.
    const ohneListen = !d.stats.total_parts && d.stats.total_sets > 0;
    G('bstat-parts-sub').textContent = ohneListen
      ? tRaw('parts.stat.ohne_listen', { n: d.stats.total_sets })
      : teileAufschluesselung(d.stats.set_parts ?? 0, d.stats.manual_parts ?? 0);
    G('bstat-parts').closest('.bstat')?.classList.toggle('bstat-erklaert', ohneListen);
    G('bstat-minifigs').textContent = fmtBig(d.stats.total_minifigs || 0);
    G('bstat-instr').textContent = String(d.stats.total_instructions);
  }
}

// ── GALLERY ───────────────────────────────────────────
let curView = 'grid';

/**
 * Übernimmt das Zustands-Aggregat vom Server: Die eigene Nachrechnung nahm die zuletzt erfasste Position und
 * zeigte bei [U, N] „neu“ statt „gebraucht“.
 * @param {Partial<Kachel> | null | undefined} agg
 */
export function applySetAggregate(agg) {
  if (!agg?.set_number) return;
  const before = allSets;
  setAllSets(allSets.map(s => (s.set_number === agg.set_number ? { ...s, ...agg } : s)));
  if (allSets !== before) renderGallery();
}
// ── Endlos-Scroll der Galerie ───────────────────────────────────────────────
// Wie im Katalog und in der Teileansicht. Filtern und Sortieren macht der Server: Über allSets gefiltert,
// durchsuchte ein Filter beim seitenweisen Laden nur die bereits geladenen Seiten.
const GAL_PAGE_SIZE = 60;
let _galGen = 0,
  _galPage = 1,
  _galDone = false,
  _galLoadingMore = false,
  _galTotal = 0;

/**
 * Aktuelle Filter- und Sortierwerte als Query-Parameter.
 * @param {number} page
 */
function galleryParams(page, pageSize = GAL_PAGE_SIZE) {
  const p = new URLSearchParams();
  p.set('page', String(page));
  p.set('page_size', String(pageSize));
  const q = G('gs')?.value?.trim();
  if (q) p.set('search', q);
  const th = G('gtheme')?.value;
  if (th) p.set('theme', th);
  const so = G('gsort')?.value;
  if (so) p.set('sort', so);
  addScopeParam(p, 'gallery');
  addLagerParam(p, 'gallery');
  return p.toString();
}

async function loadGalleryMore() {
  if (_galLoadingMore || _galDone) return;
  _galLoadingMore = true;
  const gen = _galGen;
  try {
    const d = await api('GET', `/v1/sets?${galleryParams(_galPage + 1)}`);
    if (gen !== _galGen) return; // Filter hat sich zwischenzeitlich geändert
    const batch = d.sets || [];
    if (!batch.length) {
      _galDone = true;
      return;
    }
    _galPage++;
    setAllSets(allSets.concat(batch));
    if (allSets.length >= (_galTotal || 0)) _galDone = true;
    appendGallery(batch);
    updateGalleryPrices();
    kickGallerySentinel(); // s. Erklärung dort
  } catch (_) {
    /* stumm: der Sentinel versucht es beim nächsten Scrollen erneut */
  } finally {
    if (gen === _galGen) _galLoadingMore = false;
  }
}

/**
 * Hängt eine Folgeseite an, ohne die bereits gezeichneten Kacheln neu zu bauen.
 * @param {Kachel[]} batch
 */
function appendGallery(batch) {
  const c = G('gallery');
  const grid = c.querySelector('.sgrid');
  const tbody = c.querySelector('.dt tbody');
  if (curView === 'grid' && grid) {
    fuegeHtmlEin(grid, 'beforeend', batch.map(gridCard));
    observeLazyImages(grid);
  } else if (tbody) {
    fuegeHtmlEin(tbody, 'beforeend', batch.map(tableRow));
  } else {
    renderGallery(); // Struktur fehlt (leerer Zustand)
  }
}

function maybeLoadMoreGallery() {
  if (!G('tab-gallery')?.classList.contains('active')) return;
  loadGalleryMore();
}

/**
 * Selbst nachsehen, ob der Sentinel sichtbar ist: IntersectionObserver meldet nur Übergänge, und wird der
 * Inhalt darunter ersetzt, lädt sonst nichts mehr, bis man hoch- und wieder herunterscrollt.
 */
function kickGallerySentinel() {
  const sent = G('gallery-sentinel');
  if (!sent) return;
  if (sent.getBoundingClientRect().top < window.innerHeight + 600) {
    requestAnimationFrame(maybeLoadMoreGallery);
  }
}

function bindGallerySentinel() {
  const sent = G('gallery-sentinel');
  if (!sent || sent._bound) return;
  sent._bound = true;
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(
      es => {
        if (es.some(e => e.isIntersecting)) maybeLoadMoreGallery();
      },
      { rootMargin: '600px' },
    ).observe(sent);
  } else {
    window.addEventListener(
      'scroll',
      () => {
        if (sent.getBoundingClientRect().top < window.innerHeight + 600) maybeLoadMoreGallery();
      },
      { passive: true },
    );
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
export async function loadGallery(opts = {}) {
  filterZahlZeigen();
  // Tiefe und Position merken, BEVOR irgendetwas zurückgesetzt wird.
  const tiefe = opts.restore ? Math.max(1, _galPage) : 1;
  const scrollY = opts.restore ? window.scrollY : null;
  // Vielfaches von GAL_PAGE_SIZE unter der Serverdeckelung — sonst stimmt die Seitenrechnung für das nächste
  // Nachladen nicht mehr.
  const holen = Math.min(tiefe * GAL_PAGE_SIZE, 480);

  // Spinner NUR beim ersten Laden. Vorher wurde das Grid bei jedem Aufruf sofort geleert — also auch dann,
  // wenn schon gültige Kacheln standen und bloss aufgefrischt wurde. Genau das war die kurz leere Wand beim
  // Neuladen und nach dem Login. Sind bereits Sets da, bleiben sie stehen, bis die neue Antwort da ist; erst
  // dann wird einmal neu gezeichnet.
  const gal = G('gallery');
  if (!allSets.length || !gal.querySelector('.sgrid, .tw, .empty')) {
    setzeHtml(gal, skelettKacheln(8, tRaw('gallery.loading')));
  }
  _galGen++;
  _galPage = 1;
  _galDone = false;
  _galLoadingMore = false;
  const gen = _galGen;
  const hatteListe = allSets.length > 0;
  const d = await api('GET', `/v1/sets?${galleryParams(1, holen)}`);
  if (gen !== _galGen) return;
  if (listeLadefehler(gal, d, { erneut: 'loadGallery', behalten: hatteListe })) {
    if (hatteListe) renderGallery();
    return;
  }
  setAllSets(d.sets || []);
  _galTotal = d.total ?? allSets.length;
  // Seitenzähler an die tatsächlich geholte Menge angleichen, damit die nächste Folgeseite am richtigen
  // Versatz ansetzt.
  _galPage = Math.max(1, Math.ceil(allSets.length / GAL_PAGE_SIZE));
  if (allSets.length >= _galTotal) _galDone = true;
  bindGallerySentinel();
  // Füllt die erste Seite den Bildschirm nicht, gäbe es nie ein Scroll-Ereignis.
  requestAnimationFrame(maybeLoadMoreGallery);

  // Populate theme dropdown Themen kommen vom Server: allSets enthält seit der Paginierung nur noch die erste
  // Seite, das Auswahlfeld wäre sonst unvollständig.
  const themeEl = G('gtheme');
  if (themeEl && Array.isArray(d.themes)) {
    const current = themeEl.value;
    setzeHtml(
      themeEl,
      html`${html`<option value="">${tRaw('gallery.filter.all')}</option>`}${d.themes.map(th => html`<option value="${th}"${th === current ? ' selected' : ''}>${th}</option>`)}`,
    );
    themeEl.value = current;
  }
  if (themeEl && !themeEl._bound) {
    themeEl._bound = true;
    themeEl.addEventListener('change', () => loadGallery());
  }
  renderGallery();
  loadStats();
  // Erst NACH dem Zeichnen zurückspringen — vorher ist das Dokument noch kurz und der Browser würde die
  // Position wieder abschneiden.
  if (scrollY != null) requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
  enrichGalleryWithPrices();
}
export function renderGallery() {
  // Filtern und Sortieren macht der Server (getSets in src/sets/lesen.ts) — hier wird nur noch gezeichnet,
  // was geladen ist. Andernfalls würde ein Filter bloss die aktuell geladene Seite durchsuchen.
  const q = G('gs')?.value?.toLowerCase() || '';
  const list = allSets;
  const c = G('gallery');
  // Ein Filter ohne Suchtext (Thema, Lagerort) ist auch ein Filter: Sonst stünde „Noch keine Sets“ über einer
  // Sammlung, die nur ausgeblendet ist.
  const gefiltert = !!(q || G('gtheme')?.value || lagerModus('gallery'));
  // Ohne ein einziges Set filtern und sortieren die Felder nichts (N5).
  G('tab-gallery')?.classList.toggle('sammlung-leer', !list.length && !gefiltert);
  if (gefiltert)
    meldeTreffer(
      list.length
        ? tRaw('treffer.sets', { n: _galTotal || list.length })
        : q
          ? tRaw('common.no_hits', { query: q })
          : tRaw('gallery.no_results_filter'),
    );
  if (!list.length) {
    setzeHtml(
      c,
      gefiltert
        ? leerZustand({
            ico: 'suche',
            titel: q ? tRaw('common.no_hits', { query: q }) : tRaw('gallery.no_results_filter'),
            knopf: zuruecksetzenKnopf('gallery'),
          })
        : leerZustand({
            ico: 'set',
            titel: tRaw('gallery.empty'),
            text: tRaw(
              window.matchMedia?.('(max-width: 640px)').matches ? 'gallery.empty_hint_telefon' : 'gallery.empty_hint',
            ),
            knopf: { text: tRaw('gallery.add.title'), click: 'oeffneErfassen', arg: 'set' },
          }),
    );
    return;
  }
  if (curView === 'grid') {
    setzeHtml(c, html`<div class="sgrid">${list.map(gridCard)}</div>`);
    observeLazyImages(c);
  } else {
    setzeHtml(
      c,
      html`<div class="tw"><table class="dt" aria-label="${tRaw('nav.collection')}"><thead><tr><th>${tRaw('col.image_th')}</th><th>${tRaw('col.nr')}</th><th>${tRaw('col.name')}</th><th>${tRaw('detail.year')}</th><th>${tRaw('detail.theme')}</th><th>${tRaw('detail.pieces')}</th><th>${tRaw('detail.minifigs')}</th><th>${tRaw('detail.qty')}</th><th>${tRaw('detail.created')}</th><th>${tRaw('detail.instructions')}</th><th><span class="vh">${tRaw('detail.reimport_parts')}</span></th><th><span class="vh">${tRaw('detail.delete')}</span></th></tr></thead><tbody>${list.map(tableRow)}</tbody></table></div>`,
    );
    observeLazyImages(c); // fehlte für die Listenansicht komplett
  }
}
/**
 * Preise in die bestehenden Kacheln nachtragen statt die Wand neu zu bauen: Neu gebaute <img> blendeten
 * erneut ein und liessen die Galerie flackern.
 */
export function updateGalleryPrices() {
  const bySet = new Map(allSets.map(x => [x.set_number, x]));
  alle('[data-price-for]').forEach(el => {
    const s = bySet.get(el.dataset.priceFor ?? '');
    if (!s) return;
    const inhalt = preisZeile(s);
    setzeHtml(el, inhalt);
    el.hidden = !inhalt;
  });
}

/**
 * Preis und Prozent der Kachel mit Beschriftung: Ohne sie war nicht zu sehen, ob der Betrag Markt- oder
 * Kaufpreis ist und wogegen das Prozent rechnet. Ohne geladenen Marktpreis steht der mengengewichtete
 * Kaufpreis da.
 * @param {Kachel} s
 */
function preisZeile(s) {
  const kauf = s.avg_purchase_price ?? s.max_purchase_price;
  // Der Server sagt, woher kachel_preis stammt: Ohne Marktpreis ist es der Kaufpreis.
  const markt = !!s._price && (s._quelle ? s._quelle === 'markt' : true);
  const kaufBetrag = kauf != null ? fmtGeld(kauf, CURRENCY) : s._price ? fmtGeld(s._price, CURRENCY) : '';
  const betrag = markt
    ? fmtN(s._price, CURRENCY)
    : s.kaufpreis_geschaetzt && kaufBetrag
      ? String(geschaetztKauf(kaufBetrag))
      : kaufBetrag;
  // Ein Geschenk steht als Plakette beim Zustand: Im Preiskasten las es sich als Eigenschaft des Marktpreises.
  const pnl = istGeschenk(kauf) ? '' : pnlBadge(s._pnl_pct, kauf);
  if (!betrag && !pnl) return '';
  const art = betrag
    ? html`<span class="preis-art">${tRaw(markt ? 'gallery.card.market' : 'gallery.card.paid')}</span>`
    : '';
  const pct = pnl
    ? html`<span title="${tRaw('gallery.card.pnl_hint')}"><span class="vh">${tRaw('gallery.card.pnl_hint')}: </span>${pnl}</span>`
    : '';
  return html`${art}<span class="preis">${ungeprueft(betrag)}</span>${pct ? html`<span class="preis-pnl">${pct}</span>` : ''}`;
}

/** @param {Kachel} s */
function gridCard(s) {
  const src = s.image_local || s.image_url || '';
  // thumbUrl() greift nur bei lokal abgelegten Bildern (_thumb-Variante). Sets ohne lokale Kopie laufen über
  // den Proxy — dort erzeugt imgUrl(…, true) die verkleinerte Fassung, sonst käme die volle Auflösung für
  // eine Kachel.
  const thumb = src ? imgUrl(thumbUrl(src) || src, true) : null;
  // Ohne Alternativtext: Die Kachel ist ein Knopf, ihr Text nennt das Set schon.
  const img = src
    ? bildTag({ src: thumb || src, alt: '', orig: imgUrl(fullUrl(src)), fade: true, ph: 'set' })
    : html`<span class="bild-ph" aria-hidden="true">${platzhalterInhalt('set')}</span>`;
  // Ohne geladenen Marktpreis der mengengewichtete Kaufpreis. Vorher stand hier max_purchase_price — bei
  // 2x100 und 1x160 zeigte die Kachel 160 statt der tatsächlichen 120.
  const preis = preisZeile(s);
  // Das Datum des letzten Kaufs: Die Aufnahme ins Konto war bei einem Import für alle Sets derselbe Tag und
  // sagte nichts. Bei mehreren Käufen (oft im Haushalt) sagt die Kachel, dass es der letzte ist.
  const kaufFmt = s.letzter_kauf ? fmtDatum(s.letzter_kauf) : '';
  const kaeufe = Number(s.acq_count) || 0;
  const kaufText =
    kaeufe > 1
      ? html`<span>${tRaw('gallery.card.kaeufe', { n: kaeufe })}</span> ${kaufFmt}`
      : html`<span>${tRaw('detail.added')}</span> ${kaufFmt}`;
  // Zustand: Der Server liefert die vorkommenden Zustände als Aggregat — eine Plakette je Zustand, siehe
  // condBadges().
  const condBadge = condBadges(s);
  // Ohne Jahr, Thema und echten Namen kennt der Katalog die Nummer (noch) nicht.
  const unbekannt = !s.year && !s.theme && (!s.name || s.name === 'Set ' + s.set_number);
  // Kein aria-label: Der Name kommt aus dem Inhalt, sonst fehlte dem Vorleser, was sichtbar dasteht.
  return html`<div class="sc"${faecherTon(s)} tabindex="0" role="button" aria-keyshortcuts="Delete" data-click="openModal" data-arg="${s.set_number}">
    <div class="ca"><span class="delbtn" data-click="delSetStop"${echt()} aria-hidden="true" data-arg="${s.set_number}" title="${t('detail.delete')}">${TRASH_ICON_SVG}</span></div>
    <div class="sci">${img}</div>
    <div class="scb">
      <div class="snum">${s.set_number}</div>
      <div class="sname">${s.name || tRaw('common.unknown')}</div>
      <div class="smeta">
        <span class="smeta-text"${s.theme ? html` title="${s.theme}"` : ''}>${s.year || '—'}${s.theme ? html`${' · '}${s.theme}` : ''}</span>
        <div class="splaketten">
          ${s.instructions?.length ? html`<span class="ibadge">${ico('liste')}${s.instructions.length}</span>` : ''}
          ${s.quantity > 1 ? html`<span class="qbadge">×${s.quantity}</span>` : ''}
          ${condBadge}
          ${istGeschenk(s.avg_purchase_price ?? s.max_purchase_price) ? html`<span class="geschenk-badge">${tRaw('finance.gift')}</span>` : ''}
          ${unbekannt ? html`<span class="unbekannt-badge" title="${tRaw('gallery.card.unbekannt_hint')}">${tRaw('gallery.card.unbekannt')}</span>` : ''}
          ${ownerBadges(s)}
        </div>
      </div>
      <div class="price-badge" data-price-for="${s.set_number}"${preis ? '' : ' hidden'}>${preis}</div>
      ${kaufFmt ? html`<div class="kachel-datum" title="${t('gallery.card.bought')}">${ico('kalender')} ${kaufText}</div>` : html`<div class="kachel-datum" aria-hidden="true"></div>`}
    </div>
  </div>`;
}
/** @param {Kachel} s */
function tableRow(s) {
  const src = s.image_local || s.image_url || '';
  const addedFmt = s.added_at ? fmtDatum(s.added_at) : '—';
  return html`<tr data-stil="cursor:pointer" data-click="openModal" data-arg="${s.set_number}">
    <td>${src ? bildTag({ src: imgUrl(thumbUrl(src) || src, true), alt: '', ph: 'set' }) : html`<span class="bild-ph" aria-hidden="true">${platzhalterInhalt('set')}</span>`}</td>
    <td>${zeilenKnopf({ click: 'openModal', arg: s.set_number }, html`<span data-stil="font-family:var(--mono);color:var(--b600);font-size:var(--fs-1);white-space:nowrap">${s.set_number}</span>`, tRaw('zeile.oeffnen', { name: s.name || s.set_number, nr: s.set_number }))}</td>
    <td>${s.name || '—'}</td><td>${s.year || '—'}</td><td>${s.theme || '—'}</td>
    <td>${s.pieces ? s.pieces.toLocaleString(locale()) : '—'}</td><td>${s.minifigs || '—'}</td>
    <td><span class="qbadge">×${s.quantity}</span></td>
    <td data-stil="font-size:var(--fs-1);color:var(--mut)">${ungeprueft(addedFmt)}</td>
    <td>${s.instructions?.length ? html`<span class="ibadge">${ico('liste')}${s.instructions.length}</span>` : '—'}</td>
    <td data-click="stopEvent"><button class="btn bs btn-sm" data-click="reimportParts" data-arg="${s.set_number}" title="${t('detail.reimport_parts')}" aria-label="${t('detail.reimport_parts')}">${ungeprueft(PARTS_ICON_SVG)}</button></td>
    <td data-click="stopEvent"><button class="btn bd btn-sm" data-click="delSet"${echt()} data-arg="${s.set_number}" title="${t('detail.delete')}" aria-label="${t('detail.delete')}">${TRASH_ICON_SVG}</button></td>
  </tr>`;
}

// Add set via SSE stream
G('btn-add').onclick = doAddSet;
G('add-num').addEventListener('input', unbekanntZuruecksetzen);
G('add-num').addEventListener('keydown', e => e.key === 'Enter' && doAddSet());
/**
 * Eine Nummer, die der Katalog nicht kennt, wird erst nach Rückfrage angelegt: Sonst entsteht aus einem
 * Tippfehler ein Set ohne Namen und Bild. Die Rückfrage steht im Dialog; ein zweiter Klick legt an.
 */
function unbekanntZuruecksetzen() {
  const box = G('add-unbekannt');
  if (box) box.hidden = true;
  delete G('add-num').dataset.bestaetigt;
  delete G('add-num').dataset.vorhanden;
  G('btn-add-text').textContent = tRaw('gallery.add.submit');
}

/**
 * @param {string} num
 */
async function setUnbekannt(num) {
  const nr = /-\d+$/.test(num) ? num : num + '-1';
  if (G('add-num').dataset.bestaetigt === nr) return false;
  const box = G('add-unbekannt');
  // Erst die eigene Sammlung: Ein vorhandenes Set ist nie „unbekannt“, und der Server legt es ohnehin nicht
  // doppelt an, sondern öffnet es.
  const eigen = await api('GET', `/v1/sets/${encodeURIComponent(nr)}`);
  if (eigen?.success && eigen.set) {
    G('add-num').dataset.bestaetigt = nr;
    G('add-num').dataset.vorhanden = nr;
    // Der Hauptknopf heisst jetzt „Set öffnen“; ein zweiter gleichen Namens im Hinweis war einer zu viel.
    box.textContent = tRaw('gallery.add.schon_da', { num: nr, name: eigen.set.name || nr, n: eigen.set.quantity || 1 });
    box.hidden = false;
    G('btn-add-text').textContent = tRaw('gallery.add.zum_set');
    return true;
  }
  const d = await api('GET', `/v1/catalog/sets/${encodeURIComponent(nr)}`);
  if (d?.success) return false;
  const ursache =
    d?.code === 'katalog_nicht_geladen'
      ? 'gallery.add.katalog_fehlt'
      : d?.code === 'set_nicht_im_katalog' || d?.status === 404
        ? 'gallery.add.unbekannt'
        : null;
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
  const zahl = G('gallery-filter-zahl');
  if (!zahl) return;
  const n = ['gtheme', 'storage-gallery'].filter(id => /** @type {HTMLInputElement | null} */ (G(id))?.value).length;
  zahl.textContent = n ? String(n) : '';
  zahl.hidden = !n;
}

async function doAddSet() {
  const num = G('add-num').value.trim();
  const preis = betragAusFeld('add-price');
  const purchase_price = preis.wert;
  const condition = G('add-condition')?.value || 'N';
  const currency = preis.wert != null ? G('add-currency')?.value || null : null;
  const date = G('add-date')?.value || null;
  // Zielkonto nur mitschicken, wenn die Auswahl überhaupt sichtbar ist. Ohne Haushalt schickt die Webapp gar
  // nichts, und der Server bleibt beim eigenen Konto — dieselbe Antwort wie vor der Haushaltssicht.
  const owner_user_id = selectedOwner('add-owner');
  // Alle Felder prüfen, nicht beim ersten Fehler aufhören: Jedes zeigt seine Meldung, der Fokus bleibt am ersten (Set-Nummer).
  const datumOk = kaufdatumGueltig('add-date');
  const menge = mengeAusFeld('add-qty');
  const nummerOk = setnummerFeldGueltig('add-num', num);
  if (!nummerOk || !menge.ok || !preis.ok || !datumOk) return;
  const qty = menge.wert;
  // Steht das Set schon da, heisst der Hauptknopf „Set öffnen“ und tut genau das, ohne Schreibversuch.
  const vorhanden = G('add-num').dataset.vorhanden;
  if (vorhanden && vorhanden === (/-\d+$/.test(num) ? num : num + '-1')) {
    erfassenZumSet(vorhanden);
    return;
  }
  if (await setUnbekannt(num)) return;
  unbekanntZuruecksetzen();
  showProgress(tRaw('gallery.adding_set', { num }), false);
  try {
    await streamRequest(
      '/v1/sets/add-stream',
      {
        set_number: num,
        quantity: qty,
        purchase_price,
        condition,
        owner_user_id,
        storage: selectedStorage('add-storage'),
        currency,
        date,
      },
      ev => {
        handleSseEvent(ev, num);
        if (ev.step === 'done' && ev.action === 'exists') {
          // Set steht schon im Blickfeld — der Server hat NICHTS geschrieben (Marcos Festlegung,
          // src/sets/erfassen.ts). Statt einer Meldung öffnet sich die Detailansicht, genau wie in der App.
          streamFertig();
          hideProgress();
          G('add-num').value = '';
          schliesseErfassen();
          springe('setDetail', ev.set_number ?? '');
          return;
        }
        if (ev.step === 'done') {
          streamFertig();
          schliesseErfassen();
          setTimeout(() => {
            hideProgress();
            loadGallery();
            loadStats();
            G('add-num').value = '';
            if (G('add-price')) G('add-price').value = '';
            if (G('add-date')) G('add-date').value = '';
            leereLagerortFeld('add-storage');
            if (ev.katalog_offen) toast(tRaw('gallery.added_no_catalog', { num: ev.set_number }), 'info');
            else
              toast(
                tRaw(ev.action === 'added' ? 'gallery.set_hinzugefuegt' : 'gallery.set_aktualisiert', {
                  num: ev.set_number,
                }),
                'success',
              );
            // Hintergrundaufträge laufen noch: alle Reiter regelmässig auffrischen
            set_lastImportAt(Date.now());
            // Konnte der Strom nicht ergänzen, holt ein Auftrag Name und Bild nach einer Minute.
            for (const delay of [3000, 8000, 15000, 25000, ...(ev.ergaenzung === 'ausstehend' ? [70000, 120000] : [])])
              setTimeout(() => {
                loadGallery();
                loadStats();
                const activeTab = aktiverReiter();
                if (activeTab === 'parts') {
                  loadParts();
                  loadManualParts();
                }
                if (activeTab === 'minifigs') {
                  loadMinifigs();
                }
              }, delay);
          }, 800);
        } else if (ev.step === 'error') {
          streamFertig();
          setTimeout(() => {
            hideProgress();
            toast(ev.error, 'error');
          }, 1500);
        }
      },
    );
  } catch (e) {
    if (/** @type {Error} */ (e).name !== 'AbortError') {
      hideProgress();
      toast(fehlerMeldung(e), 'error');
    }
  }
}

G('vg').onclick = () => {
  curView = 'grid';
  G('vg').classList.add('active');
  G('vl').classList.remove('active');
  G('vg').setAttribute('aria-pressed', 'true');
  G('vl').setAttribute('aria-pressed', 'false');
  renderGallery();
};
G('vl').onclick = () => {
  curView = 'list';
  G('vl').classList.add('active');
  G('vg').classList.remove('active');
  G('vl').setAttribute('aria-pressed', 'true');
  G('vg').setAttribute('aria-pressed', 'false');
  renderGallery();
};
// Suche um 250 ms entprellt: Jeder Tastendruck lädt neu (Suche und Sortierung rechnet der Server) und baut
// das ganze Grid samt Lazy-Image-Observer neu auf — bei grossen Sammlungen spürbar ruckelig.
G('gs').addEventListener('input', () => {
  clearTimeout(G('gs')._t);
  G('gs')._t = setTimeout(loadGallery, 250);
});
G('gsort').addEventListener('change', () => loadGallery());

/**
 * Ein Set löschen, mit genau EINER Rückfrage hier an der einen Stelle, die löscht: Der Detail-Dialog fragte
 * vorher selbst und dann noch einmal.
 * @returns {Promise<boolean>} true, wenn wirklich gelöscht wurde
 * @param {string} sn
 */
export async function delSet(sn) {
  const bekannt =
    (curSet && curSet.set_number === sn ? curSet : null) || (allSets || []).find(x => x.set_number === sn);
  const name = bekannt?.name || sn;
  if (!(await confirmDelete(tRaw('gallery.delete.title'), tRaw('gallery.delete.name_parts', { name })))) return false;
  const d = await api('DELETE', `/v1/sets/${sn}`);
  if (!d.success) {
    toast(d.error, 'error');
    return false;
  }
  geloeschtMitRueckgaengig(tRaw('users.deleted', { name }), d);
  // Alles nachladen, was mitgelöscht wurde. loadStats() fehlte: Die Kennzahlen im Kopf (Sets, Einheiten,
  // Teile, Minifiguren) blieben nach dem Löschen auf dem alten Stand, obwohl die Teile und Minifiguren des
  // Sets mit weg sind.
  loadGallery();
  loadParts();
  loadStats();
  return true;
}
/** @param {string} sn */
export async function reimportParts(sn) {
  toast(tRaw('detail.importing_parts', { sn }), 'info');
  const d = await api('POST', `/v1/sets/${sn}/parts`);
  if (d.success) {
    toast(tRaw('detail.parts_imported', { count: d.count }), 'success');
    loadParts();
  } else toast(d.error, 'error');
}

// ── MODAL ─────────────────────────────────────────────
// Gemeinsames "Haufen von Steinen"-Icon für Teile (Nav-Tab, Platzhalter, Überschriften)
export const PARTS_ICON_SVG =
  '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" data-stil="width:1em;height:1em;vertical-align:middle"><rect x="18" y="62" width="56" height="26" rx="2.5" fill="#0055BF"/><circle cx="28" cy="62" r="5.5" fill="#0055BF"/><circle cx="46" cy="62" r="5.5" fill="#0055BF"/><circle cx="64" cy="62" r="5.5" fill="#0055BF"/><g transform="rotate(-9 66 55)"><rect x="38" y="42" width="52" height="24" rx="2.5" fill="#F2CD37"/><circle cx="49" cy="42" r="5" fill="#F2CD37"/><circle cx="64" cy="42" r="5" fill="#F2CD37"/><circle cx="79" cy="42" r="5" fill="#F2CD37"/></g><g transform="rotate(7 58 80)"><rect x="26" y="76" width="58" height="26" rx="2.5" fill="#E63329"/><circle cx="37" cy="76" r="5.5" fill="#E63329"/><circle cx="55" cy="76" r="5.5" fill="#E63329"/><circle cx="73" cy="76" r="5.5" fill="#E63329"/></g></svg>';
export async function enrichGalleryWithPrices() {
  // Mit Kontofilter — aus demselben Grund wie loadStats(): Diese Funktion steht am Ende von loadGallery(),
  // und loadGallery() laeuft bei jedem Wechsel des Kontofilters. Etwas neu zu laden, das sich dadurch nicht
  // aendern kann, ergibt nur einen Sinn, wenn es sich aendern sollte.
  //
  const pnl = await api('GET', `/v1/finance/pnl${scopeQuery('gallery')}`);
  if (!pnl.success) return;
  set_pnlCache({});
  // Betrag und G&V der Kachel rechnet der Server (kachel_preis, kachel_pnl_pct in /finance/pnl,
  // src/finanzen/setValue.ts kachelWerte); im Haushalt tragen alle Zeilen eines Sets dieselben Werte.
  for (const s of pnl.sets) {
    if (!_pnlCache[s.set_number])
      _pnlCache[s.set_number] = { price: s.kachel_preis, pnl_pct: s.kachel_pnl_pct, quelle: s.kachel_quelle };
  }
  // Inject price data into cached sets
  setAllSets(
    allSets.map(s => ({
      ...s,
      _price: _pnlCache[s.set_number]?.price || 0,
      _quelle: _pnlCache[s.set_number]?.quelle,
      _pnl_pct: _pnlCache[s.set_number]?.pnl_pct ?? undefined,
    })),
  );
  // Nur die Preis-Container nachtragen statt die ganze Galerie neu zu bauen — ein voller renderGallery()
  // erzeugt alle <img> neu und lässt sie erneut einblenden (sichtbares Flackern nach dem Laden).
  updateGalleryPrices();
}

// CSV template download
G('btn-set-csv-template').onclick = e => {
  e.preventDefault();
  const csv =
    'set_number,quantity,purchase_price,condition,acquired_at\n60098-1,1,49.99,N,2024-01-15\n75192-1,2,,U,\n10497-1,1,,,\n';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'sets-template.csv';
  a.click();
};

// Andere Module melden, dass sich der Bestand geändert hat; neu geladen wird hier.
abonniere('setsGeaendert', () => {
  loadGallery();
  loadStats();
});
abonniere('bestandGeaendert', () => {
  loadGallery();
  loadStats();
});

// Kein Kommentar zwischen den Namen: test/bundle-smoke.test.js trennt die Schlüssel an Kommas, und ein
// Kommentar wanderte in den ersten Namen.
registerActions({
  loadGallery,
  delSet,
  reimportParts,
  renderGallery,
  erfassenZumSet,
});
