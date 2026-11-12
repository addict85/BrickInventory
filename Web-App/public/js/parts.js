// Der Reiter Teile: Teile aus Sets (seitenweise) und die manuell erfassten Teile samt Erfassen, Farbwahl und
// CSV-Import — beide Listen teilen Filter und Leerzustand.
import { abonniere } from './ereignisse.js';
import {
  ladeAnzeige,
  skelettKacheln,
  listeLadefehler,
  teileAufschluesselung,
  condBadges,
  ownerBadges,
  zeilenKnopf,
} from './bausteine.js';
import { registerActions, echt } from './registry.js';
import { colorName, locale, t, tRaw } from '../i18n.js';
import { escHex, esc, html, ungeprueft } from './escapen.js';
import { api } from './api.js';
import { bildTag, fullUrl, imgUrl, observeLazyImages, platzhalterInhalt, thumbUrl } from './bilder.js';
import {
  G,
  leerZustand,
  meldeTreffer,
  zuruecksetzenKnopf,
  TRASH_ICON_SVG,
  aktiverReiter,
  setzeHtml,
  fuegeHtmlEin,
} from './dom.js';
import { fmtBig, fmtN } from './format.js';
import { toast } from './meldungen.js';
import { addScopeParam, addLagerParam, scopeQuery } from './scope.js';
import { allSets, CURRENCY } from './zustand.js';
import { confirmDelete } from './rueckfrage.js';
import { manuellQuery, manuelleTabelle, tabellenAnsicht } from './minifigs.js';
import { geloeschtMitRueckgaengig } from './papierkorb.js';
import { loadFinance } from './finance.js';
/** @typedef {import('../../frontend-typen/vertrag').GET_api_v1_sets_setNumber_parts_list['parts'][number]} TeilZeile */

// ── PARTS ─────────────────────────────────────────────
/** @type {import('../../frontend-typen/vertrag').PartsFilterColor[]} */
let partsColors = [];
/** @type {import('../../frontend-typen/vertrag').PartsCategory[]} */
let partsCats = [];
/** @type {string | null} */
let activeColor = null;
/** @type {string | null} */
let activeCat = null;
// Kategorie-ID (part_cat_id) -> Klartextname via geladenem partsCats-Mapping. Ohne Namen ist eine bare ID
// unbekannt; ein eingetragener Name bleibt stehen, wie im Teiledetail.
const katName = (/** @type {unknown} */ cn, /** @type {string | null | undefined} */ label) =>
  label || (cn == null || cn === '' || /^\d+$/.test(String(cn)) ? tRaw('common.unknown') : String(cn));
/** @param {unknown} cn */
function catLabel(cn) {
  const c = partsCats.find(x => String(x.category_name) === String(cn));
  return katName(cn, c?.label);
}

export async function loadParts() {
  // Run stats + filters in parallel, then load data (needs filters first for UI)
  await Promise.all([loadPartsStats(), loadPartsFilters()]);
  await loadPartsData();
}
/** Platzhalter einer Kennzahl, solange sie lädt — „—“ hiesse „kein Wert“. */
const WERT_SKELETT = '<span class="skelett-zeile skelett-wert" aria-hidden="true"></span>';

async function loadPartsStats() {
  const felder = ['ps-total', 'ps-unique', 'ps-colors'];
  const box = G('parts-stats-bar');
  if (!G('ps-total').dataset.geladen) {
    for (const id of felder) setzeHtml(G(id), ungeprueft(WERT_SKELETT));
    box?.setAttribute('aria-busy', 'true');
  }
  const d = await api('GET', `/v1/parts/stats${scopeQuery('parts')}`);
  box?.removeAttribute('aria-busy');
  if (!d.success) {
    if (!G('ps-total').dataset.geladen) for (const id of felder) G(id).textContent = '—';
    return;
  }
  G('ps-total').dataset.geladen = '1';
  const s = d.stats;
  if (!s) return;
  // Wie die Kachel der Sammlung: Teile aus Sets und einzeln erfasste zusammen.
  const einzeln = s.manual_parts || 0;
  G('ps-total').textContent = fmtBig((s.total_parts || 0) + einzeln);
  G('ps-total-sub').textContent = teileAufschluesselung(s.total_parts || 0, einzeln);
  G('ps-unique').textContent = fmtBig(s.unique_parts || 0);
  G('ps-colors').textContent = String(s.unique_colors || 0);
}

