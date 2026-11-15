// Die Sammlung: Kennzahlen, Galerie (Kacheln und Liste), Set-CSV-Import und Löschen. Neu
// geladen wird sie auch, wenn ein tieferes Modul 'setsGeaendert' oder 'bestandGeaendert' meldet.
import { abonniere, melde } from './ereignisse.js';
import {
  skelettKacheln,
  listeLadefehler,
  condBadges,
  ownerBadges,
  pnlBadge,
  geschaetztKauf,
  kachelName,
  kontoAnzeige,
} from './bausteine.js';
import { echt, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { html, ungeprueft } from './escapen.js';
import { api } from './api.js';
import { generationen } from './lader.js';
import { bildTag, fullUrl, platzhalterInhalt, imgUrl, observeLazyImages, thumbUrl } from './bilder.js';
import {
  leerZustand,
  meldeTreffer,
  ico,
  G,
  TRASH_ICON_SVG,
  zuruecksetzenKnopf,
  alle,
  fuegeHtmlEin,
  setzeHtml,
  telefonBreite,
  beiTelefonWechsel,
} from './dom.js';
import { fmtDatum, fmtGeld, fmtN, istGeschenk } from './format.js';
import { toast } from './meldungen.js';
import { addScopeParam, scopeQuery, addLagerParam, lagerModus } from './kontofilter.js';
import { geloeschtMitRueckgaengig } from './papierkorb.js';
import {
  kontoWaehrung,
  angemeldetesKonto,
  setzeGalerieSets,
  galerieSets,
  offenesSet,
  guvJeSet,
  setzeGuvJeSet,
} from './zustand.js';
import { confirmDelete, loeschenMitWahl } from './rueckfrage.js';
import { SPALTEN_SORT, setsTabelle, tableRow, wertZelle } from './sets-tabelle.js';
import { loadStats } from './kennzahlen.js';
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

// ── GALLERY ───────────────────────────────────────────
let curView = 'grid';
const alsKarten = () => curView === 'grid' || telefonBreite();

/**
 * Übernimmt das Zustands-Aggregat vom Server: Die eigene Nachrechnung nahm die zuletzt erfasste Position und
 * zeigte bei [U, N] „neu“ statt „gebraucht“.
 * @param {Partial<Kachel> | null | undefined} agg
 */
export function applySetAggregate(agg) {
  if (!agg?.set_number) return;
  const before = galerieSets;
  setzeGalerieSets(galerieSets.map(s => (s.set_number === agg.set_number ? { ...s, ...agg } : s)));
  if (galerieSets !== before) renderGallery();
}
// ── Endlos-Scroll der Galerie ───────────────────────────────────────────────
// Filtern und Sortieren macht der Server: Über galerieSets durchsuchte ein Filter nur die geladenen Seiten.
const GAL_PAGE_SIZE = 60;
const galerieLaden = generationen();
let _galPage = 1,
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
  const gen = galerieLaden.jetzt();
  try {
    const d = await galerieLaden.aktuell(api('GET', `/v1/sets?${galleryParams(_galPage + 1)}`));
    if (d === undefined) return;
    const batch = d.sets || [];
    if (!batch.length) {
      _galDone = true;
      return;
    }
    _galPage++;
    setzeGalerieSets(galerieSets.concat(batch));
    if (galerieSets.length >= (_galTotal || 0)) _galDone = true;
    appendGallery(batch);
    updateGalleryPrices();
    kickGallerySentinel(); // s. Erklärung dort
  } catch (_) {
    /* stumm: der Sentinel versucht es beim nächsten Scrollen erneut */
  } finally {
    if (galerieLaden.gilt(gen)) _galLoadingMore = false;
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
  if (alsKarten() && grid) {
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

  // Platzhalter nur ohne Kacheln: Stehende bleiben bis zur Antwort, sonst blitzte eine leere Wand auf.
  const gal = G('gallery');
  if (!galerieSets.length || !gal.querySelector('.sgrid, .tw, .empty')) {
    setzeHtml(gal, skelettKacheln(8, tRaw('gallery.loading')));
  }
  galerieLaden.neu();
  _galPage = 1;
  // Bis die erste Seite da ist, lädt der Sentinel nichts nach: Er fragte sonst Seite 2 einer alten Liste ab.
  _galDone = true;
  _galLoadingMore = false;
  const hatteListe = galerieSets.length > 0;
  const d = await galerieLaden.aktuell(api('GET', `/v1/sets?${galleryParams(1, holen)}`));
  if (d === undefined) return;
  if (listeLadefehler(gal, d, { erneut: 'loadGallery', behalten: hatteListe })) {
    if (hatteListe) renderGallery();
    return;
  }
  setzeGalerieSets(d.sets || []);
  _galTotal = d.total ?? galerieSets.length;
  // Seitenzähler an die tatsächlich geholte Menge angleichen, damit die nächste Folgeseite am richtigen
  // Versatz ansetzt.
  _galPage = Math.max(1, Math.ceil(galerieSets.length / GAL_PAGE_SIZE));
  _galDone = galerieSets.length >= _galTotal;
  bindGallerySentinel();
  // Füllt die erste Seite den Bildschirm nicht, gäbe es nie ein Scroll-Ereignis.
  requestAnimationFrame(maybeLoadMoreGallery);

  // Die Themen nennt der Server: galerieSets hält nur die geladenen Seiten.
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
  // Filtern und Sortieren macht der Server (setsLesen in src/sets/lesen.ts) — hier wird nur noch gezeichnet,
  // was geladen ist. Andernfalls würde ein Filter bloss die aktuell geladene Seite durchsuchen.
  const q = G('gs')?.value?.toLowerCase() || '';
  const list = galerieSets;
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
            text: tRaw(telefonBreite() ? 'gallery.empty_hint_telefon' : 'gallery.empty_hint'),
            knopf: { text: tRaw('gallery.add.title'), click: 'oeffneErfassen', arg: 'set' },
          }),
    );
    return;
  }
  if (alsKarten()) {
    setzeHtml(c, html`<div class="sgrid">${list.map(gridCard)}</div>`);
    observeLazyImages(c);
  } else {
    setzeHtml(c, setsTabelle(list));
    observeLazyImages(c); // fehlte für die Listenansicht komplett
  }
}
/**
 * Preise in die bestehenden Kacheln nachtragen statt die Wand neu zu bauen: Neu gebaute <img> blendeten
 * erneut ein und liessen die Galerie flackern.
 */
