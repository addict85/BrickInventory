// Reiter, Benutzermenü, Sichten und die Filter, die mehrere Listen neu laden. Steht über allen Ansichten und
// darf jede laden; der Router erreicht die Sichten über targets.js, nicht über einen Import.
import { registerTarget } from './targets.js';
import { registerActions } from './registry.js';
import { G, emptyState, alle, eins, setzeHtml, rollArt } from './dom.js';
import { loggedInAccount, lastImportAt } from './state.js';
import { loadSchedules, loadMonitor, stopMonitor } from './monitor.js';
import { resetMinifigsFilter, loadManualFigsTable, loadMinifigs } from './minifigs.js';
import { initCatalog, resetCatalog } from './catalog.js';
import { pollJobStatus, stopJobPolling } from './admin.js';
import { ladeAlarmUebersicht } from './alerts.js';
import { ladeLagerortVerwaltung } from './storage-locations.js';
import {
  loadApiLimits,
  loadCacheStats,
  loadCacheTtl,
  loadProfile,
  loadRateLimitStats,
  loadSettings,
} from './settings.js';
import { loadTls, loadTokens } from './accesses.js';
import { loadHousehold } from './household.js';
import { ladeGutscheine } from './vouchers.js';
import { ladeMerkliste, resetWantedFilter } from './wanted.js';
import { loadTrash } from './trash.js';
import { ladePasskeys } from './passkeys.js';
import { ladeZweitenFaktor } from './second-factor.js';
import { loadParts, resetPartsFilter, loadManualParts } from './parts.js';
import { loadBrickColors } from './part-add.js';
import { reportView, reportFilter } from './router.js';
import { setLagerModus, setScopeMode } from './account-filter.js';
import { collectionSubtitle } from './account-locations.js';
import { setScrollLabel } from './scrollbar.js';
import { tRaw } from '../i18n.js';
import { subscribe, emit } from './events.js';
import { esc } from './escaping.js';

// Icon des Reiters in den Seitentitel spiegeln (links vom Text), damit oben derselbe Icon wie im Nav-Tab
// erscheint. Quelle ist der Nav-Tab selbst — Emoji ODER Inline-SVG —, so bleibt beides automatisch synchron.
/**
 * @param {string | undefined} tab
 */