async function loadPartsFilters() {
  const [cd, catd] = await Promise.all([
    api('GET', `/v1/parts/colors${scopeQuery('parts')}`),
    api('GET', `/v1/parts/categories${scopeQuery('parts')}`),
  ]);
  partsColors = cd.colors || [];
  partsCats = catd.categories || [];
  zeichneTeileFilter();
}

/**
 * Farbe und Kategorie als Auswahlfelder in der Filterleiste. Sie gelten wie Suche und Konto für BEIDE Listen;
 * die manuellen Teile bringen ihre Farben und Kategorien deshalb mit ein. Ohne Auswahl bleibt ein Feld
 * verborgen.
 */
export function zeichneTeileFilter() {
  const farben = new Map(
    partsColors.map(c => [
      c.color_name ?? '',
      `${colorName(c.color_name)} (${c.unique_parts} ${t('parts.stat.types')})`,
    ]),
  );
  const kategorien = new Map(partsCats.map(c => [String(c.category_name), katName(c.category_name, c.label)]));
  for (const p of manualPartsCache) {
    if (p.color_name && !farben.has(p.color_name)) farben.set(p.color_name, colorName(p.color_name));
    if (p.category_name != null && p.category_name !== '' && !kategorien.has(String(p.category_name)))
      kategorien.set(String(p.category_name), catLabel(p.category_name));
  }
  fuelleFilter('parts-color', tRaw('parts.filter.all_colors'), farben, activeColor);
  fuelleFilter('parts-cat', tRaw('parts.filter.all_categories'), kategorien, activeCat);
}

/**
 * @param {string} id
 * @param {string} alle
 * @param {Map<string, string>} eintraege
 * @param {string | null} gewaehlt
 */
function fuelleFilter(id, alle, eintraege, gewaehlt) {
  const el = G(id);
  if (!el) return;
  // Eine gewählte Farbe bleibt auswählbar, auch wenn ein anderer Filter sie gerade ausblendet.
  if (gewaehlt && !eintraege.has(gewaehlt)) eintraege.set(gewaehlt, gewaehlt);
  setzeHtml(
    el,
    html`${html`<option value="">${alle}</option>`}${[...eintraege].map(([wert, text]) => html`<option value="${wert}">${text}</option>`)}`,
  );
  el.value = gewaehlt || '';
  el.style.display = eintraege.size ? '' : 'none';
}

function setColorFilter() {
  activeColor = G('parts-color').value || null;
  loadPartsData();
  renderManualParts();
}
function setCatFilter() {
  activeCat = G('parts-cat').value || null;
  loadPartsData();
  renderManualParts();
}

/**
 * Passt ein manuell erfasstes Teil zu Farbe und Kategorie der Filterleiste?
 * @param {{ color_name?: string | null, category_name?: unknown }} p
 */
export function teilPasstZumFilter(p) {
  if (activeColor && p.color_name !== activeColor) return false;
  if (activeCat && String(p.category_name ?? '') !== String(activeCat)) return false;
  return true;
}

/** @type {boolean | null} */
let _setTeileLeer = null; // null: noch nicht geladen
/**
 * @type {boolean | null}
 */
let _manuelleLeer = null;

/**
 * Ein Leerzustand für den ganzen Reiter: Er steht nur da, wenn weder manuell erfasste Teile noch Teile aus
 * Sets zu sehen sind. Eine leere Teilliste verschwindet stumm, solange die andere etwas zeigt.
 * @param {boolean} [manuelleLeer]
 */