export function updateGalleryPrices() {
  const bySet = new Map(galerieSets.map(x => [x.set_number, x]));
  alle('[data-price-for]').forEach(el => {
    const s = bySet.get(el.dataset.priceFor ?? '');
    if (!s) return;
    const inhalt = preisZeile(s);
    setzeHtml(el, inhalt);
    el.hidden = !inhalt;
  });
  alle('[data-tabwert-for]').forEach(el => {
    const s = bySet.get(el.dataset.tabwertFor ?? '');
    if (s) setzeHtml(el, wertZelle(s));
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
  const kaufBetrag = kauf != null ? fmtGeld(kauf, kontoWaehrung) : s._price ? fmtGeld(s._price, kontoWaehrung) : '';
  const betrag = markt
    ? fmtN(s._price, kontoWaehrung)
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
  // Ohne geladenen Marktpreis der mengengewichtete Kaufpreis, nicht der höchste.
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
  const k = kachelName(3);
  return html`<div class="sc"${faecherTon(s)} tabindex="0" role="button"${k.attr} aria-keyshortcuts="Delete" data-click="openModal" data-arg="${s.set_number}">
    <div class="ca"><span class="delbtn" data-click="delSetStop"${echt()} aria-hidden="true" data-arg="${s.set_number}" data-taste="${tRaw('kachel.entf')}" title="${t('detail.delete')}">${TRASH_ICON_SVG}</span></div>
    <div class="sci">${img}</div>
    <div class="scb">
      <div class="snum">${s.set_number}</div>
      <div class="sname">${s.name || tRaw('common.unknown')}</div>
      <div class="smeta"${k.teil(0)}>
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
      <div class="price-badge"${k.teil(1)} data-price-for="${s.set_number}"${preis ? '' : ' hidden'}>${preis}</div>
      ${kaufFmt ? html`<div class="kachel-datum"${k.teil(2)} title="${t('gallery.card.bought')}">${ico('kalender')} ${kaufText}</div>` : html`<div class="kachel-datum" ${k.teil(2)}></div>`}
    </div>
  </div>`;
}
/** @param {string} feld */
async function setsSortieren(feld) {
  const wahl = G('gsort');
  const [erst, dann] = SPALTEN_SORT[feld];
  wahl.value = wahl.value === erst ? dann : erst;
  await loadGallery();
  /** @type {HTMLElement | null} */ (
    document.querySelector(`#gallery [data-click="setsSortieren"][data-arg="${feld}"]`)
  )?.focus();
}

// Add set via SSE stream
/** Am Telefon steckt der Filter hinter einem Sinnbild; die Zahl sagt, dass gerade gefiltert wird. */
export function filterZahlZeigen() {
  const zahl = G('gallery-filter-zahl');
  if (!zahl) return;
  const n = ['gtheme', 'storage-gallery'].filter(id => /** @type {HTMLInputElement | null} */ (G(id))?.value).length;
  zahl.textContent = n ? String(n) : '';
  zahl.hidden = !n;
}

beiTelefonWechsel(() => {
  if (G('gallery')?.querySelector('.sgrid, .tw, .empty.leer:not(.fehler-zustand)')) renderGallery();
});
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
 * Die eine Rückfrage vor dem Löschen. Gehört das Set mehreren Konten, nennt sie Konten und Stückzahlen und lässt
 * wählen: Gelöscht wurde sonst still auch das Exemplar des anderen Kontos.
 * @param {string} sn @param {string} name @param {Kachel | null | undefined} set
 * @returns {Promise<string | null>} '' für alle Konten, eine Kontonummer, oder null bei Abbruch
 */
async function loeschWahl(sn, name, set) {
  const titel = tRaw('gallery.delete.title');
  const fremd = (set?.owners || []).some(o => o.id !== angemeldetesKonto?.id);
  if (!fremd) return (await confirmDelete(titel, tRaw('gallery.delete.name_parts', { name }))) ? '' : null;
  const ad = await api('GET', `/v1/sets/${encodeURIComponent(sn)}/acquisitions`);
  const konten = (set?.owners || []).map(o => ({
    ...o,
    n: (ad?.acquisitions || [])
      .filter(a => (a.owner_user_id ?? angemeldetesKonto?.id) === o.id)
      .reduce((s, a) => s + (a.quantity || 0), 0),
  }));
  const liste = konten.map(k => `${kontoAnzeige(k)} ×${k.n}`).join(', ');
  const gesamt = konten.reduce((s, k) => s + k.n, 0);
  return loeschenMitWahl(titel, tRaw('gallery.delete.konten', { name, konten: liste }), [
    { wert: '', text: tRaw('gallery.delete.alle', { n: gesamt }) },
    ...konten.map(k => ({ wert: String(k.id), text: tRaw('gallery.delete.nur', { konto: kontoAnzeige(k), n: k.n }) })),
  ]);
}

/**
 * Ein Set löschen, mit genau EINER Rückfrage hier an der einen Stelle, die löscht.
 * @returns {Promise<boolean>} true, wenn wirklich gelöscht wurde
 * @param {string} sn
 */
export async function delSet(sn) {
  const bekannt =
    (offenesSet && offenesSet.set_number === sn ? offenesSet : null) ||
    (galerieSets || []).find(x => x.set_number === sn);
  const name = bekannt?.name || sn;
  const konto = await loeschWahl(sn, name, bekannt);
  if (konto === null) return false;
  const d = await api('DELETE', `/v1/sets/${sn}${konto ? `?accounts=${konto}` : ''}`);
  if (!d.success) {
    toast(d.error, 'error');
    return false;
  }
  const wem = (bekannt?.owners || []).find(o => String(o.id) === konto);
  const nr = CSS.escape(sn);
  geloeschtMitRueckgaengig(
    `${tRaw('users.deleted', { name })}${wem ? ` · ${kontoAnzeige(wem)}` : ''}`,
    d,
    undefined,
    `.sc[data-arg="${nr}"], tr[data-arg="${nr}"] .zeile-oeffnen`,
  );
  loadGallery();
  melde('teileLaden');
  return true;
}
/** @param {string} sn */
export async function reimportParts(sn) {
  toast(tRaw('detail.importing_parts', { sn }), 'info');
  const d = await api('POST', `/v1/sets/${sn}/parts`);
  if (d.success) {
    toast(tRaw('detail.parts_imported', { count: d.count }), 'success');
    melde('teileLaden');
  } else toast(d.error, 'error');
}

export async function enrichGalleryWithPrices() {
  // Mit Kontofilter wie loadStats(): loadGallery() ruft dies bei jedem Wechsel des Filters.
  const pnl = await api('GET', `/v1/finance/pnl${scopeQuery('gallery')}`);
  if (!pnl.success) return;
  setzeGuvJeSet({});
  // Betrag und G&V der Kachel rechnet der Server (kachel_preis, kachel_pnl_pct in /finance/pnl,
  // src/finanzen/setValue.ts kachelWerte); im Haushalt tragen alle Zeilen eines Sets dieselben Werte.
  for (const s of pnl.sets) {
    if (!guvJeSet[s.set_number])
      guvJeSet[s.set_number] = { price: s.kachel_preis, pnl_pct: s.kachel_pnl_pct, quelle: s.kachel_quelle };
  }
  // Inject price data into cached sets
  setzeGalerieSets(
    galerieSets.map(s => ({
      ...s,
      _price: guvJeSet[s.set_number]?.price || 0,
      _quelle: guvJeSet[s.set_number]?.quelle,
      _pnl_pct: guvJeSet[s.set_number]?.pnl_pct ?? undefined,
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
abonniere('sammlungLaden', o => loadGallery(o));
abonniere('kennzahlenLaden', () => loadStats());
abonniere('sammlungZeichnen', () => renderGallery());
abonniere('setAggregat', agg => applySetAggregate(/** @type {Partial<Kachel> | null | undefined} */ (agg)));

// Kein Kommentar zwischen den Namen: test/bundle-smoke.test.js trennt die Schlüssel an Kommas, und ein
// Kommentar wanderte in den ersten Namen.
/**
 * @param {string} sn
 * @param {Event | undefined} ev
 */
function delSetStop(sn, ev) {
  ev?.stopPropagation();
  delSet(sn);
}

registerActions({
  loadGallery,
  delSet,
  delSetStop,
  reimportParts,
  renderGallery,
  setsSortieren,
});