function syncTabTitleIcon(tab) {
  const nav = document.querySelector(`.ntab[data-tab="${tab}"]`);
  const slot = document.querySelector(`.ptitle[data-tab-title="${esc(tab)}"] .ptitle-icon`);
  if (!nav || !slot) return;
  // Alles vor dem .tab-label ist das Icon (Emoji-Textknoten oder <svg>).
  const label = nav.querySelector('.tab-label');
  // Kopien statt outerHTML: Als Text neu eingelesen, stünde der Stil des Symbols wieder als style-Attribut
  // da, und das verbietet die CSP.
  const kopien = [];
  for (const node of nav.childNodes) {
    if (node === label) break;
    if (node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').trim() : true) kopien.push(node.cloneNode(true));
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
function markGroup(tab) {
  // Eigene Klasse statt .active: `.ntab.active` nennt überall den offenen Reiter.
  const sammlung = document.querySelector('.ntab[data-tab="gallery"]');
  sammlung?.classList.toggle('gruppe-aktiv', !!tab && SAMMLUNG.includes(tab));
  // Die drei Knöpfe wechseln die Ansicht; die offene ist die aktuelle Seite.
  alle('.sammlung-wahl [data-arg]').forEach(b => {
    if (b.dataset.arg === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  // Vorleseprogramme erfahren so, welcher Reiter offen ist. „Sammlung“ gilt nur dann als aktuelle Seite, wenn
  // der eigene Reiter der Ansicht nicht zu sehen ist (am Telefon).
  const offen = document.querySelector('.ntab.active');
  const openVisible = !!offen?.getClientRects().length;
  document.querySelectorAll('.ntab').forEach(x => {
    if (x.classList.contains('active') || (x.classList.contains('gruppe-aktiv') && !openVisible && x !== offen))
      x.setAttribute('aria-current', 'page');
    else x.removeAttribute('aria-current');
  });
}

/** Am Handy: die Filter hinter einem Knopf, damit die Liste oben beginnt. @this {HTMLElement} */
export function filterUmschalten() {
  const leiste = this?.closest?.('.filterleiste');
  if (!leiste) return;
  const offen = leiste.classList.toggle('offen');
  this.setAttribute('aria-expanded', String(offen));
}

/** Wer kein Verwalter ist, sieht im Reiter Einstellungen einen Satz statt einer leeren Seite. */
function showSettingAccess() {
  const f = G('einst-kein-zugriff');
  if (!f) return;
  f.hidden = !!loggedInAccount?.isAdmin;
  setzeHtml(
    f,
    loggedInAccount?.isAdmin
      ? ''
      : emptyState({ ico: 'schloss', titel: tRaw('settings.kein_zugriff'), text: tRaw('settings.kein_zugriff_text') }),
  );
}

/**
 * Einen Reiter öffnen — aus dem Umschalter der Sammlung oder dem Menü.
 * @param {string} name
 */
export function oeffneReiter(name) {
  const fromMenu = !!G('umenu-pop')?.contains(document.activeElement);
  closeMenu();
  eins(`.ntab[data-tab="${name}"]`)?.click();
  if (fromMenu) focusOnTitle(G('tab-' + name));
}

/**
 * Nach einer Wahl im Menü steht der Fokus auf einem nun verborgenen Eintrag und fiele an den Seitenanfang;
 * die Überschrift der neuen Seite ist der Ort, an dem Tastatur und Bildschirmleser weitermachen.
 */
/** @param {HTMLElement | null} flaeche */
function focusOnTitle(flaeche) {
  const titel = /** @type {HTMLElement|null} */ (flaeche?.querySelector('.ptitle') ?? null);
  if (!titel) {
    G('btn-umenu')?.focus();
    return;
  }
  if (!titel.hasAttribute('tabindex')) titel.setAttribute('tabindex', '-1');
  titel.focus({ preventScroll: true });
}

export function bindTabs() {
  alle('.ntab').forEach(t => {
    // Avoid duplicate listeners
    if (t._tabBound) return;
    t._tabBound = true;
    t.addEventListener('click', () => {
      document.querySelectorAll('.ntab').forEach(x => {
        x.classList.remove('active');
      });
      document.querySelectorAll('.tab').forEach(x => {
        x.classList.remove('active');
      });
      // Unsichtbare Reiter (Einstellungen, Monitoring) öffnet das Kontomenü — dann markiert der Menüknopf, wo
      // man ist.
      const unter = t.classList.contains('ntab-unter');
      G('btn-umenu')?.classList.toggle('aktiv', unter);
      if (unter) G('btn-umenu')?.setAttribute('aria-current', 'page');
      else G('btn-umenu')?.removeAttribute('aria-current');
      t.classList.add('active');
      G('tab-' + t.dataset.tab).classList.add('active');
      const tab = t.dataset.tab ?? '';
      reportView(tab);
      markGroup(tab);
      showPageName(G('tab-' + tab), unter);
      syncTabTitleIcon(tab);
      // Das Jahres-Etikett am Scrollbalken gehört NUR in den Katalog. Ohne dieses Abmelden lieferte die dort
      // angemeldete Funktion weiterhin ein Jahr — auch in der Galerie, wo die Zahl nichts bedeutet.
      if (tab !== 'catalog') setScrollLabel(null);
      // loadGallery() lädt die Kennzahlen selbst; ein zweiter Aufruf kostete doppelt am Budget (apiDrossel.ts).
      if (tab === 'gallery') emit('sammlungLaden');
      if (tab === 'catalog') {
        initCatalog();
      }
      if (tab === 'wanted') {
        ladeMerkliste();
      }
      if (tab === 'parts') {
        loadParts();
        loadManualParts();
        loadBrickColors();
        // War der Import eben erst, nach dem Hintergrundauftrag noch einmal laden
        if (Date.now() - lastImportAt < 30000)
          setTimeout(() => {
            loadParts();
            loadManualParts();
          }, 5000);
      }
      if (tab === 'minifigs') {
        loadMinifigs();
        if (Date.now() - lastImportAt < 30000) setTimeout(loadMinifigs, 5000);
      }
      if (tab === 'finance') {
        emit('finanzenLaden');
      } // loadFinance already fetches parts+minifigs valuation in parallel
      if (tab === 'partslist') {
        /* session-only, no server load needed */
      }
      // Der Reiter traegt seit dem 16.10. nur noch die Verwalter-Rubriken; was frueher hier alles mitgeladen
      // wurde, holt jetzt die jeweilige Sicht beim Oeffnen (siehe oeffneSicht unten). Wer die API-Schluessel
      // nachsieht, braucht keine Gutscheinliste.
      if (tab === 'settings') {
        showSettingAccess();
        loadSettings();
        if (loggedInAccount?.isAdmin) {
          loadApiLimits();
          loadCacheTtl();
          loadSchedules();
        }
      }
      if (tab === 'monitor') {
        loadMonitor();
        loadCacheStats();
        loadRateLimitStats();
        stopJobPolling();
        pollJobStatus();
      }
      if (tab !== 'monitor' && stopMonitor()) stopJobPolling();
    });
  });
  // Alle Seitentitel-Icons füllen — läuft bei jedem bindTabs()-Aufruf, also auch nach dem Login (showApp ruft
  // bindTabs erneut), wenn der Inhalt sichtbar wird. So erscheint das Icon links vom Titel auf allen Tabs,
  // nicht nur nach einem Klick.
  alle('.ptitle[data-tab-title]').forEach(h => {
    syncTabTitleIcon(h.dataset.tabTitle);
  });
}

// Aufruf verschoben nach startApp() (js/init.js), das js/main.js NACH der Auswertung aller Module aufruft.
// Im Modulrumpf lief er zu früh: Bei gegenseitigen Importen ist das Übersetzungsobjekt aus i18n.js dann noch
// nicht initialisiert, und t() wirft.

// Die Sichten hinter dem Benutzermenü, wie in der Android-App. Jede Sicht lädt nur, was sie zeigt: Vorher
// holte der Einstellungs-Reiter bei jedem Öffnen fünf Bereiche, von denen man meist einen sehen wollte.
/** @type {Record<string, () => unknown>} */
const VIEWS = {
  profil: () => {
    loadSettings();
    loadProfile();
    ladeZweitenFaktor();
    ladePasskeys();
  },
  gutscheine: () => ladeGutscheine(),
  alarme: () => ladeAlarmUebersicht(),
  lagerorte: () => ladeLagerortVerwaltung(),
  haushalt: () => loadHousehold(),
  daten: () => loadTrash(),
  app: () => {
    loadTokens();
    loadTls();
  },
};

/**
 * Eine Sicht aus dem Menü öffnen.
 * @param {string} name
 */
export function oeffneSicht(name) {
  if (!VIEWS[name]) return;
  const flaeche = G('tab-' + name);
  if (!flaeche) return;
  const fromMenu = !!G('umenu-pop')?.contains(document.activeElement);
  document.querySelectorAll('.ntab').forEach(x => {
    x.classList.remove('active');
  });
  document.querySelectorAll('.tab').forEach(x => {
    x.classList.remove('active');
  });
  flaeche.classList.add('active');
  markGroup(null);
  showPageName(flaeche, true);
  closeMenu();
  reportView(name);
  // Die Sichten liegen im Kontomenü, nicht in der Leiste: Dann zeigt der Menüknopf, wo man ist — sonst wäre
  // kein Reiter als aktiv markiert.
  G('btn-umenu')?.classList.add('aktiv');
  G('btn-umenu')?.setAttribute('aria-current', 'page');
  // Nach oben: Die Sicht öffnet sich sonst an der Stelle, an der die vorige gerollt war, und man sieht die
  // Mitte einer fremden Seite.
  window.scrollTo({ top: 0, behavior: rollArt() });
  if (fromMenu) focusOnTitle(flaeche);
  VIEWS[name]();
}

/**
 * Seitenname im Fenstertitel und, für Seiten hinter dem Menü, im Kopf: Dort markiert kein Reiter die offene
 * Seite, sonst wüsste man nur am Inhalt, wo man ist.
 * @param {Element | null} flaeche
 * @param {boolean} inHeader
 */
function showPageName(flaeche, inHeader) {
  // Ohne weiche Trennstriche: Im Seitentitel und in der Tab-Leiste werden sie sichtbar oder stören die Suche.
  const titel = (flaeche?.querySelector('.ptitle')?.textContent || '').replace(/\u00AD/g, '').trim();
  const kopf = G('kopf-sicht');
  if (kopf) {
    kopf.textContent = inHeader ? titel : '';
    kopf.hidden = !(inHeader && titel);
  }
  document.title = titel ? `${titel} – BrickInventory` : 'BrickInventory Manager';
  observeTitle(flaeche);
}

/** @type {MutationObserver | null} */
let _setDetailObserver = null;
/**
 * Offenes Set-Detail: Der Fenstertitel nennt das Set, nach dem Schliessen wieder die Seite. Beobachtet
 * statt an jedem Schliessweg gesetzt: Knopf, Esc, Hintergrund und der Kaufpreis-Dialog schliessen ihn.
 */
function observeSetDetail() {
  const dialog = G('set-modal'),
    titel = G('m-tit');
  if (_setDetailObserver || !dialog || !titel || typeof MutationObserver !== 'function') return;
  let offen = false;
  const setUp = () => {
    const name = (titel.textContent || '').trim();
    if (dialog.classList.contains('open') && name) {
      offen = true;
      document.title = `${name} – BrickInventory`;
    } else if (offen) {
      offen = false;
      refreshPageName();
    }
  };
  _setDetailObserver = new MutationObserver(setUp);
  _setDetailObserver.observe(dialog, { attributes: true, attributeFilter: ['class'] });
  _setDetailObserver.observe(titel, { childList: true, characterData: true, subtree: true });
}

/** Beim Start ist die Sammlung schon offen, ohne dass ein Reiter geklickt wurde: Titel trotzdem setzen. */
export function refreshPageName() {
  observeSetDetail();
  const flaeche = document.querySelector('.tab.active');
  const reiter = flaeche && document.querySelector(`.ntab[data-tab="${flaeche.id.replace(/^tab-/, '')}"]`);
  showPageName(flaeche, !reiter || reiter.classList.contains('ntab-unter'));
}

/**
 * Am Telefon steht der Seitenname nur dann im Kopf, wenn die Überschrift hinausgerollt ist; sonst stünde er
 * zweimal untereinander.
 * @type {IntersectionObserver | null}
 */
let _titleObserver = null;
/**
 * @param {Element | null} flaeche
 */
function observeTitle(flaeche) {
  const kopf = G('kopf-sicht'),
    h1 = flaeche?.querySelector('.ptitle');
  _titleObserver?.disconnect();
  if (!kopf || !h1 || typeof IntersectionObserver !== 'function') return;
  // Gemessen an der echten Kopfleiste (bei 200 % Schrift höher als 64 px) und sofort, nicht erst im ersten
  // Rückruf: Bis dahin galt der Stand der vorigen Seite, und der Titel stand kurz zweimal untereinander.
  const leiste = document.querySelector('header')?.getBoundingClientRect().bottom ?? 64;
  kopf.classList.toggle('titel-sichtbar', h1.getBoundingClientRect().bottom > leiste);
  _titleObserver = new IntersectionObserver(([e]) => kopf.classList.toggle('titel-sichtbar', e.isIntersecting), {
    rootMargin: `-${Math.round(leiste)}px 0px 0px 0px`,
  });
  _titleObserver.observe(h1);
}

function closeMenu(focusBack = false) {
  const pop = G('umenu-pop');
  const drin = !!pop && pop.contains(document.activeElement);
  if (pop) pop.style.display = 'none';
  const knopf = G('btn-umenu');
  if (knopf) knopf.setAttribute('aria-expanded', 'false');
  if (knopf && focusBack && drin) knopf.focus();
}

/** Die sichtbaren Einträge; `admin-only` ist für andere Konten ausgeblendet. */
function menuEntries() {
  return /** @type {HTMLElement[]} */ ([...(G('umenu-pop')?.querySelectorAll('[role="menuitem"]') ?? [])]).filter(
    e => e.style.display !== 'none',
  );
}

/** Öffnet das Menü und setzt den Fokus auf den ersten (oder letzten) Eintrag. */
function openMenu(letzter = false) {
  const pop = G('umenu-pop');
  if (!pop) return;
  pop.style.display = 'block';
  G('btn-umenu')?.setAttribute('aria-expanded', 'true');
  const e = menuEntries();
  (letzter ? e[e.length - 1] : e[0])?.focus();
}

/** Das Menü auf- und zuklappen. */
export function benutzerMenue() {
  const pop = G('umenu-pop');
  if (!pop) return;
  if (pop.style.display !== 'none') {
    closeMenu();
    return;
  }
  openMenu();
}

// Tastatur nach dem APG-Muster „Menu Button": Ein Bildschirmleser kündigt role=menu an, und Nutzer erwarten
// dann Pfeiltasten statt Tab.
document.addEventListener('keydown', ev => {
  const ziel = ev.target instanceof Element ? ev.target : null;
  if (ziel?.id === 'btn-umenu' && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
    ev.preventDefault();
    openMenu(ev.key === 'ArrowUp');
    return;
  }
  if (!ziel?.closest('#umenu-pop')) return;
  const e = menuEntries(),
    i = e.indexOf(/** @type {HTMLElement} */ (ziel));
  const nach = { ArrowDown: (i + 1) % e.length, ArrowUp: (i - 1 + e.length) % e.length, Home: 0, End: e.length - 1 }[
    ev.key
  ];
  if (nach !== undefined) {
    ev.preventDefault();
    e[nach]?.focus();
    return;
  }
  if (ev.key === 'Tab') closeMenu();
});

// Zuklappen, wenn jemand daneben tippt oder Escape drückt. Escape bringt den Fokus zurück auf den Menüknopf,
// sonst fiele er auf den Seitenanfang.
document.addEventListener('click', ev => {
  const pop = G('umenu-pop');
  if (!pop || pop.style.display === 'none') return;
  if (ev.target instanceof Element && ev.target.closest('.umenu-wrap')) return;
  closeMenu();
});

document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') {
    closeMenu(true);
    closeImportMenus(null, true);
  }
});

// Abgemeldet ist #inhalt verborgen; der Sprunglink führt dann ins Anmeldeformular statt ins Leere.
document.querySelector('.sprunglink')?.addEventListener('click', ev => {
  if (G('inhalt')?.checkVisibility?.() !== false) return;
  const felder = /** @type {HTMLElement[]} */ ([
    ...document.querySelectorAll('#login-screen input:not([type=hidden])'),
  ]);
  const feld = felder.find(f => f.checkVisibility?.() !== false);
  if (!feld) return;
  ev.preventDefault();
  feld.focus();
});

/**
 * Offene Import-Menüs schliessen, ausser dem, in dem `ausser` liegt.
 * @param {Node | null} ausser
 */
function closeImportMenus(ausser, focusBack = false) {
  /** @type {NodeListOf<HTMLDetailsElement>} */ (document.querySelectorAll('details.import-menue[open]')).forEach(d => {
    if (ausser && d.contains(ausser)) return;
    d.open = false;
    if (focusBack && d.contains(document.activeElement)) d.querySelector('summary')?.focus();
  });
}

// Ein Klick daneben schliesst das Menü; eine Wahl darin (Datei, Vorlage) ebenso.
document.addEventListener('click', ev => {
  const ziel = ev.target instanceof Element ? ev.target : null;
  closeImportMenus(ziel);
  const d = /** @type {HTMLDetailsElement|null} */ (ziel?.closest('.import-klappe a')?.closest('details') ?? null);
  if (d) d.open = false;
});

document.addEventListener('change', ev => {
  const d =
    ev.target instanceof Element
      ? /** @type {HTMLDetailsElement|null} */ (ev.target.closest('details.import-menue'))
      : null;
  if (d) d.open = false;
});

/**
 * Alle Filter einer Ansicht leeren (Knopf im Leerzustand ohne Treffer).
 * @param {string} ansicht
 */
function filterZuruecksetzen(ansicht) {
  if (ansicht === 'gallery') {
    G('gs').value = '';
    G('gtheme').value = '';
    setLagerModus('gallery', '');
    if (G('storage-gallery')) G('storage-gallery').value = '';
    emit('sammlungLaden');
  } else if (ansicht === 'merkliste') resetWantedFilter();
  else if (ansicht === 'catalog') resetCatalog();
  else if (ansicht === 'parts') resetPartsFilter();
  else if (ansicht === 'minifigs') resetMinifigsFilter();
  reportFilter();
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
  if (view === 'gallery') emit('sammlungLaden');
  if (view === 'parts') {
    loadParts();
    loadManualParts();
  }
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
  collectionSubtitle(view);
  if (view === 'gallery') emit('sammlungLaden');
  // Die Reiter Teile und Minifiguren haben je ZWEI Listen: die aus Sets und die manuell erfassten. Nur
  // loadParts() neu zu laden liess den manuellen Bereich ungefiltert stehen — er lädt über einen eigenen
  // Endpunkt.
  if (view === 'parts') {
    loadParts();
    loadManualParts();
  }
  // Der Reiter Minifiguren hat dieselben zwei Listen — hier stand trotzdem nur loadMinifigs(). Die manuellen
  // Karten hingen damit am Kontofilter des LETZTEN Ladens: loadManualFigsTable() schickt den Filter mit,
  // wurde beim Umschalten aber nie gerufen. Genau die Luecke, die der Satz darueber fuer beide Reiter
  // beschreibt.
  if (view === 'minifigs') {
    loadMinifigs();
    loadManualFigsTable();
  }
  if (view === 'finance') emit('finanzenLaden');
  // Die Merkliste laedt EINE Liste und hat keine Kennzahlen darueber — anders als die Galerie, wo loadStats()
  // mitmuss.
  if (view === 'merkliste') ladeMerkliste();
}

// Ein echter Sprachwechsel baut den offenen Reiter neu auf. Die Galerie wird nur neu gezeichnet: Ein Neuladen
// leerte das Raster zwischendurch.
subscribe('spracheGewechselt', ({ realSwitch }) => {
  if (!realSwitch) return;
  const aktiv = /** @type {HTMLElement|null} */ (document.querySelector('.ntab.active'))?.dataset?.tab;
  if (aktiv === 'parts') {
    loadParts();
    loadManualParts();
  }
  if (aktiv === 'minifigs') loadMinifigs();
  if (aktiv === 'finance') emit('finanzenLaden');
  if (aktiv === 'settings') {
    loadSettings();
    loadProfile();
  }
  if (aktiv === 'monitor') {
    loadMonitor();
    loadCacheStats();
  }
  if (aktiv === 'gallery') emit('sammlungZeichnen');
});

/**
 * Aus einem Dialog zu einer Menüseite (Set-Detail → Preisalarme). Erst schliesst der Dialog über seinen eigenen
 * Schliessknopf, damit er aufräumt wie sonst auch; dann erst die Seite.
 * @this {HTMLElement} @param {string} name
 */
function sichtAusDialog(name) {
  const zu = this.closest('.ovl')?.querySelector('[data-dialog-zu]');
  if (zu instanceof HTMLElement) zu.click();
  oeffneSicht(name);
}

registerTarget({ view: oeffneSicht });

registerActions({
  filterUmschalten,
  filterZuruecksetzen,
  benutzerMenue,
  oeffneSicht,
  oeffneReiter,
  sichtAusDialog,
  onScopeChange,
  onStorageChange,
});