export function teileLeerAbgleichen(manuelleLeer) {
  if (manuelleLeer !== undefined) _manuelleLeer = manuelleLeer;
  G('tab-parts')?.classList.remove('sammlung-leer');
  const box = G('manual-parts-box');
  // Erst sichtbar, wenn die Liste geladen ist und etwas zeigt: Vorher stand die leere Box „Manuell erfasste
  // Teile“ über dem Skelett.
  if (box) box.style.display = _manuelleLeer === false ? '' : 'none';
  if (_setTeileLeer !== true) return;
  const main = G('parts-main');
  if (_manuelleLeer === false) {
    main.replaceChildren();
    return;
  }
  const q = G('parts-search')?.value.trim() || '';
  const gefiltert = !!(activeColor || activeCat || q || G('parts-spare')?.value);
  G('tab-parts')?.classList.toggle('sammlung-leer', !gefiltert);
  // Wie in allen Listen: „Noch keine …“ ohne Filter, sonst „Keine Treffer“.
  if (gefiltert) meldeTreffer(q ? tRaw('common.no_hits', { query: q }) : tRaw('parts.no_filter_match'));
  setzeHtml(
    main,
    gefiltert
      ? leerZustand({
          ico: 'suche',
          titel: q ? tRaw('common.no_hits', { query: q }) : tRaw('parts.no_filter_match'),
          knopf: zuruecksetzenKnopf('parts'),
        })
      : leerZustand({
          ico: 'teil',
          titel: tRaw('parts.empty'),
          text: tRaw(allSets.length ? 'parts.hint_import' : 'parts.none_manual_hint'),
          knopf: { text: tRaw('parts.add_title'), click: 'oeffneErfassen', arg: 'part' },
        }),
  );
}

/** Suche, Ersatzteil-, Farb- und Kategoriefilter leeren (Knopf im Leerzustand). */
export function teileFilterZuruecksetzen() {
  activeColor = null;
  activeCat = null;
  for (const id of ['parts-search', 'parts-spare', 'parts-color', 'parts-cat']) {
    const el = G(id);
    if (el) el.value = '';
  }
  teileFilterGeaendert();
}

// Seitenweise mit Endlos-Scroll statt der ganzen Wand auf einmal: Alle Teil/Farb-Kombinationen waren 20 MB
// und zehntausende Knoten je Tabwechsel. Eine Farbe kann über die Seitengrenze laufen; _partsLastColor hängt
// die neue Seite deshalb an die letzte Gruppe an statt eine zweite Überschrift.

const PARTS_PAGE_SIZE = 100;
let _partsPage = 0; // zuletzt geladene Seite
let _partsTotal = 0; // Gesamtzahl der Gruppen laut Server
let _partsShown = 0; // bereits gerenderte Gruppen
let _partsGen = 0; // Generationszähler gegen späte Antworten
let _partsLoading = false;
let _partsDone = false;
/** @type {string | null} */
let _partsLastColor = null; // Farbe der zuletzt gerenderten Gruppe

/**
 * Filter- und Modusparameter für eine Seitenabfrage.
 * @param {number} page
 */
function partsParams(page) {
  const p = new URLSearchParams();
  if (activeColor) p.set('color', activeColor);
  if (activeCat) p.set('category', activeCat);
  const search = G('parts-search').value.trim();
  if (search) p.set('search', search);
  const spare = G('parts-spare').value;
  if (spare !== '') p.set('spare', spare);
  const ordnung = G('parts-ordnung').value;
  if (ordnung !== 'farbe') p.set('ordnung', ordnung);
  // Manuell erfasste Teile haben ihren eigenen Bereich oben — hier nur Set-Teile.
  p.set('exclude_manual', '1');
  // in_sets ist serverseitig Opt-in (kostet bei 380 Sets rund 155 ms und 2 MB). Nur die Tabellenansicht hat
  // eine Spalte dafür, die Kachel nicht.
  if (G('parts-view').value === 'table') p.set('with_sets', '1');
  p.set('page', String(page));
  p.set('page_size', String(PARTS_PAGE_SIZE));
  addScopeParam(p, 'parts');
  addLagerParam(p, 'parts');
  return p;
}

/** Vollständiger Neuaufbau — bei jedem Filter-, Such- oder Moduswechsel. */
async function loadPartsData() {
  _partsGen++;
  _partsPage = 0;
  _partsShown = 0;
  _partsTotal = 0;
  _partsDone = false;
  _partsLoading = false;
  _partsLastColor = null;
  _setTeileLeer = null;

  const main = G('parts-main');
  setzeHtml(main, skelettKacheln(12, tRaw('parts.loading'), 'teil'));
  await loadPartsPage(true);
}

