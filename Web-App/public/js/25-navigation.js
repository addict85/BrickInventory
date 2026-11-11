// Reiter, Benutzermenü, Sichten und die Filter, die mehrere Listen neu laden. Steht über allen Ansichten und
// darf jede laden; der Router erreicht die Sichten über 00-ziele.js, nicht über einen Import.
import { stelleZielBereit } from './00-ziele.js';
import { registerActions } from './00-registry.js';
import { G, leerZustand, alle, eins, setzeHtml, rollArt } from './01-dom.js';
import { ME, _lastImportAt } from './00-zustand.js';
import { loadMonitor, stoppeMonitor } from './01-monitor.js';
import { figurenFilterZuruecksetzen, loadManualFigsTable, loadMinifigs } from './06-minifigs.js';
import { initCatalog, katalogZuruecksetzen } from './09-catalog.js';
import { pollJobStatus, stoppeJobAbfrage } from './07-admin.js';
import { ladeAlarmUebersicht } from './05-alarme.js';
import { ladeLagerortVerwaltung } from './05-lagerorte.js';
import { loadApiLimits, loadCacheStats, loadCacheTtl, loadProfile, loadRateLimitStats, loadSettings } from './05-settings.js';
import { ladeTls, loadTokens } from './05-zugaenge.js';
import { loadHousehold } from './05-haushalt.js';
import { ladeGutscheine } from './17-gutscheine.js';
import { ladeMerkliste, merklisteZuruecksetzen } from './16-merkliste.js';
import { ladePapierkorb } from './20-papierkorb.js';
import { ladePasskeys } from './23-passkeys.js';
import { ladeZweitenFaktor } from './21-zweiter-faktor.js';
import { loadFinance } from './04-finance.js';
import { loadGallery, loadStats, renderGallery } from './02-gallery.js';
import { loadParts, teileFilterZuruecksetzen, loadManualParts } from './03-parts.js';
import { loadBrickColors } from './03-teil-erfassen.js';
import { meldeAnsicht, meldeFilter } from './24-router.js';
import { setLagerModus, setScopeMode } from './14-scope.js';
import { setScrollLabel } from './15-scrollbar.js';
import { tRaw } from '../i18n.js';
import { abonniere } from './00-ereignisse.js';
import { esc } from './00-escapen.js';

// Icon des Reiters in den Seitentitel spiegeln (links vom Text), damit oben derselbe Icon wie im Nav-Tab
// erscheint. Quelle ist der Nav-Tab selbst — Emoji ODER Inline-SVG —, so bleibt beides automatisch synchron.
/**
 * @param {string | undefined} tab
 */