/**
 * Nächste Seite holen und anhängen.
 * @param {boolean} isFirst
 */
async function loadPartsPage(isFirst) {
  if (_partsLoading || _partsDone) return;
  _partsLoading = true;
  const gen = _partsGen;
  const page = _partsPage + 1;

  const d = await api('GET', `/v1/parts?${partsParams(page)}`);
  // Antwort einer inzwischen verworfenen Filterkombination — verwerfen.
  if (gen !== _partsGen) {
    _partsLoading = false;
    return;
  }
  if (listeLadefehler(G('parts-main'), d, { erneut: 'loadParts', behalten: !isFirst })) {
    _partsLoading = false;
    return;
  }

  const parts = d.parts || [];
  _partsTotal = d.total ?? _partsTotal;
  _partsPage = page;

  if (isFirst && !parts.length) {
    _setTeileLeer = true;
    teileLeerAbgleichen();
    _partsDone = true;
    _partsLoading = false;
    updatePartsSentinel();
    return;
  }

  if (isFirst) {
    _setTeileLeer = false;
    teileLeerAbgleichen();
    preparePartsShell();
  }
  // Wie in der Sammlung: Eine Suche sagt Vorlesern, wie viele Einträge sie fand.
  if (isFirst && (activeColor || activeCat || G('parts-search')?.value.trim() || G('parts-spare')?.value))
    meldeTreffer(tRaw('treffer.eintraege', { n: _partsTotal || parts.length }));
  appendParts(parts);

  _partsShown += parts.length;
  // Fertig, wenn alles da ist oder der Server weniger als eine volle Seite liefert.
  if (parts.length < PARTS_PAGE_SIZE || (_partsTotal && _partsShown >= _partsTotal)) _partsDone = true;
  updatePartsSentinel();
  _partsLoading = false;

  // Füllt die erste Seite den Bildschirm nicht aus, gäbe es kein Scroll-Ereignis und der Sentinel bliebe für
  // immer sichtbar. Dann direkt nachlegen.
  if (!_partsDone && isFirst) requestAnimationFrame(maybeLoadMoreParts);
}

/** Grundgerüst je nach Ansichtsmodus anlegen (einmal pro Neuaufbau). */
function preparePartsShell() {
  const main = G('parts-main');
  if (G('parts-view').value === 'table') {
    setzeHtml(
      main,
      html`${html`<div class="tw"><table class="dt" aria-label="${tRaw('nav.parts')}"><thead><tr>`}${html`<th>${tRaw('col.image_th')}</th><th>${tRaw('col.part_nr')}</th><th>${tRaw('col.name')}</th>`}${html`<th>${tRaw('col.color')}</th><th>${tRaw('col.category')}</th><th>${tRaw('detail.qty')}</th>`}${html`<th>${tRaw('col.sets')}</th>`}${html`</tr></thead><tbody class="parts-body"></tbody></table></div>`}`,
    );
  } else {
    setzeHtml(main, html`<div class="parts-list"></div>`);
  }
  // parts-list und parts-body sind Kinder von #parts-main und werden bei jedem Neuaufbau ersetzt — deshalb
  // Klassen statt IDs. Der Sentinel steht dagegen statisch in index.html (wie cat-sentinel) und überlebt den
  // Moduswechsel.
  bindPartsSentinel();
}

/**
 * Eine Seite an die bestehende Darstellung anhängen.
 * @param {TeilZeile[]} parts
 */
function appendParts(parts) {
  if (G('parts-view').value === 'table') {
    const tb = G('parts-main').querySelector('tbody.parts-body');
    if (!tb) return;
    fuegeHtmlEin(tb, 'beforeend', parts.map(partsTableRow));
    if (typeof observeLazyImages === 'function') observeLazyImages(tb);
    if (typeof window.__bimLabelTables === 'function') window.__bimLabelTables(tb.closest('table'));
    return;
  }

  const list = G('parts-main').querySelector('.parts-list');
  if (!list) return;
  // Ungruppiert: dasselbe Raster ohne Farbkacheln, die Reihenfolge kommt vom Server.
  if (G('parts-ordnung').value !== 'farbe') {
    fuegeHtmlEin(list, 'beforeend', parts.map(partsCard));
    if (typeof observeLazyImages === 'function') observeLazyImages(list);
    return;
  }

  // Nach Farbe gruppieren — der Server liefert bereits farbsortiert.
  /** @type {{ color: string, hex: string | null | undefined, parts: TeilZeile[] }[]} */
  const groups = [];
  for (const p of parts) {
    // Gruppiert wird über den ENGLISCHEN Namen — er ist der stabile Schlüssel aus der Datenbank. Übersetzt
    // wird erst die Überschrift beim Zeichnen.
    const key = p.color_name || '';
    const last = groups[groups.length - 1];
    if (last && last.color === key) last.parts.push(p);
    else groups.push({ color: key, hex: p.color_hex, parts: [p] });
  }

  let markup = html``;
  for (const g of groups) {
    // Setzt die Gruppe die letzte der vorigen Seite fort? Dann in deren Raster einhängen statt eine zweite
    // Überschrift derselben Farbe zu erzeugen.
    if (g.color === _partsLastColor) {
      const lastGrid = list.querySelector('.parts-group:last-child .parts-grid');
      if (lastGrid) {
        fuegeHtmlEin(lastGrid, 'beforeend', g.parts.map(partsCard));
        bumpGroupCount(lastGrid.closest('.parts-group'), g.parts.length);
        if (typeof observeLazyImages === 'function') observeLazyImages(lastGrid);
        continue;
      }
    }
    markup = html`${markup}${html`<div class="parts-group" data-count="${g.parts.length}">
      <div class="group-hd">
        <div class="color-dot gross" data-farbe="${escHex(g.hex, 'var(--s300)')}"></div>
        <span class="group-title">${g.color ? colorName(g.color) : tRaw('parts.farbe_unbekannt')}</span>
        <span class="group-sub">${tRaw('parts.group_types', { n: g.parts.length })}</span>
      </div>
      <div class="parts-grid">${g.parts.map(partsCard)}</div>
    </div>`}`;
    _partsLastColor = g.color;
  }
  if (markup) {
    fuegeHtmlEin(list, 'beforeend', markup);
    if (typeof observeLazyImages === 'function') observeLazyImages(list);
  }
  if (groups.length) _partsLastColor = groups[groups.length - 1].color;
}

/**
 * Zähler in der Gruppenüberschrift hochsetzen. Ohne das stünde dort die Anzahl der Karten aus der ERSTEN
 * Seite, obwohl die Gruppe inzwischen weitergewachsen ist.
 * @param {HTMLElement | null | undefined} groupEl
 * @param {number} add
 */
function bumpGroupCount(groupEl, add) {
  if (!groupEl) return;
  const n = (parseInt(groupEl.dataset.count ?? '', 10) || 0) + add;
  groupEl.dataset.count = String(n);
  const sub = groupEl.querySelector('.group-sub');
  if (sub) sub.textContent = tRaw('parts.group_types', { n });
}

/**
 * Ersatzteil-Plakette. `p.is_spare` genügt, weil der Server die vier Schreibweisen in istErsatzteil() zu
 * einem echten Wahrheitswert macht — die Zeichenkette "0" wäre in JavaScript wahr.
 * @param {{ is_spare?: boolean | null }} p
 */
function ersatzteilPlakette(p) {
  return p.is_spare ? html`<span class="spare-tag">${t('parts.spare_tag')}</span>` : '';
}

/** Alternativtext eines Teilbilds: Name und Farbe, wie sie auf der Kachel stehen. */