function syncTabTitleIcon(tab){
  const nav = document.querySelector(`.ntab[data-tab="${tab}"]`);
  const slot = document.querySelector(`.ptitle[data-tab-title="${esc(tab)}"] .ptitle-icon`);
  if(!nav || !slot) return;
  // Alles vor dem .tab-label ist das Icon (Emoji-Textknoten oder <svg>).
  const label = nav.querySelector('.tab-label');
  // Kopien statt outerHTML: Als Text neu eingelesen, stünde der Stil des Symbols wieder als style-Attribut
  // da, und das verbietet die CSP.
  const kopien = [];
  for(const node of nav.childNodes){
    if(node === label) break;
    if(node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').trim() : true) kopien.push(node.cloneNode(true));
  }
  slot.replaceChildren(...kopien);
}

/**
 * Sets, Teile und Minifiguren teilen sich in der Leiste EIN Ziel („Sammlung"); umgeschaltet wird oben auf der
 * Seite. Teile und Minifiguren behalten ihren unsichtbaren Reiter — Code und Wiederherstellung sprechen sie
 * darüber an.
 */
const SAMMLUNG = ['gallery', 'parts', 'minifigs'];

/**
 * @param {string | null | undefined} tab
 */
function markiereGruppe(tab){
  // Eigene Klasse statt .active: `.ntab.active` nennt überall den offenen Reiter.
  const sammlung = document.querySelector('.ntab[data-tab="gallery"]');
  sammlung?.classList.toggle('gruppe-aktiv', !!tab && SAMMLUNG.includes(tab));
  // Die drei Knöpfe wechseln die Ansicht; die offene ist die aktuelle Seite.
  alle('.sammlung-wahl [data-arg]').forEach(b => {
    if (b.dataset.arg === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  // Vorleseprogramme erfahren so, welcher Reiter offen ist. „Sammlung“ gilt nur dann als aktuelle Seite, wenn
  // der eigene Reiter der Ansicht nicht zu sehen ist (am Telefon).
  const offen = document.querySelector('.ntab.active');
  const offenSichtbar = !!offen?.getClientRects().length;
  document.querySelectorAll('.ntab').forEach(x => {
    if (x.classList.contains('active') || (x.classList.contains('gruppe-aktiv') && !offenSichtbar && x !== offen)) x.setAttribute('aria-current', 'page');
    else x.removeAttribute('aria-current');
  });
}

/** Am Handy: die Filter hinter einem Knopf, damit die Liste oben beginnt. @this {HTMLElement} */
export function filterUmschalten(){
  const leiste = this?.closest?.('.filterleiste');
  if (!leiste) return;
  const offen = leiste.classList.toggle('offen');
  this.setAttribute('aria-expanded', String(offen));
}

/** Wer kein Verwalter ist, sieht im Reiter Einstellungen einen Satz statt einer leeren Seite. */
function zeigeEinstellungsZugriff(){
  const f = G('einst-kein-zugriff');
  if (!f) return;
  f.hidden = !!ME?.isAdmin;
  setzeHtml(f, ME?.isAdmin ? '' : leerZustand({ ico: 'schloss', titel: tRaw('settings.kein_zugriff'), text: tRaw('settings.kein_zugriff_text') }));
}

/**
 * Einen Reiter öffnen — aus dem Umschalter der Sammlung oder dem Menü.
 * @param {string} name
 */
export function oeffneReiter(name){
  const ausMenue = !!G('umenu-pop')?.contains(document.activeElement);
  menueSchliessen();
  eins(`.ntab[data-tab="${name}"]`)?.click();
  if (ausMenue) fokusAufTitel(G('tab-'+name));
}

/**
 * Nach einer Wahl im Menü steht der Fokus auf einem nun verborgenen Eintrag und fiele an den Seitenanfang;
 * die Überschrift der neuen Seite ist der Ort, an dem Tastatur und Bildschirmleser weitermachen.
 */
/** @param {HTMLElement | null} flaeche */
function fokusAufTitel(flaeche){
  const titel = /** @type {HTMLElement|null} */ (flaeche?.querySelector('.ptitle') ?? null);
  if (!titel) { G('btn-umenu')?.focus(); return; }
  if (!titel.hasAttribute('tabindex')) titel.setAttribute('tabindex', '-1');
  titel.focus({ preventScroll: true });
}

export function bindTabs(){
  alle('.ntab').forEach(t=>{
    // Avoid duplicate listeners
    if(t._tabBound) return; t._tabBound=true;
    t.addEventListener('click',()=>{
      document.querySelectorAll('.ntab').forEach(x=>{ x.classList.remove('active'); });
      document.querySelectorAll('.tab').forEach(x=>{ x.classList.remove('active'); });
      // Unsichtbare Reiter (Einstellungen, Monitoring) öffnet das Kontomenü — dann markiert der Menüknopf, wo
      // man ist.
      const unter = t.classList.contains('ntab-unter');
      G('btn-umenu')?.classList.toggle('aktiv', unter);
      if (unter) G('btn-umenu')?.setAttribute('aria-current', 'page'); else G('btn-umenu')?.removeAttribute('aria-current');
      t.classList.add('active'); G('tab-'+t.dataset.tab).classList.add('active');
      const tab = t.dataset.tab ?? '';
      meldeAnsicht(tab);
      markiereGruppe(tab);
      zeigeSeitenname(G('tab-'+tab), unter);
      syncTabTitleIcon(tab);
      // Das Jahres-Etikett am Scrollbalken gehört NUR in den Katalog. Ohne dieses Abmelden lieferte die dort
      // angemeldete Funktion weiterhin ein Jahr — auch in der Galerie, wo die Zahl nichts bedeutet.
      if (tab !== 'catalog') setScrollLabel(null);
      if(tab==='gallery')      { loadGallery(); loadStats(); }
      if(tab==='catalog')      { initCatalog(); }
      if(tab==='wanted')     { ladeMerkliste(); }
      if(tab==='parts')        {
        loadParts(); loadManualParts(); loadBrickColors();
        // War der Import eben erst, nach dem Hintergrundauftrag noch einmal laden
        if(Date.now()-_lastImportAt<30000) setTimeout(()=>{ loadParts(); loadManualParts(); },5000);
      }
      if(tab==='minifigs')     {
        loadMinifigs();
        if(Date.now()-_lastImportAt<30000) setTimeout(loadMinifigs,5000);
      }
      if(tab==='finance')      { loadFinance(); } // loadFinance already fetches parts+minifigs valuation in parallel
      if(tab==='partslist')    { /* session-only, no server load needed */ }
      // Der Reiter traegt seit dem 16.10. nur noch die Verwalter-Rubriken; was frueher hier alles mitgeladen
      // wurde, holt jetzt die jeweilige Sicht beim Oeffnen (siehe oeffneSicht unten). Wer die API-Schluessel
      // nachsieht, braucht keine Gutscheinliste.
      if(tab==='settings')     { zeigeEinstellungsZugriff(); loadSettings(); if(ME?.isAdmin) loadApiLimits(); }
      if(tab==='monitor')      { loadMonitor(); loadCacheStats(); loadRateLimitStats(); loadCacheTtl(); stoppeJobAbfrage(); pollJobStatus(); }
      if(tab!=='monitor' && stoppeMonitor()) stoppeJobAbfrage();
    });
  });
  // Alle Seitentitel-Icons füllen — läuft bei jedem bindTabs()-Aufruf, also auch nach dem Login (showApp ruft
  // bindTabs erneut), wenn der Inhalt sichtbar wird. So erscheint das Icon links vom Titel auf allen Tabs,
  // nicht nur nach einem Klick.
  alle('.ptitle[data-tab-title]').forEach(h=>{ syncTabTitleIcon(h.dataset.tabTitle); });
}

// Aufruf verschoben nach startApp() (js/08-init.js), das js/main.js NACH der Auswertung aller Module aufruft.
// Im Modulrumpf lief er zu früh: Bei gegenseitigen Importen ist das Übersetzungsobjekt aus i18n.js dann noch
// nicht initialisiert, und t() wirft.


// Die Sichten hinter dem Benutzermenü, wie in der Android-App. Jede Sicht lädt nur, was sie zeigt: Vorher
// holte der Einstellungs-Reiter bei jedem Öffnen fünf Bereiche, von denen man meist einen sehen wollte.
/** @type {Record<string, () => unknown>} */
const SICHTEN = {
  profil:     () => { loadSettings(); loadProfile(); ladeZweitenFaktor(); ladePasskeys(); },
  gutscheine: () => ladeGutscheine(),
  alarme:     () => ladeAlarmUebersicht(),
  lagerorte:  () => ladeLagerortVerwaltung(),
  haushalt:   () => loadHousehold(),
  daten:      () => ladePapierkorb(),
  app:        () => { loadTokens(); ladeTls(); },
};

/**
 * Eine Sicht aus dem Menü öffnen.
 * @param {string} name
 */
export function oeffneSicht(name){
  if(!SICHTEN[name]) return;
  const flaeche = G('tab-'+name);
  if(!flaeche) return;
  const ausMenue = !!G('umenu-pop')?.contains(document.activeElement);
  document.querySelectorAll('.ntab').forEach(x=>{ x.classList.remove('active'); });
  document.querySelectorAll('.tab').forEach(x=>{ x.classList.remove('active'); });
  flaeche.classList.add('active');
  markiereGruppe(null);
  zeigeSeitenname(flaeche, true);
  menueSchliessen();
  meldeAnsicht(name);
  // Die Sichten liegen im Kontomenü, nicht in der Leiste: Dann zeigt der Menüknopf, wo man ist — sonst wäre
  // kein Reiter als aktiv markiert.
  G('btn-umenu')?.classList.add('aktiv');
  G('btn-umenu')?.setAttribute('aria-current', 'page');
  // Nach oben: Die Sicht öffnet sich sonst an der Stelle, an der die vorige gerollt war, und man sieht die
  // Mitte einer fremden Seite.
  window.scrollTo({ top: 0, behavior: rollArt() });
  if (ausMenue) fokusAufTitel(flaeche);
  SICHTEN[name]();
}

/**
 * Seitenname im Fenstertitel und, für Seiten hinter dem Menü, im Kopf: Dort markiert kein Reiter die offene
 * Seite, sonst wüsste man nur am Inhalt, wo man ist.
 * @param {Element | null} flaeche
 * @param {boolean} imKopf
 */
function zeigeSeitenname(flaeche, imKopf){
  // Ohne weiche Trennstriche: Im Seitentitel und in der Tab-Leiste werden sie sichtbar oder stören die Suche.
  const titel = (flaeche?.querySelector('.ptitle')?.textContent || '').replace(/\u00AD/g, '').trim();
  const kopf = G('kopf-sicht');
  if (kopf) { kopf.textContent = imKopf ? titel : ''; kopf.hidden = !(imKopf && titel); }
  document.title = titel ? `${titel} – BrickInventory` : 'BrickInventory Manager';
  beobachteTitel(flaeche);
}

/** Beim Start ist die Sammlung schon offen, ohne dass ein Reiter geklickt wurde: Titel trotzdem setzen. */
export function seitennameAktualisieren(){
  const flaeche = document.querySelector('.tab.active');
  const reiter = flaeche && document.querySelector(`.ntab[data-tab="${flaeche.id.replace(/^tab-/, '')}"]`);
  zeigeSeitenname(flaeche, !reiter || reiter.classList.contains('ntab-unter'));
}

/**
 * Am Telefon steht der Seitenname nur dann im Kopf, wenn die Überschrift hinausgerollt ist; sonst stünde er
 * zweimal untereinander.
 * @type {IntersectionObserver | null}
 */
let _titelBeobachter = null;
/**
 * @param {Element | null} flaeche
 */
function beobachteTitel(flaeche){
  const kopf = G('kopf-sicht'), h1 = flaeche?.querySelector('.ptitle');
  _titelBeobachter?.disconnect();
  if (!kopf || !h1 || typeof IntersectionObserver !== 'function') return;
  _titelBeobachter = new IntersectionObserver(([e]) => kopf.classList.toggle('titel-sichtbar', e.isIntersecting),
    { rootMargin: '-64px 0px 0px 0px' });
  _titelBeobachter.observe(h1);
}

function menueSchliessen(fokusZurueck = false){
  const pop = G('umenu-pop');
  const drin = !!pop && pop.contains(document.activeElement);
  if(pop) pop.style.display = 'none';
  const knopf = G('btn-umenu');
  if(knopf) knopf.setAttribute('aria-expanded','false');
  if(knopf && fokusZurueck && drin) knopf.focus();
}

/** Die sichtbaren Einträge; `admin-only` ist für andere Konten ausgeblendet. */
function menueEintraege(){
  return /** @type {HTMLElement[]} */ ([...(G('umenu-pop')?.querySelectorAll('[role="menuitem"]') ?? [])])
    .filter(e => e.style.display !== 'none');
}

/** Öffnet das Menü und setzt den Fokus auf den ersten (oder letzten) Eintrag. */
function menueOeffnen(letzter = false){
  const pop = G('umenu-pop');
  if(!pop) return;
  pop.style.display = 'block';
  G('btn-umenu')?.setAttribute('aria-expanded','true');
  const e = menueEintraege();
  (letzter ? e[e.length - 1] : e[0])?.focus();
}

/** Das Menü auf- und zuklappen. */
export function benutzerMenue(){
  const pop = G('umenu-pop');
  if(!pop) return;
  if(pop.style.display !== 'none'){ menueSchliessen(); return; }
  menueOeffnen();
}

// Tastatur nach dem APG-Muster „Menu Button": Ein Bildschirmleser kündigt role=menu an, und Nutzer erwarten
// dann Pfeiltasten statt Tab.
document.addEventListener('keydown', (ev) => {
  const ziel = ev.target instanceof Element ? ev.target : null;
  if(ziel?.id === 'btn-umenu' && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')){
    ev.preventDefault(); menueOeffnen(ev.key === 'ArrowUp'); return;
  }
  if(!ziel?.closest('#umenu-pop')) return;
  const e = menueEintraege(), i = e.indexOf(/** @type {HTMLElement} */ (ziel));
  const nach = { ArrowDown: (i + 1) % e.length, ArrowUp: (i - 1 + e.length) % e.length, Home: 0, End: e.length - 1 }[ev.key];
  if(nach !== undefined){ ev.preventDefault(); e[nach]?.focus(); return; }
  if(ev.key === 'Tab') menueSchliessen();
});

// Zuklappen, wenn jemand daneben tippt oder Escape drückt. Escape bringt den Fokus zurück auf den Menüknopf,
// sonst fiele er auf den Seitenanfang.
document.addEventListener('click', (ev) => {
  const pop = G('umenu-pop');
  if(!pop || pop.style.display === 'none') return;
  if(ev.target instanceof Element && ev.target.closest('.umenu-wrap')) return;
  menueSchliessen();
});

document.addEventListener('keydown', (ev) => {
  if(ev.key === 'Escape') { menueSchliessen(true); importMenuesSchliessen(null, true); }
});

// Abgemeldet ist #inhalt verborgen; der Sprunglink führt dann ins Anmeldeformular statt ins Leere.
document.querySelector('.sprunglink')?.addEventListener('click', (ev) => {
  if (G('inhalt')?.checkVisibility?.() !== false) return;
  const felder = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('#login-screen input:not([type=hidden])')]);
  const feld = felder.find(f => f.checkVisibility?.() !== false);
  if (!feld) return;
  ev.preventDefault();
  feld.focus();
});

/**
 * Offene Import-Menüs schliessen, ausser dem, in dem `ausser` liegt.
 * @param {Node | null} ausser
 */
function importMenuesSchliessen(ausser, fokusZurueck = false){
  /** @type {NodeListOf<HTMLDetailsElement>} */ (document.querySelectorAll('details.import-menue[open]')).forEach(d => {
    if (ausser && d.contains(ausser)) return;
    d.open = false;
    if (fokusZurueck && d.contains(document.activeElement)) d.querySelector('summary')?.focus();
  });
}

// Ein Klick daneben schliesst das Menü; eine Wahl darin (Datei, Vorlage) ebenso.
document.addEventListener('click', (ev) => {
  const ziel = ev.target instanceof Element ? ev.target : null;
  importMenuesSchliessen(ziel);
  const d = /** @type {HTMLDetailsElement|null} */ (ziel?.closest('.import-klappe a')?.closest('details') ?? null);
  if (d) d.open = false;
});

document.addEventListener('change', (ev) => {
  const d = ev.target instanceof Element ? /** @type {HTMLDetailsElement|null} */ (ev.target.closest('details.import-menue')) : null;
  if (d) d.open = false;
});

/**
 * Alle Filter einer Ansicht leeren (Knopf im Leerzustand ohne Treffer).
 * @param {string} ansicht
 */
function filterZuruecksetzen(ansicht) {
  if (ansicht === 'gallery') {
    G('gs').value = ''; G('gtheme').value = '';
    setLagerModus('gallery', ''); if (G('storage-gallery')) G('storage-gallery').value = '';
    loadGallery();
  } else if (ansicht === 'merkliste') merklisteZuruecksetzen();
  else if (ansicht === 'catalog') katalogZuruecksetzen();
  else if (ansicht === 'parts') teileFilterZuruecksetzen();
  else if (ansicht === 'minifigs') figurenFilterZuruecksetzen();
  meldeFilter();
}

/**
 * Umschalten — lädt NUR die betroffene Ansicht neu, wie beim Kontofilter.
 *
 * Im Reiter Teile BEIDE Listen: Seit der Lagerortfilter auch die manuell erfassten Teile trifft
 * (getManualParts), waere ein Umschalten ohne loadManualParts() ein halb angewandter Filter — oben
 * ungefiltert, unten gefiltert. Dieselbe Begruendung wie bei onScopeChange() darunter.
 * @param {string} view
 */
export function onStorageChange(view) {
  const el = G('storage-' + view);
  if (!el) return;
  setLagerModus(view, el.value);
  if (view === 'gallery') loadGallery();
  if (view === 'parts')   { loadParts(); loadManualParts(); }
}

/**
 * Umschalten — lädt NUR die betroffene Ansicht neu.
 *
 * Die Wahl gilt pro Ansicht; alle vier gleichzeitig neu zu laden würde drei Ansichten anfassen, die niemand
 * gerade ansieht, und dabei Preisabrufe auslösen.
 * @param {string} view
 */
export function onScopeChange(view) {
  const el = G('scope-' + view);
  if (!el) return;
  setScopeMode(view, el.value);
  if (view === 'gallery')  { loadGallery(); loadStats(); }
  // Die Reiter Teile und Minifiguren haben je ZWEI Listen: die aus Sets und die manuell erfassten. Nur
  // loadParts() neu zu laden liess den manuellen Bereich ungefiltert stehen — er lädt über einen eigenen
  // Endpunkt.
  if (view === 'parts')    { loadParts(); loadManualParts(); }
  // Der Reiter Minifiguren hat dieselben zwei Listen — hier stand trotzdem nur loadMinifigs(). Die manuellen
  // Karten hingen damit am Kontofilter des LETZTEN Ladens: loadManualFigsTable() schickt den Filter mit,
  // wurde beim Umschalten aber nie gerufen. Genau die Luecke, die der Satz darueber fuer beide Reiter
  // beschreibt.
  if (view === 'minifigs') { loadMinifigs(); loadManualFigsTable(); }
  if (view === 'finance')  loadFinance();
  // Die Merkliste laedt EINE Liste und hat keine Kennzahlen darueber — anders als die Galerie, wo loadStats()
  // mitmuss.
  if (view === 'merkliste') ladeMerkliste();
}

// Ein echter Sprachwechsel baut den offenen Reiter neu auf. Die Galerie wird nur neu gezeichnet: Ein Neuladen
// leerte das Raster zwischendurch.
abonniere('spracheGewechselt', ({ echterWechsel }) => {
  if (!echterWechsel) return;
  const aktiv = /** @type {HTMLElement|null} */ (document.querySelector('.ntab.active'))?.dataset?.tab;
  if (aktiv === 'parts')    { loadParts(); loadManualParts(); }
  if (aktiv === 'minifigs') loadMinifigs();
  if (aktiv === 'finance')  loadFinance();
  if (aktiv === 'settings') { loadSettings(); loadProfile(); }
  if (aktiv === 'monitor')  { loadMonitor(); loadCacheStats(); }
  if (aktiv === 'gallery')  renderGallery();
});

stelleZielBereit({ sicht: oeffneSicht });

registerActions({
  filterUmschalten,
  filterZuruecksetzen,
  benutzerMenue,
  oeffneSicht,
  oeffneReiter,
  onScopeChange,
  onStorageChange,
});