/** @param {TeilZeile} p */
function partsCard(p) {
  // data-orig speist den Zoom (actions.js, openImageLightboxFromEl): ÜBER den Server-Proxy in voller
  // Auflösung (imgUrl(fullUrl(...), false)), nicht mehr die rohe CDN-Adresse direkt im Browser. Anders als
  // bei Sets bewusst so — auf Nutzerwunsch soll auch das Detailbild der Teile über das Backend laufen, nicht
  // am Server vorbei direkt zum CDN.
  const rawSrc = p.image_local || p.image_url || '';
  // Die Kachel oeffnet den Detail-Dialog (Marcos Wunsch). Bis hierher war sie tot: Anders als bei manuell
  // erfassten Teilen gab es zu einem Teil aus einem Set nichts zu sehen — kein Bild in voller Groesse, keine
  // Angabe, aus welchem Set es stammt.
  return html`<div class="part-card" data-stil="cursor:pointer" tabindex="0" role="button" data-click="openSetItemDetail" data-arg="part" data-arg2="${p.part_number}" data-arg3="${p.color_id || 0}">
    ${rawSrc ? bildTag({ src: imgUrl(thumbUrl(rawSrc) || rawSrc, true), alt: '', klasse: 'part-img', fade: true, orig: imgUrl(fullUrl(rawSrc), false), ph: 'teil' }) : html`<span class="bild-ph part-img" aria-hidden="true">${platzhalterInhalt('teil')}</span>`}
    <div class="part-num" title="${p.part_number}">${p.bl_part_number || p.part_number}</div>
    <div class="part-name">${p.part_name || '—'}</div>
    <div class="part-color"><div class="color-dot" data-farbe="${escHex(p.color_hex, 'var(--s300)')}"></div>${colorName(p.color_name)}</div>
    <div class="part-qty">×${(p.total_quantity || 0).toLocaleString(locale())}</div>
    ${ersatzteilPlakette(p)}
  </div>`;
}

/** @param {TeilZeile} p */
function partsTableRow(p) {
  // Dieselbe Handlung wie auf der Kachel — eine Ansicht darf nicht koennen, was die andere nicht kann. Genau
  // daran ist in diesem Projekt schon mehrfach etwas auseinandergelaufen.
  return html`<tr data-stil="cursor:pointer" data-click="openSetItemDetail" data-arg="part" data-arg2="${p.part_number}" data-arg3="${p.color_id || 0}">
    <td>${p.image_local || p.image_url ? bildTag({ src: imgUrl(thumbUrl(p.image_local || p.image_url) || p.image_local || p.image_url, true), alt: '', klasse: 'bild-klein', ph: 'teil' }) : html`<span class="bild-ph bild-klein" aria-hidden="true">${platzhalterInhalt('teil')}</span>`}</td>
    <td>${zeilenKnopf(
      { click: 'openSetItemDetail', arg: 'part', arg2: p.part_number, arg3: p.color_id || 0 },
      html`<span data-stil="font-family:var(--mono);font-size:var(--fs-1);color:var(--b600)" title="${p.part_number}">${p.bl_part_number || p.part_number}</span>`,
      tRaw('zeile.oeffnen', { name: p.part_name || p.part_number, nr: p.bl_part_number || p.part_number }),
    )}</td>
    <td data-stil="max-width:200px">${p.part_name || '—'} ${ersatzteilPlakette(p)}</td>
    <td><div data-stil="display:flex;align-items:center;gap:5px"><div class="color-dot" data-farbe="${escHex(p.color_hex, 'var(--s300)')}"></div>${colorName(p.color_name)}</div></td>
    <td>${catLabel(p.category_name)}</td>
    <td><span data-stil="font-family:var(--mono);font-weight:600;color:var(--b700)">${(p.total_quantity || 0).toLocaleString(locale())}</span></td>
    <td data-stil="font-size:var(--fs-1);color:var(--mut)">${(p.in_sets || '').replace(/,/g, ', ')}</td>
  </tr>`;
}

/** Ladehinweis bzw. Abschlusszeile unter der Liste. */
function updatePartsSentinel() {
  const s = G('parts-sentinel');
  if (!s) return;
  if (_partsDone) {
    setzeHtml(
      s,
      _partsTotal
        ? html`<div data-stil="text-align:center;color:var(--mut);font-size:var(--fs-2);padding:1rem">${tRaw('parts.eintraege', { n: _partsTotal })}</div>`
        : '',
    );
  } else {
    setzeHtml(s, ladeAnzeige('', { stil: 'padding:1rem' }));
  }
}

/** @type {IntersectionObserver | null} */
let _partsIO = null;
function bindPartsSentinel() {
  const s = G('parts-sentinel');
  if (!s) return;
  if (typeof IntersectionObserver !== 'undefined') {
    if (_partsIO) _partsIO.disconnect();
    _partsIO = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) maybeLoadMoreParts();
      },
      { rootMargin: '600px' }, // Vorlauf, damit vor dem Sichtbarwerden geladen wird
    );
    _partsIO.observe(s);
  } else if (!window._partsScrollBound) {
    // Fallback für Browser ohne IntersectionObserver
    window._partsScrollBound = true;
    window.addEventListener(
      'scroll',
      () => {
        const el = G('parts-sentinel');
        if (el && el.getBoundingClientRect().top < window.innerHeight + 600) maybeLoadMoreParts();
      },
      { passive: true },
    );
  }
}

function maybeLoadMoreParts() {
  if (_partsDone || _partsLoading) return;
  // Nur laden, wenn der Teile-Tab auch sichtbar ist.
  const tab = G('tab-parts');
  if (tab && !tab.classList.contains('active')) return;
  loadPartsPage(false);
}

/**
 * Der Suchtext gilt für BEIDE Listen des Reiters: Die Filterleiste steht über den manuellen Teilen, also
 * müssen sie mitfiltern. Eine Entprellung für beide, damit keine Liste vergessen werden kann.
 */
function teileFilterGeaendert() {
  loadPartsData();
  loadManualParts();
}
G('parts-search').addEventListener('input', () => {
  clearTimeout(G('parts-search')._t);
  G('parts-search')._t = setTimeout(teileFilterGeaendert, 350);
});
G('parts-spare').addEventListener('change', loadPartsData);
// Die Reihenfolge ist eine Vorliebe, kein Filter: Sie bleibt im Browser stehen.
const TEILE_ORDNUNG_KEY = 'bim_teile_ordnung';
try {
  const gemerkt = localStorage.getItem(TEILE_ORDNUNG_KEY);
  if (gemerkt && [...G('parts-ordnung').querySelectorAll('option')].some(o => o.value === gemerkt))
    G('parts-ordnung').value = gemerkt;
} catch (_) {
  /* ohne Speicher gilt die Vorgabe */
}
G('parts-ordnung').addEventListener('change', () => {
  try {
    localStorage.setItem(TEILE_ORDNUNG_KEY, G('parts-ordnung').value);
  } catch (_) {
    /* nur Komfort */
  }
  loadPartsData();
});
/**
 * Der Ansichtsumschalter gilt für beide Listen. Die Set-Teile laden neu (Tabelle braucht with_sets=1), die
 * manuellen werden nur neu gezeichnet: Sie haben die Daten schon, ein zweiter Abruf wäre nur Wartezeit.
 */
function teileAnsichtGeaendert() {
  loadPartsData();
  renderManualParts();
}
G('parts-view').addEventListener('change', teileAnsichtGeaendert);

// ── MANUAL PARTS ─────────────────────────────────────────────────────────────
/** @type {ManuellesTeil[]} */
let manualPartsCache = [];
/** Die zuletzt geladenen manuell erfassten Teile (nur lesen). */
export function manuelleTeile() {
  return manualPartsCache;
}

export async function loadManualParts() {
  const [d, v] = await Promise.all([
    api('GET', `/v1/parts/manual${manuellQuery('parts', 'parts-search')}`),
    // Derselbe Filter wie die Liste darüber: Sonst stünden Zähler und Menge aus dem einen Blickfeld neben
    // einer Summe aus einem anderen.
    api('GET', `/v1/finance/parts-valuation${scopeQuery('parts')}`),
  ]);
  if (!d.success) return;
  manualPartsCache = d.parts || [];
  renderManualParts();
  if (v.success) {
    if (G('mp-count')) G('mp-count').textContent = String(d.parts.length);
    if (G('mp-qty')) G('mp-qty').textContent = String(d.parts.reduce((s, p) => s + (p.quantity || 0), 0));
    if (G('mp-val')) G('mp-val').textContent = fmtN(v.total_value, v.currency || CURRENCY);
  }
}

export function renderManualParts() {
  const el = G('manual-parts-list');
  zeichneTeileFilter();
  const teile = manualPartsCache.filter(teilPasstZumFilter);
  teileLeerAbgleichen(!teile.length);
  if (G('manual-parts-n'))
    G('manual-parts-n').textContent = teile.length ? tRaw('parts.group_types', { n: teile.length }) : '';
  if (!teile.length) {
    el.replaceChildren();
    return;
  }
  if (tabellenAnsicht('parts-view')) {
    setzeHtml(el, manuelleTabelle(teile, 'part'));
    if (typeof window.__bimLabelTables === 'function') window.__bimLabelTables(el.querySelector('table'));
    return;
  }
  setzeHtml(
    el,
    html`<div class="man-grid">
    ${teile.map(p => {
      // Vorschau über den Server-Proxy wie überall: nie das CDN-Bild in voller Auflösung in der Kachel.
      const imgSrc = imgUrl(thumbUrl(p.image_local || p.image_url) || p.image_local || p.image_url || '', true);
      const img = imgSrc
        ? bildTag({ src: imgSrc, alt: '', klasse: 'man-tile-img', ph: 'teil' })
        : `<span class="bild-ph man-tile-img" aria-hidden="true">${platzhalterInhalt('teil')}</span>`;
      const colorRow = p.color_name
        ? `<div class="man-tile-color">${p.color_hex ? `<span class="man-tile-swatch" data-farbe="${escHex(p.color_hex, 'var(--s300)')}"></span>` : ''}${esc(colorName(p.color_name))}</div>`
        : '';
      // Wie bei den Minifiguren: mengengewichtet über die Erfassungen.
      const partPrice = p.avg_purchase_price ?? p.unit_price ?? p.purchase_price;
      const priceStr = partPrice != null ? fmtN(partPrice, CURRENCY) : '—';
      const condBadge = condBadges(p);
      return html`<div class="man-tile" tabindex="0" role="button" aria-keyshortcuts="Delete" data-click="openManDetail" data-arg="part" data-arg2="${p.part_number}" data-arg3="${p.color_id || 0}" data-stil="cursor:pointer">
        <div class="ca"><span class="delbtn" data-click="deleteManualPartStop"${echt()} aria-hidden="true" data-arg="${p.part_number}" data-arg2="${p.color_id || 0}" data-arg3="${p.user_id || ''}" title="${t('parts.delete.title')}">${TRASH_ICON_SVG}</span></div>
        ${ungeprueft(img)}
        <div class="man-tile-num" title="${p.part_number}">${p.bl_part_number || p.part_number}</div>
        <div class="man-tile-name">${p.part_name || '—'}</div>
        ${ungeprueft(colorRow)}
        <div data-stil="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:2px">
          <span class="qbadge">×${p.quantity}</span>${ungeprueft(condBadge)}${ownerBadges(p)}
        </div>
        <div class="preis man-preis">${ungeprueft(priceStr)}</div>
      </div>`;
    })}
  </div>`,
  );
}

/**
 * @param {number | string} [owner] Besitzer der Karte — siehe deleteManualPart.
 * @param {string} partNumber
 * @param {number} colorId
 * @param {object} body
 */
export async function updateManualPart(partNumber, colorId, body, owner) {
  const d = await api(
    'PUT',
    `/v1/parts/${encodeURIComponent(partNumber)}/${colorId}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`,
    body,
  );
  if (d.success) {
    toast(tRaw('settings.saved'), 'success');
    loadManualParts();
    if (aktiverReiter() === 'finance') loadFinance();
  } else toast(d.error || t('settings.error'), 'error');
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
  if (!(await confirmDelete(tRaw('parts.delete.title'), tRaw('gallery.delete.text', { name: partNumber }), 'teil')))
    return false;
  const d = await api(
    'DELETE',
    `/v1/parts/${encodeURIComponent(partNumber)}/${colorId}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`,
  );
  if (d.success) {
    geloeschtMitRueckgaengig(tRaw('parts.deleted'), d);
    loadManualParts();
    return true;
  } else {
    toast(d.error || t('settings.error'), 'error');
    return false;
  }
}

abonniere('bestandGeaendert', () => {
  loadParts();
  loadManualParts();
});

// ── Handler beim Dispatcher anmelden (siehe js/registry.js) ──────────────
registerActions({
  loadParts,
  setCatFilter,
  setColorFilter,
});
